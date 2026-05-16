<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\node\NodeInterface;
use Psr\Log\LoggerInterface;

/**
 * Shared retrieval primitive used by the semantic search endpoint, the
 * "find related" endpoint, and the RAG controller.
 *
 * Each public method ultimately returns *hydrated entities* (not raw
 * Qdrant point ids), with entity access already enforced. That is the
 * single invariant callers depend on:
 *
 *   "If the service handed you back the entity, you can read it."
 *
 * Why we re-check access even though the Qdrant payload already filters
 * by owner_uid:
 *
 *   - Owners can change (entities re-saved with a new uid, future sharing
 *     features, etc). The MySQL row + Qdrant payload can lag behind by
 *     one queue cycle.
 *   - Drupal access hooks may forbid an entity for reasons we dont mirror
 *     into Qdrant (node grants, publication state, custom modules…).
 *
 * Loading through entity storage and asking $entity->access('view') is
 * the only safe primitive — so we do.
 */
class SemanticSearchService {

  /**
   * Default minimum score for a hit to be considered relevant.
   *
   * Voyage cosine scores are in [-1, 1]; in practice anything above ~0.55
   * on this corpus is meaningfully related, anything below ~0.45 is noise.
   * 0.60 gives the search dialog a sensible "Related results" floor and
   * still lets RAG see decent context.
   */
  public const DEFAULT_SCORE_THRESHOLD = 0.60;

  private LoggerInterface $logger;

  public function __construct(
    private readonly QdrantClient $qdrant,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    LoggerChannelFactoryInterface $loggerFactory,
  ) {
    $this->logger = $loggerFactory->get('study_semantic');
  }

  /**
   * Finds entities similar to a query vector.
   *
   * @param array<int, float> $queryVector
   * @param int $ownerUid
   * @param array<int, string>|null $bundles
   *   Bundle ids to keep, or NULL for "all embedded bundles". Bundles can
   *   include `flashcard`; the service collapses card hits to their parent
   *   deck for callers but exposes the original card id in `card_id` /
   *   `card_uuid`.
   * @param int $limit
   * @param float $scoreThreshold
   *
   * @return array<int, SemanticHit>
   */
  public function findSimilar(
    array $queryVector,
    int $ownerUid,
    ?array $bundles = NULL,
    int $limit = 20,
    float $scoreThreshold = self::DEFAULT_SCORE_THRESHOLD,
  ): array {
    // Over-fetch a bit so that the access filter + flashcard collapse can
    // still produce `$limit` results when some hits are dropped.
    $overFetch = max($limit * 3, $limit + 10);
    $hits = $this->qdrant->search($queryVector, $ownerUid, $bundles, $overFetch, $scoreThreshold);
    return $this->resolveHits($hits, $limit);
  }

  /**
   * Finds entities similar to an existing entity, using its stored vector.
   *
   * Returns hits that exclude the seed itself.
   *
   * @return array<int, SemanticHit>
   */
  public function findSimilarByEntity(
    EntityInterface $seed,
    int $ownerUid,
    ?array $bundles = NULL,
    int $limit = 10,
    float $scoreThreshold = self::DEFAULT_SCORE_THRESHOLD,
  ): array {
    $row = $this->database->select('content_embeddings', 'ce')
      ->fields('ce', ['entity_uuid'])
      ->condition('entity_type', $seed->getEntityTypeId())
      ->condition('entity_id', (int) $seed->id())
      ->execute()
      ->fetchAssoc();

    if (!$row || empty($row['entity_uuid'])) {
      // Seed hasnt been embedded yet — nothing useful to return.
      return [];
    }

    $overFetch = max($limit * 3, $limit + 10);
    $hits = $this->qdrant->recommend(
      [(string) $row['entity_uuid']],
      $ownerUid,
      $bundles,
      $overFetch,
      $scoreThreshold,
    );

    // Filter the seed itself out in case Qdrant returns it.
    $seedUuid = (string) $row['entity_uuid'];
    $hits = array_values(array_filter($hits, static fn (array $h): bool => $h['id'] !== $seedUuid));

    return $this->resolveHits($hits, $limit);
  }

  /**
   * Hydrates a list of raw Qdrant hits into entity-backed SemanticHit objects,
   * applying entity access checks and the flashcard-to-deck collapse.
   *
   * @param array<int, array{id: string, score: float, payload: array<string, mixed>}> $rawHits
   * @return array<int, SemanticHit>
   */
  private function resolveHits(array $rawHits, int $limit): array {
    if ($rawHits === []) {
      return [];
    }

    // Group hits by entity_type so we can do one loadMultiple per type.
    $byType = [];
    foreach ($rawHits as $hit) {
      $entityType = (string) ($hit['payload']['entity_type'] ?? 'node');
      $entityUuid = $hit['id'];
      $byType[$entityType][$entityUuid] = $hit;
    }

    /** @var array<string, array<string, EntityInterface>> $loaded */
    $loaded = [];
    foreach ($byType as $entityType => $hits) {
      try {
        $storage = $this->entityTypeManager->getStorage($entityType);
      }
      catch (\Throwable $e) {
        $this->logger->warning('Unknown entity_type "@t" in Qdrant payload; skipping.', ['@t' => $entityType]);
        continue;
      }
      $entities = $storage->loadByProperties(['uuid' => array_keys($hits)]);
      foreach ($entities as $entity) {
        $loaded[$entityType][$entity->uuid()] = $entity;
      }
    }

    // Walk hits in score order (Qdrant already sorts), collapse flashcards
    // to their parent deck, run access checks, and stop once we have $limit.
    $results = [];
    $seenKey = [];
    foreach ($rawHits as $hit) {
      $entityType = (string) ($hit['payload']['entity_type'] ?? 'node');
      $entityUuid = $hit['id'];
      $entity = $loaded[$entityType][$entityUuid] ?? NULL;
      if (!$entity instanceof EntityInterface) {
        continue;
      }
      if (!$entity->access('view')) {
        continue;
      }

      $cardEntity = NULL;
      $cardScore = NULL;

      // Collapse flashcard hits to their parent deck while remembering
      // the original card for citation purposes.
      if ($entity instanceof NodeInterface && $entity->bundle() === 'flashcard') {
        if ($entity->hasField('field_deck') && !$entity->get('field_deck')->isEmpty()) {
          /** @var \Drupal\node\NodeInterface|null $deck */
          $deck = $entity->get('field_deck')->entity;
          if ($deck instanceof NodeInterface && $deck->access('view')) {
            $cardEntity = $entity;
            $cardScore = (float) $hit['score'];
            $entity = $deck;
          }
          else {
            continue;
          }
        }
        else {
          continue;
        }
      }

      $key = $entity->getEntityTypeId() . ':' . $entity->id();
      if (isset($seenKey[$key])) {
        // A later, lower-scoring card from the same deck — skip.
        continue;
      }
      $seenKey[$key] = TRUE;

      $results[] = new SemanticHit(
        entity: $entity,
        score: (float) $hit['score'],
        cardEntity: $cardEntity,
        cardScore: $cardScore,
      );
      if (count($results) >= $limit) {
        break;
      }
    }

    return $results;
  }

}
