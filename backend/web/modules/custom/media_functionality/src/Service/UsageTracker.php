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

  /**
   * Returns the subset of $uuids that point at soft-deleted assets.
   *
   * Used by the presave hook to recompute field_missing_media — empty
   * result means the entity is currently referencing only live assets.
   *
   * @param array<int, string> $uuids
   * @return array<int, string>
   */
  public function deletedAmong(array $uuids): array {
    if (empty($uuids)) {
      return [];
    }
    $rows = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid'])
      ->condition('uuid', $uuids, 'IN')
      ->condition('deleted', 1)
      ->execute()
      ->fetchCol();
    return array_values(array_map('strval', $rows));
  }

  /**
   * Returns asset UUIDs that are referenced ONLY by the given (entity_type,
   * entity_uuid) pairs — i.e. media that would become orphan if those
   * entities were deleted. Used by the cascade-delete confirmation flow.
   *
   * Excludes assets that are already soft-deleted (caller doesn't need to
   * re-delete them).
   *
   * @param array<int, array{entity_type: string, entity_uuid: string}> $entities
   * @return array<int, string>
   */
  public function exclusiveAssetsForEntities(array $entities): array {
    if (empty($entities)) {
      return [];
    }

    // Step 1: every asset referenced by any of the given entities.
    $assetSet = [];
    foreach ($entities as $pair) {
      $rows = $this->database->select('media_functionality_usage', 'u')
        ->fields('u', ['asset_uuid'])
        ->condition('entity_type', $pair['entity_type'])
        ->condition('entity_uuid', $pair['entity_uuid'])
        ->execute()
        ->fetchCol();
      foreach ($rows as $uuid) {
        $assetSet[(string) $uuid] = TRUE;
      }
    }
    if (empty($assetSet)) {
      return [];
    }
    $candidateUuids = array_keys($assetSet);

    // Step 2: among those assets, find any that have a referencing row OUTSIDE
    // the given entity set. Those are not exclusive.
    $allRefs = $this->database->select('media_functionality_usage', 'u')
      ->fields('u', ['asset_uuid', 'entity_type', 'entity_uuid'])
      ->condition('asset_uuid', $candidateUuids, 'IN')
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);

    $exclusion = [];
    foreach ($entities as $pair) {
      $exclusion[$pair['entity_type'] . '|' . $pair['entity_uuid']] = TRUE;
    }

    $sharedAssets = [];
    foreach ($allRefs as $row) {
      $key = $row['entity_type'] . '|' . $row['entity_uuid'];
      if (!isset($exclusion[$key])) {
        $sharedAssets[(string) $row['asset_uuid']] = TRUE;
      }
    }

    $exclusive = array_values(array_diff($candidateUuids, array_keys($sharedAssets)));
    if (empty($exclusive)) {
      return [];
    }

    // Step 3: drop any already-soft-deleted assets — the caller would gain
    // nothing by re-deleting them.
    $live = $this->database->select('media_functionality_asset', 'a')
      ->fields('a', ['uuid'])
      ->condition('uuid', $exclusive, 'IN')
      ->condition('deleted', 0)
      ->execute()
      ->fetchCol();

    return array_values(array_map('strval', $live));
  }

  /**
   * Returns the distinct (entity_type, entity_uuid) pairs that reference
   * the given asset — used to know which entities to re-save when a media
   * file is soft-deleted, so each one's field_missing_media gets populated.
   *
   * @return array<int, array{entity_type: string, entity_uuid: string}>
   */
  public function entitiesReferencing(string $assetUuid): array {
    $rows = $this->database->select('media_functionality_usage', 'u')
      ->fields('u', ['entity_type', 'entity_uuid'])
      ->condition('asset_uuid', $assetUuid)
      ->distinct()
      ->execute()
      ->fetchAll(\PDO::FETCH_ASSOC);
    return array_map(static fn ($r) => [
      'entity_type' => (string) $r['entity_type'],
      'entity_uuid' => (string) $r['entity_uuid'],
    ], $rows);
  }

}
