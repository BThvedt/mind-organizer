<?php

declare(strict_types=1);

namespace Drupal\media_functionality\Service;

use Drupal\Core\Database\Connection;

/**
 * Reads asset references out of free-form text (markdown bodies, eventually
 * flashcard fronts/backs) and keeps the media_functionality_usage table
 * in sync per (asset, entity) pair.
 *
 * "References" are URLs of the form `/api/media/<uuid>` — the logical
 * frontend form. We never store raw S3 URLs in entity bodies, so this
 * regex is the single source of truth for what counts as "used".
 */
class UsageTracker {

  /**
   * Matches /api/media/<uuid> in note bodies. Uuid pattern intentionally
   * permissive (any hex/dash run) — the actual asset row is the source of
   * truth, this just identifies *candidates*.
   */
  private const REFERENCE_PATTERN = '#/api/media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})#i';

  public function __construct(private readonly Connection $database) {}

  /**
   * Extracts asset UUIDs referenced from a piece of text.
   *
   * @return array<int, string>
   */
  public function extractAssetUuids(string $text): array {
    if ($text === '') {
      return [];
    }
    if (!preg_match_all(self::REFERENCE_PATTERN, $text, $matches)) {
      return [];
    }
    return array_values(array_unique(array_map('strtolower', $matches[1])));
  }

  /**
   * Replaces the usage rows for a single entity to exactly match the asset
   * UUIDs referenced in the supplied text.
   *
   * Safe to call repeatedly with the same input (idempotent).
   */
  public function syncForEntity(string $entityType, string $entityUuid, string $entityLabel, string $text): void {
    $wantedUuids = $this->extractAssetUuids($text);

    // Pull the existing set so we only INSERT/DELETE diffs (cheaper, and
    // avoids dropping unique-key rows that haven't changed).
    $existing = $this->database->select('media_functionality_usage', 'u')
      ->fields('u', ['asset_uuid'])
      ->condition('entity_type', $entityType)
      ->condition('entity_uuid', $entityUuid)
      ->execute()
      ->fetchCol();
    $existing = array_map('strval', $existing);

    $toAdd = array_diff($wantedUuids, $existing);
    $toRemove = array_diff($existing, $wantedUuids);

    if (!empty($toRemove)) {
      $this->database->delete('media_functionality_usage')
        ->condition('entity_type', $entityType)
        ->condition('entity_uuid', $entityUuid)
        ->condition('asset_uuid', $toRemove, 'IN')
        ->execute();
    }

    foreach ($toAdd as $assetUuid) {
      try {
        $this->database->insert('media_functionality_usage')
          ->fields([
            'asset_uuid' => $assetUuid,
            'entity_type' => $entityType,
            'entity_uuid' => $entityUuid,
            'entity_label' => mb_substr($entityLabel, 0, 255),
          ])
          ->execute();
      }
      catch (\Exception) {
        // Unique key violation = row already exists from a concurrent save.
        // Fall through to label refresh below.
      }
    }

    // Refresh the denormalized label on the rows that survived (cheap).
    if (!empty($wantedUuids)) {
      $this->database->update('media_functionality_usage')
        ->fields(['entity_label' => mb_substr($entityLabel, 0, 255)])
        ->condition('entity_type', $entityType)
        ->condition('entity_uuid', $entityUuid)
        ->condition('asset_uuid', $wantedUuids, 'IN')
        ->execute();
    }
  }

  /**
   * Removes all usage rows tied to a deleted entity.
   */
  public function removeForEntity(string $entityType, string $entityUuid): void {
    $this->database->delete('media_functionality_usage')
      ->condition('entity_type', $entityType)
      ->condition('entity_uuid', $entityUuid)
      ->execute();
  }

  /**
   * Returns rows that reference this asset.
   *
   * @return array<int, array{entity_type: string, entity_uuid: string, entity_label: string}>
   */
  public function usageForAsset(string $assetUuid): array {
    $rows = $this->database->select('media_functionality_usage', 'u')
      ->fields('u', ['entity_type', 'entity_uuid', 'entity_label'])
      ->condition('asset_uuid', $assetUuid)
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);
    return array_map(static fn ($r) => [
      'entity_type' => (string) $r['entity_type'],
      'entity_uuid' => (string) $r['entity_uuid'],
      'entity_label' => (string) $r['entity_label'],
    ], $rows);
  }

}
