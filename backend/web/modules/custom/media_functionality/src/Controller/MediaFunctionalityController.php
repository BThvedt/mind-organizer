<?php

declare(strict_types=1);

namespace Drupal\media_functionality\Controller;

use Drupal\Component\Uuid\UuidInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Database\Connection;
use Drupal\media_functionality\Service\AiDescriptionService;
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
  private const MAX_FILE_BYTES = 50 * 1024 * 1024;
  private const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  private const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a'];
  private const ALLOWED_FILE_MIME = [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/json',
    'application/xml',
    'text/xml',
    'application/zip',
  ];

  public function __construct(
    private readonly S3Service $s3,
    private readonly UsageTracker $usage,
    private readonly UuidInterface $uuidService,
    private readonly Connection $database,
    private readonly AiDescriptionService $aiDescription,
  ) {}

  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('media_functionality.s3'),
      $container->get('media_functionality.usage_tracker'),
      $container->get('uuid'),
      $container->get('database'),
      $container->get('media_functionality.ai_description'),
    );
  }

  /**
   * POST /api/study/media/upload
   *
   * Multipart body with a single file field named "file".
   * Returns: { uuid, mediaType, mimeType, originalFilename, description, fileSize, url }
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
    if ($size <= 0) {
      return $this->json(['error' => 'File is empty.'], 400);
    }

    $mediaType = $this->classifyMime($mime);
    if ($mediaType === NULL) {
      return $this->json(['error' => 'Unsupported file type: ' . ($mime !== '' ? $mime : 'unknown')], 415);
    }

    // Files (PDFs, spreadsheets, etc.) get a larger ceiling than media,
    // since office documents trivially exceed the 20 MB image/audio cap.
    $maxBytes = $mediaType === 'file' ? self::MAX_FILE_BYTES : self::MAX_UPLOAD_BYTES;
    if ($size > $maxBytes) {
      $maxMb = (int) ($maxBytes / (1024 * 1024));
      return $this->json(['error' => "File too large (max {$maxMb} MB)."], 413);
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
        'description' => '',
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
      'description' => '',
      'fileSize' => $size,
      'url' => $this->buildPublicUrl($assetUuid, $key),
    ], 201);
  }

  /**
   * GET /api/study/media
   *
   * Lists the current user's non-deleted assets, newest first.
   *
   * Optional `?type=image,audio` (default) / `?type=file` filters which
   * asset class is returned, so the Media page and Files page can fetch
   * from the same endpoint without each seeing the other's rows.
   */
  public function listAssets(Request $request): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $allowedTypes = ['image', 'audio', 'file'];
    $rawType = (string) $request->query->get('type', 'image,audio');
    $requested = array_values(array_filter(
      array_map('trim', explode(',', $rawType)),
      static fn ($t) => in_array($t, $allowedTypes, TRUE),
    ));
    if (empty($requested)) {
      $requested = ['image', 'audio'];
    }

    $query = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 's3_key', 'media_type', 'mime_type', 'original_filename', 'description', 'file_size', 'created'])
      ->condition('owner_uid', (int) $account->id())
      ->condition('deleted', 0)
      ->condition('media_type', $requested, 'IN')
      ->orderBy('created', 'DESC');
    $rows = $query->execute()->fetchAll(\PDO::FETCH_ASSOC);

    return $this->json(['data' => array_map(fn ($r) => [
      'uuid' => (string) $r['uuid'],
      'mediaType' => (string) $r['media_type'],
      'mimeType' => (string) $r['mime_type'],
      'originalFilename' => (string) $r['original_filename'],
      'description' => (string) ($r['description'] ?? ''),
      'fileSize' => (int) $r['file_size'],
      'created' => (int) $r['created'],
      'url' => $this->buildPublicUrl((string) $r['uuid'], (string) $r['s3_key']),
    ], $rows)]);
  }

  /**
   * GET /api/study/media/search
   *
   * Owner-scoped substring search over `original_filename` and
   * `description`, with an optional `?type=image,audio,file` filter.
   * Used by the editor's Insert dialog to pick from already-uploaded
   * assets without paginating the full library.
   *
   * Conventions match `study_search`:
   *   - empty / <2-char queries return an empty data array (no error)
   *   - results capped at 20, newest first
   *
   * Implemented as direct SQL rather than Search API because media
   * assets aren't entities — the existing `db_index` is `entity:node`
   * only, so adding them would require a custom datasource just to
   * enable a single LIKE search.
   */
  public function searchAssets(Request $request): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $q = trim((string) $request->query->get('q', ''));
    if (mb_strlen($q) < 2) {
      return $this->json(['data' => []]);
    }

    $allowedTypes = ['image', 'audio', 'file'];
    $rawType = (string) $request->query->get('type', 'image,audio,file');
    $requested = array_values(array_filter(
      array_map('trim', explode(',', $rawType)),
      static fn ($t) => in_array($t, $allowedTypes, TRUE),
    ));
    if (empty($requested)) {
      $requested = $allowedTypes;
    }

    // escapeLike() handles `%` and `_` in user input; we wrap the
    // result with `%…%` for substring matching.
    $like = '%' . $this->database->escapeLike($q) . '%';

    $query = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 's3_key', 'media_type', 'mime_type', 'original_filename', 'description', 'file_size', 'created'])
      ->condition('owner_uid', (int) $account->id())
      ->condition('deleted', 0)
      ->condition('media_type', $requested, 'IN');

    $orGroup = $query->orConditionGroup()
      ->condition('original_filename', $like, 'LIKE')
      ->condition('description', $like, 'LIKE');
    $query->condition($orGroup);

    $rows = $query->orderBy('created', 'DESC')
      ->range(0, 20)
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);

    return $this->json(['data' => array_map(fn ($r) => [
      'uuid' => (string) $r['uuid'],
      'mediaType' => (string) $r['media_type'],
      'mimeType' => (string) $r['mime_type'],
      'originalFilename' => (string) $r['original_filename'],
      'description' => (string) ($r['description'] ?? ''),
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
    $rows = $this->usage->usageForAsset($uuid);
    return $this->json(['data' => array_map(fn ($row) => $row + [
      'frontend_url' => $this->resolveFrontendUrl((string) $row['entity_type'], (string) $row['entity_uuid']),
    ], $rows)]);
  }

  /**
   * PATCH /api/study/media/{uuid}/delete
   *
   * Soft-deletes the asset (sets deleted=1) and removes the S3 object.
   * Returns the usage list so the frontend can show "still used in N notes"
   * warnings.
   *
   * After the asset is marked deleted, every referencing entity is re-saved
   * so its presave hook recomputes field_missing_media — this is what
   * actually flags the broken references (the body text still contains the
   * uuid, but it now resolves to a soft-deleted asset).
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

    $usageRows = $this->performSoftDelete($asset);
    return $this->json(['data' => ['uuid' => $uuid, 'usage' => $usageRows]]);
  }

  /**
   * PATCH /api/study/media/{uuid}/rename
   *
   * Edits the user-facing metadata of an asset. Owner-only.
   *
   * Body: any subset of:
   *   - `originalFilename`: non-empty display name (no path separators / control chars, ≤255)
   *   - `description`: short user note about the file (≤2000 chars; trimmed; empty allowed)
   *
   * Only fields present in the body are updated. The S3 key is never
   * touched, so this never breaks references in note bodies.
   */
  public function rename(string $uuid, Request $request): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }
    $asset = $this->loadAsset($uuid);
    if ($asset === NULL || (int) $asset['owner_uid'] !== (int) $account->id()) {
      return $this->json(['error' => 'Not found'], 404);
    }
    if ((int) $asset['deleted'] === 1) {
      return $this->json(['error' => 'Asset has been deleted.'], 410);
    }

    $payload = json_decode((string) $request->getContent(), TRUE);
    if (!is_array($payload)) {
      return $this->json(['error' => 'Invalid JSON body.'], 400);
    }

    $updates = [];
    $newName = (string) $asset['original_filename'];
    $newDescription = (string) ($asset['description'] ?? '');

    if (array_key_exists('originalFilename', $payload)) {
      $rawName = $payload['originalFilename'];
      if (!is_string($rawName)) {
        return $this->json(['error' => '"originalFilename" must be a string.'], 400);
      }
      $name = trim($rawName);
      if ($name === '') {
        return $this->json(['error' => 'Filename cannot be empty.'], 400);
      }
      if (preg_match('#[/\\\\\x00-\x1F]#', $name) === 1) {
        return $this->json(['error' => 'Filename contains invalid characters.'], 400);
      }
      $newName = mb_substr($name, 0, 255);
      $updates['original_filename'] = $newName;
    }

    if (array_key_exists('description', $payload)) {
      $rawDesc = $payload['description'];
      if ($rawDesc === NULL) {
        $newDescription = '';
      }
      elseif (is_string($rawDesc)) {
        $newDescription = mb_substr(trim($rawDesc), 0, 2000);
      }
      else {
        return $this->json(['error' => '"description" must be a string or null.'], 400);
      }
      $updates['description'] = $newDescription;
    }

    if (!empty($updates)) {
      $this->database->update('media_functionality_asset')
        ->fields($updates)
        ->condition('uuid', $uuid)
        ->execute();
    }

    return $this->json(['data' => [
      'uuid' => $uuid,
      'mediaType' => (string) $asset['media_type'],
      'mimeType' => (string) $asset['mime_type'],
      'originalFilename' => $newName,
      'description' => $newDescription,
      'fileSize' => (int) $asset['file_size'],
      'url' => $this->buildPublicUrl($uuid, (string) $asset['s3_key']),
    ]]);
  }

  /**
   * POST /api/study/media/{uuid}/describe-ai
   *
   * Owner-only. For an image asset, fetches the bytes from S3 and asks
   * Anthropic Claude (vision model) to write a 1-2 sentence description.
   * Does NOT persist anything — the frontend writes the description back
   * via the regular rename endpoint if the user keeps it.
   *
   * Audio assets are not supported (returns 415).
   */
  public function describeAi(string $uuid): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }
    $asset = $this->loadAsset($uuid);
    if ($asset === NULL || (int) $asset['owner_uid'] !== (int) $account->id()) {
      return $this->json(['error' => 'Not found'], 404);
    }
    if ((int) $asset['deleted'] === 1) {
      return $this->json(['error' => 'Asset has been deleted.'], 410);
    }
    if ((string) $asset['media_type'] !== 'image') {
      return $this->json(['error' => 'AI description is only available for images.'], 415);
    }

    try {
      $stream = $this->s3->getObjectStream((string) $asset['s3_key']);
    }
    catch (\RuntimeException $e) {
      return $this->json(['error' => $e->getMessage()], 502);
    }
    $bytes = (string) $stream->getContents();

    try {
      $description = $this->aiDescription->describeImage(
        $bytes,
        (string) $asset['mime_type'],
      );
    }
    catch (\RuntimeException $e) {
      return $this->json(['error' => $e->getMessage()], 502);
    }

    return $this->json(['data' => ['description' => $description]]);
  }

  /**
   * PATCH /api/study/media/bulk-delete
   *
   * Body: `{ "uuids": ["…", "…"] }`. Soft-deletes each asset the caller owns
   * (silently skipping unknown / already-deleted / not-owned uuids), then
   * returns `{ deleted: [...], skipped: [...] }`.
   *
   * Used by the entity-delete confirmation flow to clean up media files
   * that were exclusively referenced by the entity being deleted.
   */
  public function bulkDelete(Request $request): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $payload = json_decode((string) $request->getContent(), TRUE);
    $uuids = is_array($payload['uuids'] ?? NULL) ? $payload['uuids'] : NULL;
    if (!is_array($uuids)) {
      return $this->json(['error' => 'Body must include a "uuids" array.'], 400);
    }

    $deleted = [];
    $skipped = [];
    foreach ($uuids as $rawUuid) {
      $uuid = is_string($rawUuid) ? $rawUuid : '';
      if ($uuid === '') {
        continue;
      }
      $asset = $this->loadAsset($uuid);
      if ($asset === NULL
        || (int) $asset['owner_uid'] !== (int) $account->id()
        || (int) $asset['deleted'] === 1) {
        $skipped[] = $uuid;
        continue;
      }
      $this->performSoftDelete($asset);
      $deleted[] = $uuid;
    }

    return $this->json(['data' => ['deleted' => $deleted, 'skipped' => $skipped]]);
  }

  /**
   * GET /api/study/media/exclusive-for/{kind}/{uuid}
   *
   * Returns live (non-deleted) media assets that are referenced ONLY by the
   * given entity (and any sub-entities deleted alongside it — for `deck`
   * that means every flashcard whose `field_deck` is this deck). The
   * confirmation dialog uses this to offer "delete these orphan media too"
   * when the user deletes a note / deck / todo list.
   *
   * `kind` ∈ {`note`, `deck`, `todo_list`}.
   */
  public function exclusiveFor(string $kind, string $uuid): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $bundleByKind = [
      'note' => 'study_note',
      'deck' => 'flashcard_deck',
      'todo_list' => 'todo_list',
    ];
    if (!isset($bundleByKind[$kind])) {
      return $this->json(['error' => 'Unknown kind.'], 400);
    }
    $bundle = $bundleByKind[$kind];

    $nodeStorage = $this->entityTypeManager()->getStorage('node');
    $matches = $nodeStorage->loadByProperties(['uuid' => $uuid, 'type' => $bundle]);
    /** @var \Drupal\node\NodeInterface|null $node */
    $node = $matches ? reset($matches) : NULL;
    if ($node === NULL || (int) $node->getOwnerId() !== (int) $account->id()) {
      return $this->json(['error' => 'Not found'], 404);
    }

    $entities = [['entity_type' => 'node--' . $bundle, 'entity_uuid' => $uuid]];

    // Decks cascade-delete their flashcards (see study_flashcard_cascade
    // module), so any media referenced by those cards becomes orphan too.
    if ($kind === 'deck') {
      $cardIds = $nodeStorage->getQuery()
        ->accessCheck(FALSE)
        ->condition('type', 'flashcard')
        ->condition('field_deck', $node->id())
        ->execute();
      if (!empty($cardIds)) {
        foreach ($nodeStorage->loadMultiple($cardIds) as $card) {
          $entities[] = [
            'entity_type' => 'node--flashcard',
            'entity_uuid' => (string) $card->uuid(),
          ];
        }
      }
    }

    $exclusiveUuids = $this->usage->exclusiveAssetsForEntities($entities);
    if (empty($exclusiveUuids)) {
      return $this->json(['data' => []]);
    }

    $rows = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 's3_key', 'media_type', 'mime_type', 'original_filename', 'file_size'])
      ->condition('uuid', $exclusiveUuids, 'IN')
      ->condition('deleted', 0)
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);

    return $this->json(['data' => array_map(fn ($r) => [
      'uuid' => (string) $r['uuid'],
      'mediaType' => (string) $r['media_type'],
      'mimeType' => (string) $r['mime_type'],
      'originalFilename' => (string) $r['original_filename'],
      'fileSize' => (int) $r['file_size'],
      'url' => $this->buildPublicUrl((string) $r['uuid'], (string) $r['s3_key']),
    ], $rows)]);
  }

  /**
   * Soft-delete one asset row. Caller is responsible for owner / state
   * checks before invoking this.
   *
   * Returns the usage rows that existed at deletion time, so callers can
   * relay them back to the client if useful.
   *
   * @param array<string, mixed> $asset
   * @return array<int, array{entity_type: string, entity_uuid: string, entity_label: string}>
   */
  private function performSoftDelete(array $asset): array {
    $uuid = (string) $asset['uuid'];
    $mediaType = (string) $asset['media_type'];
    $usageRows = $this->usage->usageForAsset($uuid);
    $referencingEntities = $this->usage->entitiesReferencing($uuid);

    // Soft-delete in DB first; only then attempt the (best-effort) S3 delete.
    $now = \Drupal::time()->getRequestTime();
    $this->database->update('media_functionality_asset')
      ->fields(['deleted' => 1, 'deleted_at' => $now])
      ->condition('uuid', $uuid)
      ->execute();
    $this->s3->deleteObject((string) $asset['s3_key']);

    // Re-save every referencing entity so its presave hook recomputes
    // field_missing_media / field_has_attachments. For file-class assets
    // we *also* strip the markdown link from each body before saving, so
    // the user never sees a broken-link box for a file they just deleted
    // (image/audio keep the broken-icon flow because their content is
    // visually missing in a way a stripped link wouldn't convey).
    // Failures are swallowed so one bad row can't hide the asset
    // deletion from the caller.
    $this->propagateMissingMedia($referencingEntities, $mediaType === 'file' ? $uuid : NULL);

    return $usageRows;
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
   * Re-saves each referencing entity so hook_node_presave repopulates
   * field_missing_media / field_has_attachments.
   *
   * If `$stripFileUuid` is non-null, the markdown link form
   * `[name](/api/media/<uuid>...)` for that asset is removed from each
   * entity's body fields *before* save, so file deletions vanish cleanly
   * instead of leaving a broken-link box.
   *
   * Failures are logged but never propagated.
   *
   * @param array<int, array{entity_type: string, entity_uuid: string}> $rows
   */
  private function propagateMissingMedia(array $rows, ?string $stripFileUuid = NULL): void {
    if (empty($rows)) {
      return;
    }
    $logger = \Drupal::logger('media_functionality');
    $nodeStorage = $this->entityTypeManager()->getStorage('node');

    foreach ($rows as $row) {
      // Only node--<bundle> entries are propagated today; future paragraph
      // or other entity refs would be added here.
      if (!str_starts_with($row['entity_type'], 'node--')) {
        continue;
      }
      try {
        $matches = $nodeStorage->loadByProperties(['uuid' => $row['entity_uuid']]);
        $node = $matches ? reset($matches) : NULL;
        if ($node === NULL) {
          continue;
        }
        if ($stripFileUuid !== NULL) {
          $this->stripFileLinkFromNode($node, $stripFileUuid);
        }
        $node->save();
      }
      catch (\Throwable $e) {
        $logger->warning('Failed to propagate missing-media flag to @type @uuid: @msg', [
          '@type' => $row['entity_type'],
          '@uuid' => $row['entity_uuid'],
          '@msg' => $e->getMessage(),
        ]);
      }
    }
  }

  /**
   * Removes every markdown-link reference to the given asset UUID from
   * the body fields of a node (and, for todo lists, from each child
   * todo_item paragraph).
   *
   * Only the link form `[text](/api/media/<uuid>)` is targeted — image
   * embeds (`![alt](...)`) are left alone, since files are inserted as
   * links by the upload pipeline and embeds belong to image/audio assets
   * which use the broken-icon UI instead.
   */
  private function stripFileLinkFromNode(\Drupal\node\NodeInterface $node, string $assetUuid): void {
    switch ($node->bundle()) {
      case 'study_note':
        $this->stripFromPlainStringField($node, 'field_body', $assetUuid);
        break;

      case 'flashcard':
        $this->stripFromPlainStringField($node, 'field_front', $assetUuid);
        $this->stripFromPlainStringField($node, 'field_back', $assetUuid);
        break;

      case 'flashcard_deck':
        $this->stripFromTextWithSummaryField($node, 'body', $assetUuid);
        break;

      case 'todo_list':
        if ($node->hasField('field_items')) {
          foreach ($node->get('field_items')->referencedEntities() as $paragraph) {
            $changed = FALSE;
            foreach (['field_item_text', 'field_notes'] as $fieldName) {
              if (!$paragraph->hasField($fieldName) || $paragraph->get($fieldName)->isEmpty()) {
                continue;
              }
              $current = (string) $paragraph->get($fieldName)->value;
              $next = $this->stripFileLinkFromBody($current, $assetUuid);
              if ($next !== $current) {
                $paragraph->set($fieldName, $next);
                $changed = TRUE;
              }
            }
            if ($changed) {
              $paragraph->setNewRevision(TRUE);
              $paragraph->save();
            }
          }
        }
        break;
    }
  }

  /**
   * Strips file-link references from a plain string / string_long field.
   */
  private function stripFromPlainStringField(\Drupal\node\NodeInterface $node, string $fieldName, string $assetUuid): void {
    if (!$node->hasField($fieldName) || $node->get($fieldName)->isEmpty()) {
      return;
    }
    $current = (string) $node->get($fieldName)->value;
    $next = $this->stripFileLinkFromBody($current, $assetUuid);
    if ($next !== $current) {
      $node->set($fieldName, $next);
    }
  }

  /**
   * Strips file-link references from a text_with_summary field
   * (preserves format/summary metadata).
   */
  private function stripFromTextWithSummaryField(\Drupal\node\NodeInterface $node, string $fieldName, string $assetUuid): void {
    if (!$node->hasField($fieldName) || $node->get($fieldName)->isEmpty()) {
      return;
    }
    $first = $node->get($fieldName)->first();
    if ($first === NULL) {
      return;
    }
    $current = (string) ($first->value ?? '');
    $next = $this->stripFileLinkFromBody($current, $assetUuid);
    if ($next !== $current) {
      $node->set($fieldName, [
        'value' => $next,
        'summary' => $first->summary ?? '',
        'format' => $first->format ?? NULL,
      ]);
    }
  }

  /**
   * Removes every link-form reference to `/api/media/<uuid>(/filename)?`
   * from a markdown body string. Optional trailing newline is consumed
   * so whole-line links don't leave a blank gap behind.
   *
   * Image embeds (`![]()`) are explicitly skipped via a negative
   * lookbehind on `!` — files are always inserted as plain links by the
   * upload pipeline, so any `![](…)` form belongs to an image/audio
   * asset that uses the broken-icon flow instead.
   */
  private function stripFileLinkFromBody(string $body, string $assetUuid): string {
    if ($body === '' || stripos($body, $assetUuid) === FALSE) {
      return $body;
    }
    $escaped = preg_quote($assetUuid, '#');
    $pattern = '#(?<!\!)\[[^\]\n]*\]\(/api/media/' . $escaped . '(?:/[^)\s]*)?(?:\?[^)\s]*)?\)\n?#i';
    $next = preg_replace($pattern, '', $body);
    return is_string($next) ? $next : $body;
  }

  /**
   * Resolves a frontend URL for the entity referenced from the usage table.
   *
   * Flashcards don't have their own page in the SPA — clicking one takes
   * you to the parent deck. Todo lists likewise share a single index page
   * since per-list pages don't exist yet.
   */
  private function resolveFrontendUrl(string $entityType, string $entityUuid): ?string {
    return match ($entityType) {
      'node--study_note' => '/dashboard/notes/' . $entityUuid,
      'node--flashcard_deck' => '/dashboard/decks/' . $entityUuid,
      'node--flashcard' => $this->flashcardDeckUrl($entityUuid),
      'node--todo_list' => '/dashboard/todos',
      default => NULL,
    };
  }

  /**
   * Looks up the parent deck of a flashcard and returns its URL, or NULL
   * if the card was hard-deleted or has no deck reference.
   */
  private function flashcardDeckUrl(string $cardUuid): ?string {
    $matches = $this->entityTypeManager()->getStorage('node')
      ->loadByProperties(['uuid' => $cardUuid, 'type' => 'flashcard']);
    /** @var \Drupal\node\NodeInterface|null $card */
    $card = $matches ? reset($matches) : NULL;
    if ($card === NULL || !$card->hasField('field_deck') || $card->get('field_deck')->isEmpty()) {
      return NULL;
    }
    /** @var \Drupal\node\NodeInterface|null $deck */
    $deck = $card->get('field_deck')->entity;
    return $deck ? '/dashboard/decks/' . $deck->uuid() : NULL;
  }

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
    if (in_array($mime, self::ALLOWED_FILE_MIME, TRUE)) {
      return 'file';
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
      'pdf' => 'application/pdf',
      'txt' => 'text/plain',
      'md', 'markdown' => 'text/markdown',
      'csv' => 'text/csv',
      'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'doc' => 'application/msword',
      'xls' => 'application/vnd.ms-excel',
      'ppt' => 'application/vnd.ms-powerpoint',
      'odt' => 'application/vnd.oasis.opendocument.text',
      'ods' => 'application/vnd.oasis.opendocument.spreadsheet',
      'odp' => 'application/vnd.oasis.opendocument.presentation',
      'json' => 'application/json',
      'xml' => 'application/xml',
      'zip' => 'application/zip',
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
