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
   * 0.60 gives the search dialog a sensible "Related results" floor.
   *
   * NB: RAG retrieval intentionally uses a *lower* floor — see
   * `RagController::DEFAULT_RAG_SCORE_THRESHOLD` — because Claude is told
   * to refuse if the SOURCES dont actually answer the question, so
   * over-retrieval there is cheaper than under-retrieval.
   */
  public const DEFAULT_SCORE_THRESHOLD = 0.40;

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
   * @param bool $requireIncludeInRag
   *   When TRUE, drop any hit whose owning entity has `field_include_in_rag`
   *   set to FALSE. Flashcards inherit the flag from their parent deck.
   *   Used by the RAG controller to honour the per-entity opt-in.
   * @param array{area?: string, subject?: string, date_from?: int, date_to?: int} $filters
   *   Optional post-hydration predicates applied to the display entity
   *   (parent deck for flashcard hits). All keys are optional; missing
   *   keys mean "no filter on that dimension". UUIDs for taxonomy ids,
   *   Unix timestamps for the date range (inclusive bounds — see
   *   `matchesFilters`).
   *
   * @return array<int, SemanticHit>
   */
  public function findSimilar(
    array $queryVector,
    int $ownerUid,
    ?array $bundles = NULL,
    int $limit = 20,
    float $scoreThreshold = self::DEFAULT_SCORE_THRESHOLD,
    bool $requireIncludeInRag = FALSE,
    array $filters = [],
  ): array {
    // Over-fetch so the access filter + flashcard collapse can still
    // produce `$limit` results when some hits are dropped. RAG-only adds
    // include_in_rag; adding taxonomy/date filters narrows the funnel
    // further so we widen the pool again.
    $overFetch = $this->overFetchSize($limit, $requireIncludeInRag, $filters);
    $hits = $this->qdrant->search($queryVector, $ownerUid, $bundles, $overFetch, $scoreThreshold);
    return $this->resolveHits($hits, $limit, $requireIncludeInRag, $filters);
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
    bool $requireIncludeInRag = FALSE,
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

    $overFetch = $requireIncludeInRag
      ? max($limit * 5, $limit + 20)
      : max($limit * 3, $limit + 10);
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

    return $this->resolveHits($hits, $limit, $requireIncludeInRag);
  }

  /**
   * Hydrates a list of raw Qdrant hits into entity-backed SemanticHit objects,
   * applying entity access checks and the flashcard-to-deck collapse.
   *
   * When `$requireIncludeInRag` is TRUE, we additionally drop any hit whose
   * (post-collapse) display entity has `field_include_in_rag = FALSE`. We
   * read the live Drupal field instead of trusting the Qdrant payload so
   * the answer reflects the user toggling the flag instantly, with no
   * embedding-queue-lag window. The payload field still exists on new
   * upserts for future analytics / a potential Option A optimization.
   *
   * `$filters` applies the same Option-B treatment to taxonomy and date
   * predicates: we read the live Drupal field values rather than denormalising
   * them into the Qdrant payload, so editing an entitys area/subject takes
   * effect immediately without waiting for a re-embed.
   *
   * @param array<int, array{id: string, score: float, payload: array<string, mixed>}> $rawHits
   * @param array{area?: string, subject?: string, date_from?: int, date_to?: int} $filters
   * @return array<int, SemanticHit>
   */
  private function resolveHits(
    array $rawHits,
    int $limit,
    bool $requireIncludeInRag = FALSE,
    array $filters = [],
  ): array {
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

      // Honour the per-entity opt-in for RAG. `$entity` is the post-collapse
      // display entity (parent deck for flashcard hits), so this single
      // check correctly gates cards via their decks flag.
      if ($requireIncludeInRag && !$this->isIncludedInRag($entity)) {
        continue;
      }

      // Caller-supplied area / subject / date predicates. Same rule as
      // above: the check runs against the display entity, so flashcards
      // inherit their parent decks taxonomy automatically.
      if ($filters !== [] && !$this->matchesFilters($entity, $filters)) {
        continue;
      }

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

  /**
   * Reads the live `field_include_in_rag` value for a display entity.
   *
   * Missing field or empty value → bundle-default: notes default ON,
   * decks/todos default OFF. This mirrors the per-bundle config defaults
   * so legacy nodes that slipped through the backfill behave intuitively.
   */
  private function isIncludedInRag(EntityInterface $entity): bool {
    if (!$entity instanceof NodeInterface) {
      return FALSE;
    }
    if (!$entity->hasField('field_include_in_rag')) {
      return $entity->bundle() === 'study_note';
    }
    if ($entity->get('field_include_in_rag')->isEmpty()) {
      return $entity->bundle() === 'study_note';
    }
    return (bool) $entity->get('field_include_in_rag')->value;
  }

  /**
   * Picks an over-fetch size for the Qdrant call based on which
   * post-hydration filters are going to thin out the result set.
   *
   * Baseline (no filters, no RAG gate): `limit * 3` is generous enough to
   * absorb access drops and the flashcard-to-deck collapse.
   * RAG-only: `limit * 5` because the include_in_rag opt-in defaults to OFF
   * on decks/todos.
   * RAG + caller filters: `limit * 8` because each predicate compounds.
   *
   * @param array{area?: string, subject?: string, date_from?: int, date_to?: int} $filters
   */
  private function overFetchSize(int $limit, bool $requireIncludeInRag, array $filters): int {
    $hasFilters = $filters !== [];
    if ($requireIncludeInRag && $hasFilters) {
      return max($limit * 8, $limit + 40);
    }
    if ($requireIncludeInRag) {
      return max($limit * 5, $limit + 20);
    }
    if ($hasFilters) {
      return max($limit * 5, $limit + 20);
    }
    return max($limit * 3, $limit + 10);
  }

  /**
   * Applies the caller-supplied predicates (area / subject / date range)
   * to a hydrated display entity.
   *
   * - `area`: entity must reference the area term whose UUID matches.
   * - `subject`: entity must reference the subject term whose UUID matches.
   * - `date_from` / `date_to`: entity->getCreatedTime() must fall within
   *   the inclusive [from, to] window. Either bound may be omitted.
   *
   * Entities that lack a field referenced by a filter (e.g. a future bundle
   * with no `field_area`) are excluded — opting in by adding a field is
   * the right surface to enable filtering on it.
   *
   * @param array{area?: string, subject?: string, date_from?: int, date_to?: int} $filters
   */
  private function matchesFilters(EntityInterface $entity, array $filters): bool {
    if (!$entity instanceof NodeInterface) {
      return FALSE;
    }

    if (!empty($filters['area'])) {
      if (!$this->referencesTermUuid($entity, 'field_area', (string) $filters['area'])) {
        return FALSE;
      }
    }

    if (!empty($filters['subject'])) {
      if (!$this->referencesTermUuid($entity, 'field_subject', (string) $filters['subject'])) {
        return FALSE;
      }
    }

    if (isset($filters['date_from']) && $entity->getCreatedTime() < (int) $filters['date_from']) {
      return FALSE;
    }
    if (isset($filters['date_to']) && $entity->getCreatedTime() > (int) $filters['date_to']) {
      return FALSE;
    }

    return TRUE;
  }

  /**
   * TRUE iff `$entity` references a taxonomy term with the given UUID via
   * `$fieldName`. Missing / empty field → FALSE so the filter excludes
   * untagged entities, matching the "I asked for this area" expectation.
   */
  private function referencesTermUuid(NodeInterface $entity, string $fieldName, string $uuid): bool {
    if (!$entity->hasField($fieldName) || $entity->get($fieldName)->isEmpty()) {
      return FALSE;
    }
    foreach ($entity->get($fieldName)->referencedEntities() as $term) {
      if ($term->uuid() === $uuid) {
        return TRUE;
      }
    }
    return FALSE;
  }

}
