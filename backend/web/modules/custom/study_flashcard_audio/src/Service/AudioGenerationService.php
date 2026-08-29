<?php

declare(strict_types=1);

namespace Drupal\study_flashcard_audio\Service;

use Drupal\Component\Uuid\UuidInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\media_functionality\Service\S3Service;
use Drupal\media_functionality\Service\UsageTracker;
use Drupal\node\NodeInterface;
use Psr\Log\LoggerInterface;

/**
 * Generates TTS audio for a flashcard face via OpenAI and stores it as a
 * media_functionality_asset.
 */
class AudioGenerationService {

  private const TTS_API_URL = 'https://api.openai.com/v1/audio/speech';
  private const TTS_MODEL = 'gpt-4o-mini-tts';
  private const TTS_VOICE = 'alloy';
  private const TTS_RESPONSE_FORMAT = 'mp3';

  private LoggerInterface $logger;

  public function __construct(
    private readonly S3Service $s3,
    private readonly UsageTracker $usage,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly UuidInterface $uuidService,
    private readonly Connection $database,
    LoggerChannelFactoryInterface $loggerFactory,
  ) {
    $this->logger = $loggerFactory->get('study_flashcard_audio');
  }

  /**
   * Generates TTS audio for the specified face of a flashcard.
   *
   * @param string $cardUuid UUID of the flashcard node.
   * @param string $face 'front' or 'back'.
   * @return array{uuid: string, url: string}
   * @throws \RuntimeException
   */
  public function generate(string $cardUuid, string $face): array {
    $face = $face === 'back' ? 'back' : 'front';
    $node = $this->loadCard($cardUuid);
    if (!$node) {
      throw new \RuntimeException('Card not found: ' . $cardUuid);
    }

    $fieldName = $face === 'front' ? 'field_front' : 'field_back';
    $rawText = $node->hasField($fieldName) && !$node->get($fieldName)->isEmpty()
      ? (string) $node->get($fieldName)->value : '';
    if (trim($rawText) === '') {
      throw new \RuntimeException('Card face is empty - nothing to synthesize.');
    }

    $plainText = $this->stripMarkdown($rawText);
    if (trim($plainText) === '') {
      throw new \RuntimeException('Card face has no readable text after stripping markup.');
    }

    $audioBinary = $this->callTts($plainText);

    $userUuid = $this->resolveUserUuid($node);
    $assetUuid = $this->uuidService->generate();
    $filename = 'flashcard-' . substr($cardUuid, 0, 8) . '-' . $face . '.mp3';
    $s3Key = $this->s3->buildKey($userUuid, $assetUuid, $filename);
    $fileSize = strlen($audioBinary);

    $this->s3->putObject($s3Key, $audioBinary, 'audio/mpeg');

    $this->database->insert('media_functionality_asset')
      ->fields([
        'uuid' => $assetUuid,
        'owner_uid' => (int) $node->getOwnerId(),
        'media_type' => 'audio',
        'mime_type' => 'audio/mpeg',
        'original_filename' => $filename,
        'description' => sprintf(
          '%s audio for card %s (%s)',
          $face === 'front' ? 'Question' : 'Answer',
          $cardUuid,
          mb_substr($plainText, 0, 80)
        ),
        'file_size' => $fileSize,
        's3_key' => $s3Key,
        'deleted' => 0,
        'created' => time(),
      ])
      ->execute();

    $audioField = $face === 'front' ? 'field_front_audio' : 'field_back_audio';
    if ($node->hasField($audioField)) {
      $node->set($audioField, $assetUuid);
      $node->save();
    }

    $this->usage->syncForEntity(
      'node--flashcard',
      (string) $node->uuid(),
      (string) $node->getTitle(),
      "/api/media/{$assetUuid}"
    );

    $url = '/api/media/' . $assetUuid . '/file';

    $this->logger->notice('Generated audio @uuid for card @card @face', [
      '@uuid' => $assetUuid,
      '@card' => $cardUuid,
      '@face' => $face,
    ]);

    return ['uuid' => $assetUuid, 'url' => $url];
  }

