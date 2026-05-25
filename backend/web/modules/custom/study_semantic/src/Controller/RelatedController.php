<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\node\NodeInterface;
use Drupal\study_semantic\Service\EmbeddingException;
use Drupal\study_semantic\Service\SemanticHit;
use Drupal\study_semantic\Service\SemanticSearchService;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Handles GET /api/search/related/{type}/{uuid} — "More like this".
 *
 * Powers the related-items widget on note/deck/todo detail pages. Uses
 * `SemanticSearchService::findSimilarByEntity()` (Qdrant Recommend API)
 * with `requireIncludeInRag: FALSE` — recommendations should surface
 * anything the user owns, regardless of the per-entity RAG opt-in.
 *
 * URL types map to bundles using the same labels the search dialog uses:
 *
 *   note → study_note
 *   deck → flashcard_deck
 *   todo → todo_list
 *
 * Response shape mirrors `SemanticSearchController::serialiseHit()` so the
 * frontend can reuse one rendering primitive across search and related.
 */
class RelatedController extends ControllerBase implements ContainerInjectionInterface {

  /**
   * URL `type` segment → seed entity bundle.
   */
  private const TYPE_TO_BUNDLE = [
    'note' => 'study_note',
    'deck' => 'flashcard_deck',
    'todo' => 'todo_list',
  ];

  /** Max related items the endpoint will return per request. */
  private const MAX_LIMIT = 12;

  /** Default related items count when the caller doesnt specify. */
  private const DEFAULT_LIMIT = 6;

  /** Mirrors SemanticSearchService::DEFAULT_SCORE_THRESHOLD. */
  private const DEFAULT_SCORE_THRESHOLD = 0.60;

  private const MIN_SCORE_THRESHOLD = 0.0;
  private const MAX_SCORE_THRESHOLD = 0.95;

  public function __construct(
    private readonly SemanticSearchService $semantic,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('study_semantic.search'),
    );
  }

  public function related(Request $request, string $type, string $uuid): JsonResponse {
    $bundle = self::TYPE_TO_BUNDLE[$type] ?? NULL;
    if ($bundle === NULL) {
      return new JsonResponse(['error' => 'Unknown content type.'], 400);
    }

    // Locate the seed entity by UUID. We deliberately load through the
    // node storage so Drupal access hooks fire — only the owner (or admin)
    // can see related items for their own content.
    //
    // NB: `$this->entityTypeManager()` is the lazy accessor on
    // ControllerBase; using it (instead of injecting the service) avoids
    // a readonly-vs-non-readonly inheritance clash with the parent classs
    // own `$entityTypeManager` property.
    $storage = $this->entityTypeManager()->getStorage('node');
    $candidates = $storage->loadByProperties(['uuid' => $uuid]);
    $seed = reset($candidates);
    if (!$seed instanceof NodeInterface || $seed->bundle() !== $bundle) {
      return new JsonResponse(['error' => 'Not found.'], 404);
    }
    if (!$seed->access('view')) {
      // Treat as 404 to avoid leaking existence.
      return new JsonResponse(['error' => 'Not found.'], 404);
    }

    $limit = $this->resolveLimit($request->query->get('limit'));
    $scoreThreshold = $this->resolveScoreThreshold($request->query->get('score_threshold'));
    $ownerUid = (int) $this->currentUser()->id();

    try {
      $hits = $this->semantic->findSimilarByEntity(
        $seed,
        $ownerUid,
        bundles: NULL,
        limit: $limit,
        scoreThreshold: $scoreThreshold,
        requireIncludeInRag: FALSE,
      );
    }
    catch (EmbeddingException $e) {
      $code = $e->isTransient() ? 503 : 500;
      return new JsonResponse(['error' => 'Recommendation failed: ' . $e->getMessage()], $code);
    }

    $results = array_map([$this, 'serialiseHit'], $hits);
    return new JsonResponse([
      'results' => $results,
      'total' => count($results),
    ]);
  }

  /**
   * Normalises the `limit` query param into [1, MAX_LIMIT] with a default.
   */
  private function resolveLimit(mixed $raw): int {
    if (!is_string($raw) || $raw === '') {
      return self::DEFAULT_LIMIT;
    }
    $n = (int) $raw;
    if ($n < 1) {
      return self::DEFAULT_LIMIT;
    }
    return min(self::MAX_LIMIT, $n);
  }

  /**
   * Normalises the `score_threshold` query param into [MIN, MAX] with a default.
   */
  private function resolveScoreThreshold(mixed $raw): float {
    if (!is_string($raw) || $raw === '') {
      return self::DEFAULT_SCORE_THRESHOLD;
    }
    $v = (float) $raw;
    return max(self::MIN_SCORE_THRESHOLD, min(self::MAX_SCORE_THRESHOLD, $v));
  }

  /**
   * Same shape as the semantic search controller, including the optional
   * `card` block for flashcard hits collapsed to their parent deck.
   *
   * @return array<string, mixed>
   */
  private function serialiseHit(SemanticHit $hit): array {
    /** @var \Drupal\node\NodeInterface $node */
    $node = $hit->entity;

    $areas = [];
    if ($node->hasField('field_area') && !$node->get('field_area')->isEmpty()) {
      foreach ($node->get('field_area')->referencedEntities() as $term) {
        $areas[] = ['uuid' => $term->uuid(), 'name' => $term->getName()];
      }
    }

    $subjects = [];
    if ($node->hasField('field_subject') && !$node->get('field_subject')->isEmpty()) {
      foreach ($node->get('field_subject')->referencedEntities() as $term) {
        $subjects[] = ['uuid' => $term->uuid(), 'name' => $term->getName()];
      }
    }

    $row = [
      'uuid' => $node->uuid(),
      'type' => $node->bundle(),
      'title' => $node->getTitle(),
      'areas' => $areas,
      'subjects' => $subjects,
      'score' => round($hit->score, 4),
    ];

    if ($hit->cardEntity instanceof NodeInterface) {
      $card = $hit->cardEntity;
      $row['card'] = [
        'uuid' => $card->uuid(),
        'front' => $card->hasField('field_front') ? (string) $card->get('field_front')->value : '',
        'back' => $card->hasField('field_back') ? (string) $card->get('field_back')->value : '',
        'score' => $hit->cardScore !== NULL ? round($hit->cardScore, 4) : NULL,
      ];
    }

    return $row;
  }

}
