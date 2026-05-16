<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\node\NodeInterface;
use Drupal\study_semantic\Service\EmbeddingClient;
use Drupal\study_semantic\Service\EmbeddingException;
use Drupal\study_semantic\Service\SemanticHit;
use Drupal\study_semantic\Service\SemanticSearchService;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Handles POST /api/search/semantic.
 *
 * Request body:
 *   {
 *     "query":  "natural language query string",
 *     "types":  ["note","deck","todo"],   // optional, same labels the keyword endpoint accepts
 *     "limit":  20                          // optional, 1..50
 *   }
 *
 * Response (intentionally mirrors the keyword search shape, with `score` added):
 *   {
 *     "results": [
 *       {
 *         "uuid":     "<node-uuid>",
 *         "type":     "study_note" | "flashcard_deck" | "todo_list",
 *         "title":    "...",
 *         "areas":    [ { "uuid": "...", "name": "..." } ],
 *         "subjects": [ { "uuid": "...", "name": "..." } ],
 *         "score":    0.87,
 *         "card": {                         // present only when a flashcard hit collapsed to its parent deck
 *           "uuid": "...",
 *           "front": "...",
 *           "back":  "..."
 *         }
 *       }
 *     ],
 *     "total": <int>
 *   }
 *
 * Why POST instead of GET: queries can be long natural-language questions
 * that arent comfortable in URL query strings, and we anticipate adding
 * more shaped filters in future. JSON in / JSON out, no caching.
 */
class SemanticSearchController extends ControllerBase implements ContainerInjectionInterface {

  /**
   * The same "filter label → bundle list" mapping the keyword controller uses,
   * so the frontend type chips work identically for both endpoints.
   */
  private const FILTER_TO_BUNDLES = [
    'note' => ['study_note'],
    // Deck searches consider the deck itself AND its child flashcards;
    // flashcard hits get collapsed to their parent deck by the service.
    'deck' => ['flashcard_deck', 'flashcard'],
    'todo' => ['todo_list'],
  ];

  /**
   * All embeddable bundles when no filter is provided.
   */
  private const ALL_BUNDLES = ['study_note', 'flashcard_deck', 'flashcard', 'todo_list'];

  public function __construct(
    private readonly EmbeddingClient $embedding,
    private readonly SemanticSearchService $semantic,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('study_semantic.embedding_client'),
      $container->get('study_semantic.search'),
    );
  }

  public function search(Request $request): JsonResponse {
    $payload = json_decode((string) $request->getContent(), TRUE);
    if (!is_array($payload)) {
      return new JsonResponse(['error' => 'Request body must be valid JSON.'], 400);
    }

    $query = isset($payload['query']) && is_string($payload['query']) ? trim($payload['query']) : '';
    if (mb_strlen($query) < 2) {
      // Match keyword endpoint behavior: too short = empty result, not error.
      return new JsonResponse(['results' => [], 'total' => 0]);
    }

    $limit = isset($payload['limit']) && is_int($payload['limit'])
      ? max(1, min(50, $payload['limit']))
      : 20;

    $bundles = $this->resolveBundles($payload['types'] ?? NULL);
    $ownerUid = (int) $this->currentUser()->id();

    // 1) Embed the query string ("query" input type for asymmetric retrieval).
    try {
      $vector = $this->embedding->embed($query, 'query');
    }
    catch (EmbeddingException $e) {
      // Permanent client/config error → 500 with a hint; transient → 503.
      $code = $e->isTransient() ? 503 : 500;
      return new JsonResponse(['error' => 'Could not embed query: ' . $e->getMessage()], $code);
    }

    // 2) Retrieve top-N hits (the service handles access checks + flashcard→deck collapse).
    try {
      $hits = $this->semantic->findSimilar($vector, $ownerUid, $bundles, $limit);
    }
    catch (EmbeddingException $e) {
      $code = $e->isTransient() ? 503 : 500;
      return new JsonResponse(['error' => 'Semantic search failed: ' . $e->getMessage()], $code);
    }

    // 3) Shape each hit into the same JSON the keyword endpoint produces.
    $results = [];
    foreach ($hits as $hit) {
      $results[] = $this->serialiseHit($hit);
    }

    return new JsonResponse([
      'results' => $results,
      'total' => count($results),
    ]);
  }

  /**
   * Resolves the frontends `types` filter list to the bundle ids the service
   * understands. Unknown / missing → all bundles.
   *
   * @param mixed $rawTypes
   * @return array<int, string>|null
   *   NULL when no filter is applied (the service interprets that as "all").
   */
  private function resolveBundles(mixed $rawTypes): ?array {
    if (!is_array($rawTypes) || $rawTypes === []) {
      return NULL;
    }
    $normalised = [];
    foreach ($rawTypes as $t) {
      if (!is_string($t)) {
        continue;
      }
      $t = strtolower(trim($t));
      // Accept either the frontend labels ("note") or the raw bundle ids
      // ("study_note") — be liberal in what we accept.
      if (isset(self::FILTER_TO_BUNDLES[$t])) {
        foreach (self::FILTER_TO_BUNDLES[$t] as $b) {
          $normalised[$b] = TRUE;
        }
      }
      elseif (in_array($t, self::ALL_BUNDLES, TRUE)) {
        $normalised[$t] = TRUE;
      }
    }
    if ($normalised === []) {
      return NULL;
    }
    return array_keys($normalised);
  }

  /**
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

    // When the original hit was a flashcard collapsed to its parent deck,
    // expose the card itself so the UI / RAG layer can cite it specifically.
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