  /**
   * Soft-deletes an audio asset and clears the reference on the card.
   *
   * @param string $assetUuid UUID of the media asset to delete.
   * @throws \RuntimeException
   */
  public function delete(string $assetUuid): void {
    $asset = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 's3_key', 'owner_uid'])
      ->condition('uuid', $assetUuid)
      ->condition('deleted', 0)
      ->execute()
      ->fetchAssoc();

    if (!$asset) {
      throw new \RuntimeException('Audio asset not found or already deleted: ' . $assetUuid);
    }

    $this->database->update('media_functionality_asset')
      ->fields(['deleted' => 1])
      ->condition('uuid', $assetUuid)
      ->execute();

    if (!empty($asset['s3_key'])) {
      try {
        $this->s3->deleteObject($asset['s3_key']);
      }
      catch (\Exception $e) {
        $this->logger->warning('S3 delete failed for @key: @msg', [
          '@key' => $asset['s3_key'],
          '@msg' => $e->getMessage(),
        ]);
      }
    }

    $query = $this->database->select('node__field_front_audio', 'fa')
      ->fields('fa', ['entity_id'])
      ->condition('fa.field_front_audio_value', $assetUuid);
    $query2 = $this->database->select('node__field_back_audio', 'ba')
      ->fields('ba', ['entity_id'])
      ->condition('ba.field_back_audio_value', $assetUuid);
    $nids = array_unique(array_merge(
      $query->execute()->fetchCol(),
      $query2->execute()->fetchCol()
    ));

    foreach ($nids as $nid) {
      $node = $this->entityTypeManager->getStorage('node')->load((int) $nid);
      if ($node) {
        if ($node->hasField('field_front_audio') &&
            (string) $node->get('field_front_audio')->value === $assetUuid) {
          $node->set('field_front_audio', '');
        }
        if ($node->hasField('field_back_audio') &&
            (string) $node->get('field_back_audio')->value === $assetUuid) {
          $node->set('field_back_audio', '');
        }
        $node->save();
      }
    }

    $this->logger->notice('Soft-deleted audio asset @uuid and cleared card references', [
      '@uuid' => $assetUuid,
    ]);
  }

  /**
   * Lists all audio assets for the current user with card context.
   */
  public function listForUser(int $ownerUid): array {
    $rows = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid', 'original_filename', 'description', 'file_size', 'created'])
      ->condition('a.owner_uid', $ownerUid)
      ->condition('a.media_type', 'audio')
      ->condition('a.deleted', 0)
      ->orderBy('a.created', 'DESC')
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);

    $results = [];
    foreach ($rows as $row) {
      $uuid = (string) $row['uuid'];
      $cardInfo = $this->resolveCardContext($uuid);
      $results[] = [
        'uuid' => $uuid,
        'originalFilename' => (string) $row['original_filename'],
        'description' => (string) $row['description'],
        'fileSize' => (int) $row['file_size'],
        'created' => (int) $row['created'],
        'deleted' => (int) $row['deleted'],
        'card' => $cardInfo,
      ];
    }
    return $results;
  }

  private function resolveCardContext(string $assetUuid): ?array {
    $query = $this->database->select('node__field_front_audio', 'fa')
      ->fields('fa', ['entity_id'])
      ->condition('fa.field_front_audio_value', $assetUuid);
    $nid = $query->execute()->fetchField();
    $face = 'front';
    if (!$nid) {
      $query = $this->database->select('node__field_back_audio', 'ba')
        ->fields('ba', ['entity_id'])
        ->condition('ba.field_back_audio_value', $assetUuid);
      $nid = $query->execute()->fetchField();
      $face = 'back';
    }
    if (!$nid) return NULL;

    $card = $this->entityTypeManager->getStorage('node')->load((int) $nid);
    if (!$card || $card->bundle() !== 'flashcard') return NULL;

    $deckUuid = '';
    $deckTitle = '';
    if ($card->hasField('field_deck') && !$card->get('field_deck')->isEmpty()) {
      $deck = $card->get('field_deck')->referencedEntities()[0] ?? NULL;
      if ($deck) {
        $deckUuid = (string) $deck->uuid();
        $deckTitle = (string) $deck->getTitle();
      }
    }

    return [
      'cardUuid' => (string) $card->uuid(),
      'cardTitle' => mb_substr((string) $card->getTitle(), 0, 255),
      'face' => $face,
      'deckUuid' => $deckUuid,
      'deckTitle' => $deckTitle,
    ];
  }

  private function loadCard(string $uuid): ?NodeInterface {
    $nids = $this->entityTypeManager->getStorage('node')
      ->getQuery()->accessCheck(FALSE)
      ->condition('type', 'flashcard')
      ->condition('uuid', $uuid)->range(0, 1)->execute();
    if (empty($nids)) return NULL;
    return $this->entityTypeManager->getStorage('node')->load(reset($nids));
  }

  private function stripMarkdown(string $text): string {
    $text = preg_replace('#\[([^\]]*)\]\(/api/media/[^)]+\)#', '$1', $text);
    $text = preg_replace('#/api/media/[0-9a-f\-]{36}#i', '', $text);
    $text = preg_replace('#!\[([^\]]*)\]\([^)]+\)#', '$1', $text);
    $text = preg_replace('#\[([^\]]*)\]\([^)]+\)#', '$1', $text);
    $text = preg_replace('#[*_~]{1,2}#', '', $text);
    $text = preg_replace('#```[a-z]*\n.*?\n```#s', '', $text);
    $text = preg_replace('#`([^`]+)`#', '$1', $text);
    $text = preg_replace('/\s+/', ' ', $text);
    return trim($text);
  }

  private function callTts(string $text): string {
    $apiKey = getenv('OPENAI_API_KEY');
    if (empty($apiKey)) {
      throw new \RuntimeException(
        'OPENAI_API_KEY is not configured. '
        . 'Set it in backend/.ddev/config.local.yaml (local) '
        . 'or backend/.env (production) and restart.'
      );
    }

    $payload = json_encode([
      'model' => \Drupal\study_flashcard_audio\Service\AudioGenerationService::TTS_MODEL,
      'voice' => \Drupal\study_flashcard_audio\Service\AudioGenerationService::TTS_VOICE,
      'input' => $text,
      'response_format' => \Drupal\study_flashcard_audio\Service\AudioGenerationService::TTS_RESPONSE_FORMAT,
    ]);

    $ch = curl_init(\Drupal\study_flashcard_audio\Service\AudioGenerationService::TTS_API_URL);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => TRUE,
      CURLOPT_POST => TRUE,
      CURLOPT_POSTFIELDS => $payload,
      CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey,
      ],
      CURLOPT_TIMEOUT => 30,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    if ($curlError) {
      $this->logger->error('OpenAI TTS curl error: @error', ['@error' => $curlError]);
      throw new \RuntimeException('Network error contacting OpenAI TTS API.');
    }

    if ($httpCode === 200 && $contentType === 'audio/mpeg') {
      return $response;
    }

    $decoded = json_decode($response, TRUE);
    $errorMsg = $decoded['error']['message'] ?? $response;
    $this->logger->error('OpenAI TTS API error @code: @msg', [
      '@code' => $httpCode,
      '@msg' => is_string($errorMsg) ? $errorMsg : 'Unknown error',
    ]);
    throw new \RuntimeException('OpenAI TTS API returned an error (HTTP ' . $httpCode . ').');
  }

  private function resolveUserUuid(NodeInterface $node): string {
    $uid = (int) $node->getOwnerId();
    $user = $this->entityTypeManager->getStorage('user')->load($uid);
    return $user ? (string) $user->uuid() : '';
  }

}
