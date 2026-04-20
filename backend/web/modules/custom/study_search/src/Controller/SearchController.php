<?php

declare(strict_types=1);

namespace Drupal\study_search\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\search_api\Entity\Index;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Handles GET /api/study/search.
 *
 * Query parameters:
 *   q       (string, required) — search term, minimum 2 characters
 *   type    (string, default "all") — "all" | "note" | "deck" | "todo"
 *   area    (string, optional) — area taxonomy term UUID
 *   subject (string, optional) — subject taxonomy term UUID
 *
 * Response:
 *   {
 *     "results": [
 *       {
 *         "uuid":    "<node-uuid>",
 *         "type":    "study_note" | "flashcard_deck" | "todo_list",
 *         "title":   "...",
 *         "area":    { "uuid": "...", "name": "..." } | null,
 *         "subject": { "uuid": "...", "name": "..." } | null
 *       }
 *     ],
 *     "total": <int>
 *   }
 *
 * Prerequisites — the Search API index (machine name: "db_index") must
 * have the following fields:
 *   Fulltext : title, field_body (study_note), body (flashcard_deck),
 *              plus the aggregated card-content field (flashcard fields and
 *              todo_list paragraph item text/notes)
 *   String   : type, uid
 *   Entity reference (integer IDs):
 *              field_area, field_subject
 *              (These are the entity-reference fields themselves, not the
 *               "→ name" sub-fields. Add them separately in the Fields tab.)
 *
 * After importing index config (e.g. drush cim), reindex `db_index` in the
 * Search API admin UI so existing content is searchable.
 */
class SearchController extends ControllerBase {

