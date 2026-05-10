<?php

declare(strict_types=1);

namespace Drupal\media_functionality\Controller;

use Drupal\Component\Uuid\UuidInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Database\Connection;
use Drupal\media_functionality\Service\S3Service;
use Drupal\media_functionality\Service\UsageTracker;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * REST endpoints for the media_functionality module.
 *
 * Mounted at /api/study/media/* (see routing.yml).
 */
class MediaFunctionalityController extends ControllerBase {

  private const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
  private const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  private const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a'];

  public function __construct(
    private readonly S3Service $s3,
    private readonly UsageTracker $usage,
    private readonly UuidInterface $uuidService,
    private readonly Connection $database,
  ) {}

  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('media_functionality.s3'),
      $container->get('media_functionality.usage_tracker'),
      $container->get('uuid'),
      $container->get('database'),
    );
  }

  /**
   * POST /api/study/media/upload
   *
   * Multipart body with a single file field named "file".
   * Returns: { uuid, mediaType, mimeType, originalFilename, fileSize, url }
   */
  public function upload(Request $request): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $file = $request->files->get('file');
    if ($file === NULL) {
      return $this->json(['error' => 'No file uploaded.'], 400);
    }
    if (!$file->isValid()) {
      return $this->json(['error' => 'Upload failed: ' . $file->getErrorMessage()], 400);
    }

    $mime = $this->resolveUploadMime($file);
    $size = (int) $file->getSize();
    if ($size <= 0 || $size > self::MAX_UPLOAD_BYTES) {
      return $this->json(['error' => 'File size out of range (max 20 MB).'], 413);
    }

    $mediaType = $this->classifyMime($mime);
    if ($mediaType === NULL) {
      return $this->json(['error' => 'Unsupported file type: ' . ($mime !== '' ? $mime : 'unknown')], 415);
    }

    $userUuid = $this->resolveUserUuid((int) $account->id());
    if ($userUuid === NULL) {
      return $this->json(['error' => 'Could not resolve user UUID.'], 500);
    }

    $assetUuid = $this->uuidService->generate();
    $originalName = (string) ($file->getClientOriginalName() ?: 'upload');
    $key = $this->s3->buildKey($userUuid, $assetUuid, $originalName);

    $contents = file_get_contents($file->getRealPath());
    if ($contents === FALSE) {
      return $this->json(['error' => 'Could not read uploaded file.'], 500);
    }

    try {
      $this->s3->putObject($key, $contents, $mime);
    }
    catch (\RuntimeException $e) {
      return $this->json(['error' => $e->getMessage()], 502);
    }

    $now = \Drupal::time()->getRequestTime();
    $this->database->insert('media_functionality_asset')
      ->fields([
        'uuid' => $assetUuid,
        's3_key' => $key,
        'media_type' => $mediaType,
        'mime_type' => $mime,
        'original_filename' => mb_substr($originalName, 0, 255),
        'file_size' => $size,
        'owner_uid' => (int) $account->id(),
        'created' => $now,
        'deleted' => 0,
      ])
      ->execute();

    return $this->json([
      'uuid' => $assetUuid,
      'mediaType' => $mediaType,
      'mimeType' => $mime,
      'originalFilename' => $originalName,
      'fileSize' => $size,
      'url' => $this->buildPublicUrl($assetUuid, $key),
    ], 201);
  }

  /**
   * GET /api/study/media
   *
   * Lists the current user's non-deleted assets, newest first.
   */
  public function listAssets(): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }
    $rows = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 's3_key', 'media_type', 'mime_type', 'original_filename', 'file_size', 'created'])
      ->condition('owner_uid', (int) $account->id())
      ->condition('deleted', 0)
      ->orderBy('created', 'DESC')
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);

    return $this->json(['data' => array_map(fn ($r) => [
      'uuid' => (string) $r['uuid'],
      'mediaType' => (string) $r['media_type'],
      'mimeType' => (string) $r['mime_type'],
      'originalFilename' => (string) $r['original_filename'],
      'fileSize' => (int) $r['file_size'],
      'created' => (int) $r['created'],
      'url' => $this->buildPublicUrl((string) $r['uuid'], (string) $r['s3_key']),
    ], $rows)]);
  }

  /**
   * GET /api/study/media/{uuid}/file
   *
   * Streams the asset bytes from S3 after authorization:
   *   - owner can always view
   *   - else if ?share_token=... matches a shared entity that uses this
   *     asset, allow
   *   - else 403
   */
  public function serve(string $uuid, Request $request): StreamedResponse|JsonResponse {
    $asset = $this->loadAsset($uuid);
    if ($asset === NULL) {
      return $this->json(['error' => 'Not found'], 404);
    }

    if ((int) $asset['deleted'] === 1) {
      return $this->json(['error' => 'Media has been deleted.'], 410);
    }

    $allowed = $this->isAllowedToServe($asset, $request);
    if (!$allowed) {
      return $this->json(['error' => 'Forbidden'], 403);
    }

    try {
      $stream = $this->s3->getObjectStream((string) $asset['s3_key']);
    }
    catch (\RuntimeException $e) {
      return $this->json(['error' => $e->getMessage()], 502);
    }

    $mime = (string) ($asset['mime_type'] ?: 'application/octet-stream');
    $size = (int) ($asset['file_size'] ?: 0);

    $response = new StreamedResponse(function () use ($stream): void {
      while (!$stream->eof()) {
        echo $stream->read(64 * 1024);
        @flush();
      }
    });
    $response->headers->set('Content-Type', $mime);
    if ($size > 0) {
      $response->headers->set('Content-Length', (string) $size);
    }
    $response->headers->set('Cache-Control', 'private, max-age=86400');
    return $response;
  }

  /**
   * GET /api/study/media/{uuid}/usage
   */
  public function usage(string $uuid): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }
    $asset = $this->loadAsset($uuid);
    if ($asset === NULL || (int) $asset['owner_uid'] !== (int) $account->id()) {
      return $this->json(['error' => 'Not found'], 404);
    }
    return $this->json(['data' => $this->usage->usageForAsset($uuid)]);
  }

  /**
   * PATCH /api/study/media/{uuid}/delete
   *
   * Soft-deletes the asset (sets deleted=1) and removes the S3 object.
   * Returns the usage list so the frontend can show "still used in N notes"
   * warnings.
   */
  public function softDelete(string $uuid): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }
    $asset = $this->loadAsset($uuid);
    if ($asset === NULL || (int) $asset['owner_uid'] !== (int) $account->id()) {
      return $this->json(['error' => 'Not found'], 404);
    }
    if ((int) $asset['deleted'] === 1) {
      return $this->json(['data' => ['uuid' => $uuid, 'usage' => $this->usage->usageForAsset($uuid)]]);
    }

    $usageRows = $this->usage->usageForAsset($uuid);

    // Soft-delete in DB first; only then attempt the (best-effort) S3 delete.
    $now = \Drupal::time()->getRequestTime();
    $this->database->update('media_functionality_asset')
      ->fields(['deleted' => 1, 'deleted_at' => $now])
      ->condition('uuid', $uuid)
      ->execute();
    $this->s3->deleteObject((string) $asset['s3_key']);

    return $this->json(['data' => ['uuid' => $uuid, 'usage' => $usageRows]]);
  }

  /**
   * GET /api/study/media/broken
   *
   * Returns the soft-deleted asset uuids belonging to the current user.
   * Frontend uses these to flag broken references inside note bodies.
   */
  public function broken(): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }
    $rows = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 'original_filename', 'deleted_at'])
      ->condition('owner_uid', (int) $account->id())
      ->condition('deleted', 1)
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);

    return $this->json(['data' => array_map(static fn ($r) => [
      'uuid' => (string) $r['uuid'],
      'originalFilename' => (string) $r['original_filename'],
      'deletedAt' => $r['deleted_at'] !== NULL ? (int) $r['deleted_at'] : NULL,
    ], $rows)]);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * @return array<string, mixed>|null
   */
  private function loadAsset(string $uuid): ?array {
    $row = $this->database->select('media_functionality_asset', 'a')
      ->fields('a')
      ->condition('uuid', $uuid)
      ->execute()
      ->fetchAssoc();
    return $row ?: NULL;
  }

  /**
   * Authorization for /file: owner always, OR a valid share token whose
   * shared entity actually uses this asset (and is still flagged shared).
   *
   * @param array<string, mixed> $asset
   */
  private function isAllowedToServe(array $asset, Request $request): bool {
    $account = $this->currentUser();
    if (!$account->isAnonymous() && (int) $account->id() === (int) $asset['owner_uid']) {
      return TRUE;
    }
    $token = (string) $request->query->get('share_token', '');
    if ($token === '') {
      return FALSE;
    }
    return $this->shareTokenAllows($token, (string) $asset['uuid']);
  }

  /**
   * Returns TRUE iff the supplied share token resolves to a shared node
   * (study_note / flashcard_deck) that references the supplied asset
   * (directly via field_body, or via an attached flashcard).
   */
  private function shareTokenAllows(string $token, string $assetUuid): bool {
    $storage = $this->entityTypeManager()->getStorage('node');

    // Note share: asset must appear in field_body.
    $matches = $storage->loadByProperties([
      'type' => 'study_note',
      'field_is_shared' => 1,
      'field_share_token' => $token,
    ]);
    /** @var \Drupal\node\NodeInterface|null $note */
    $note = $matches ? reset($matches) : NULL;
    if ($note !== NULL && $note->isPublished()) {
      $body = $note->hasField('field_body') && !$note->get('field_body')->isEmpty()
        ? (string) $note->get('field_body')->value
        : '';
      if (in_array($assetUuid, $this->usage->extractAssetUuids($body), TRUE)) {
        return TRUE;
      }
    }

    // Deck share: asset must appear in any of the deck's flashcards.
    // Scaffolded for the future flashcard-media UI; safe today since no
    // flashcard ever contains a /api/media/<uuid> reference yet.
    $deckMatches = $storage->loadByProperties([
      'type' => 'flashcard_deck',
      'field_is_shared' => 1,
      'field_share_token' => $token,
    ]);
    /** @var \Drupal\node\NodeInterface|null $deck */
    $deck = $deckMatches ? reset($deckMatches) : NULL;
    if ($deck !== NULL && $deck->isPublished()) {
      $cardIds = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('type', 'flashcard')
        ->condition('field_deck', $deck->id())
        ->execute();
      if (!empty($cardIds)) {
        foreach ($storage->loadMultiple($cardIds) as $card) {
          $front = $card->hasField('field_front') && !$card->get('field_front')->isEmpty()
            ? (string) $card->get('field_front')->value
            : '';
          $back = $card->hasField('field_back') && !$card->get('field_back')->isEmpty()
            ? (string) $card->get('field_back')->value
            : '';
          $combined = $front . "\n" . $back;
          if (in_array($assetUuid, $this->usage->extractAssetUuids($combined), TRUE)) {
            return TRUE;
          }
        }
      }
    }

    return FALSE;
  }

  /**
   * Builds the public-facing URL we hand back to the frontend.
   *
   * Format: `/api/media/<uuid>/<filename>` — the trailing filename is
   * cosmetic and ignored by the proxy/Drupal routes. We keep it on the
   * URL so that:
   *   - the markdown renderer can detect audio assets via file extension
   *     (e.g. `.mp3` at the URL tail)
   *   - browsers and DevTools show a meaningful filename
   *   - direct downloads land with a sensible default name
   *
   * The filename is taken from the S3 key's last segment (already
   * sanitised by S3Service::sanitizeFilename), so it's URL-safe.
   */
  private function buildPublicUrl(string $assetUuid, string $s3Key): string {
    $filename = basename($s3Key);
    return '/api/media/' . $assetUuid . ($filename !== '' ? '/' . rawurlencode($filename) : '');
  }

  private function classifyMime(string $mime): ?string {
    if (in_array($mime, self::ALLOWED_IMAGE_MIME, TRUE)) {
      return 'image';
    }
    if (in_array($mime, self::ALLOWED_AUDIO_MIME, TRUE)) {
      return 'audio';
    }
    return NULL;
  }

  /**
   * Decides the effective MIME for an upload, in priority:
   *   1. fileinfo-guessed (if it isn't the generic "I don't know" value)
   *   2. client-supplied (browser's per-part Content-Type)
   *   3. file-extension lookup
   *
   * Symfony's getMimeType() returns the literal "application/octet-stream"
   * when libmagic can't recognize the bytes, so a plain `?:` chain would
   * latch onto that and ignore the (often-correct) client header and the
   * file extension. This mirrors how most upload-handling frameworks
   * actually work in practice.
   */
  private function resolveUploadMime(\Symfony\Component\HttpFoundation\File\UploadedFile $file): string {
    $generic = 'application/octet-stream';
    $guessed = (string) ($file->getMimeType() ?? '');
    if ($guessed !== '' && $guessed !== $generic) {
      return $guessed;
    }
    $client = (string) $file->getClientMimeType();
    if ($client !== '' && $client !== $generic) {
      return $client;
    }
    $fromExt = $this->mimeFromExtension($file->getClientOriginalExtension());
    if ($fromExt !== '') {
      return $fromExt;
    }
    return $guessed !== '' ? $guessed : $client;
  }

  /**
   * Maps a lowercased file extension to the canonical MIME we accept.
   * Returns '' for unknown extensions.
   */
  private function mimeFromExtension(string $ext): string {
    $ext = strtolower(trim($ext));
    return match ($ext) {
      'jpg', 'jpeg', 'jpe' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'mp3' => 'audio/mpeg',
      'ogg', 'oga' => 'audio/ogg',
      'wav' => 'audio/wav',
      'm4a' => 'audio/mp4',
      'aac' => 'audio/mp4',
      default => '',
    };
  }

  private function resolveUserUuid(int $uid): ?string {
    if ($uid <= 0) {
      return NULL;
    }
    $user = $this->entityTypeManager()->getStorage('user')->load($uid);
    return $user ? (string) $user->uuid() : NULL;
  }

  private function json(array $payload, int $status = 200): JsonResponse {
    $response = new JsonResponse($payload, $status);
    $response->headers->set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return $response;
  }

}