  /**
   * GET /api/study/search
   */
  public function search(Request $request): JsonResponse {
    $q            = trim((string) $request->query->get('q', ''));
    $type         = (string) $request->query->get('type', 'all');
    $area_uuid    = trim((string) $request->query->get('area', ''));
    $subject_uuid = trim((string) $request->query->get('subject', ''));

    if (mb_strlen($q) < 2) {
      return new JsonResponse(['results' => [], 'total' => 0]);
    }

    $index = Index::load('db_index');
    if (!$index || !$index->status()) {
      return new JsonResponse(['error' => 'Search index is not available.'], 503);
    }

    $query = $index->query();
    $query->keys($q);

    // Scope results to the current user's own content.
    $query->addCondition('uid', (int) $this->currentUser()->id());

    // Content-type filter. When the user asks for "note" we can exclude
    // flashcard items entirely. For "deck" or "all" we allow flashcard items
    // through so that card content matches can be resolved to parent decks.
    if ($type === 'note') {
      $query->addCondition('type', 'study_note');
    }
    elseif ($type === 'deck') {
      $conditions = $query->createConditionGroup('OR');
      $conditions->addCondition('type', 'flashcard_deck');
      $conditions->addCondition('type', 'flashcard');
      $query->addConditionGroup($conditions);
    }
    elseif ($type === 'todo') {
      $query->addCondition('type', 'todo_list');
    }

    // Area / subject filters (only apply to non-flashcard types since
    // flashcards don't carry these fields — the parent deck does).
    $index_fields = $index->getFields();
    $current_uid = (int) $this->currentUser()->id();

    $area_tid = NULL;
    if ($area_uuid !== '' && isset($index_fields['field_area'])) {
      $area_terms = $this->entityTypeManager()
        ->getStorage('taxonomy_term')
        ->loadByProperties([
          'uuid' => $area_uuid,
          'vid' => 'area',
          'field_owner' => $current_uid,
        ]);
      if (!empty($area_terms)) {
        $area_tid = (int) reset($area_terms)->id();
      }
    }

    $subject_tid = NULL;
    if ($subject_uuid !== '' && isset($index_fields['field_subject'])) {
      $subject_terms = $this->entityTypeManager()
        ->getStorage('taxonomy_term')
        ->loadByProperties([
          'uuid' => $subject_uuid,
          'vid' => 'subject',
          'field_owner' => $current_uid,
        ]);
      if (!empty($subject_terms)) {
        $subject_tid = (int) reset($subject_terms)->id();
      }
    }

    // When area/subject filters are active we can't apply them as index
    // conditions because flashcards don't have those fields. We'll filter
    // after resolving cards → decks instead.

    $query->range(0, 50);

    try {
      $result_set = $query->execute();
    }
    catch (\Exception $e) {
      return new JsonResponse(['error' => 'Search failed: ' . $e->getMessage()], 500);
    }

    // Map Search API item IDs (format "entity:node/123:en") to node IDs,
    // preserving result order for relevance ranking.
    $nid_order = [];
    foreach (array_keys($result_set->getResultItems()) as $item_id) {
      if (preg_match('/entity:node\/(\d+)/', $item_id, $m)) {
        $nid_order[(int) $m[1]] = count($nid_order);
      }
    }

    if (empty($nid_order)) {
      return new JsonResponse(['results' => [], 'total' => 0]);
    }

    $node_storage = $this->entityTypeManager()->getStorage('node');
    $nodes = $node_storage->loadMultiple(array_keys($nid_order));

    // Re-sort nodes into search-result order.
    usort($nodes, static fn($a, $b) =>
      ($nid_order[$a->id()] ?? 999) <=> ($nid_order[$b->id()] ?? 999)
    );

    // Resolve flashcard hits → parent decks. A matching flashcard promotes
    // its parent deck into the results at the card's relevance position.
    $seen_uuids = [];
    $resolved = [];
    $deck_ids_to_load = [];

    foreach ($nodes as $node) {
      if ($node->bundle() === 'flashcard') {
        if ($node->hasField('field_deck') && !$node->get('field_deck')->isEmpty()) {
          $deck_id = (int) $node->get('field_deck')->target_id;
          if (!isset($deck_ids_to_load[$deck_id])) {
            $deck_ids_to_load[$deck_id] = count($resolved);
            $resolved[] = ['placeholder_deck_id' => $deck_id];
          }
        }
        continue;
      }
      $resolved[] = ['node' => $node];
    }

    // Bulk-load any parent decks that weren't already in results.
    if (!empty($deck_ids_to_load)) {
      $decks = $node_storage->loadMultiple(array_keys($deck_ids_to_load));
      foreach ($decks as $deck) {
        $idx = $deck_ids_to_load[$deck->id()];
        $resolved[$idx] = ['node' => $deck];
      }
    }

    // Build the final results list, deduplicating and applying taxonomy filters.
    $results = [];
    foreach ($resolved as $item) {
      if (!isset($item['node'])) {
        continue;
      }
      /** @var \Drupal\node\NodeInterface $node */
      $node = $item['node'];
      $uuid = $node->uuid();

      if (isset($seen_uuids[$uuid])) {
        continue;
      }
      $seen_uuids[$uuid] = TRUE;

      $area_data    = NULL;
      $subject_data = NULL;

      if ($node->hasField('field_area') && !$node->get('field_area')->isEmpty()) {
        /** @var \Drupal\taxonomy\TermInterface $term */
        $term = $node->get('field_area')->entity;
        if ($term) {
          $area_data = ['uuid' => $term->uuid(), 'name' => $term->getName()];
        }
      }

      if ($node->hasField('field_subject') && !$node->get('field_subject')->isEmpty()) {
        /** @var \Drupal\taxonomy\TermInterface $term */
        $term = $node->get('field_subject')->entity;
        if ($term) {
          $subject_data = ['uuid' => $term->uuid(), 'name' => $term->getName()];
        }
      }

      // Apply area/subject post-filters (flashcard → deck resolution means
      // we couldn't filter at the query level).
      if ($area_tid !== NULL) {
        $node_area_id = $node->hasField('field_area') && !$node->get('field_area')->isEmpty()
          ? (int) $node->get('field_area')->target_id
          : NULL;
        if ($node_area_id !== $area_tid) {
          continue;
        }
      }
      if ($subject_tid !== NULL) {
        $node_subject_id = $node->hasField('field_subject') && !$node->get('field_subject')->isEmpty()
          ? (int) $node->get('field_subject')->target_id
          : NULL;
        if ($node_subject_id !== $subject_tid) {
          continue;
        }
      }

      $results[] = [
        'uuid'    => $uuid,
        'type'    => $node->bundle(),
        'title'   => $node->getTitle(),
        'area'    => $area_data,
        'subject' => $subject_data,
      ];

      if (count($results) >= 20) {
        break;
      }
    }

    return new JsonResponse(['results' => $results, 'total' => count($results)]);
  }

}
