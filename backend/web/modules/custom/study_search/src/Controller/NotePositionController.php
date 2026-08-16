<?php

declare(strict_types=1);

namespace Drupal\study_search\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\node\NodeInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Handles GET /api/study/notes/{uuid}/position.
 *
 * Used by the notes sidebar (`/dashboard/notes`) to "jump to" a note that
 * was opened from Search or Ask AI but isn't in the currently loaded
 * window. Given the same sort + area/subject filters the sidebar itself
 * uses, this returns the note's zero-based offset in that ordering so the
 * frontend can fetch a window centred on it, without having to page
 * through the whole list.
 *
 * Query parameters:
 *   sort    (string, default "-created") — "-created" | "-changed" | "-field_last_viewed"
 *   area    (string, optional) — area taxonomy term UUID
 *   subject (string, optional) — subject taxonomy term UUID
 *
 * Response: { "offset": <int> }
 *
 * Errors (404 in both cases — existence isn't leaked to non-owners):
 *   { "error": "not_found" }          — note doesn't exist, isn't a
 *                                        study_note, or isn't owned by the
 *                                        current user.
 *   { "error": "excluded_by_filter" } — note exists and is owned, but
 *                                        doesn't match the given area/subject
 *                                        filter, so it has no position in
 *                                        this particular list.
 */
class NotePositionController extends ControllerBase {

  private const ALLOWED_SORTS = ['-created', '-changed', '-field_last_viewed'];

  public function position(Request $request, string $uuid): JsonResponse {
    $storage = $this->entityTypeManager()->getStorage('node');
    $candidates = $storage->loadByProperties(['uuid' => $uuid]);
    /** @var \Drupal\node\NodeInterface|false $node */
    $node = reset($candidates);

    $current_uid = (int) $this->currentUser()->id();

    if (
      !$node instanceof NodeInterface
      || $node->bundle() !== 'study_note'
      || (int) $node->getOwnerId() !== $current_uid
    ) {
      return new JsonResponse(['error' => 'not_found'], 404);
    }

    $sort = (string) $request->query->get('sort', '-created');
    if (!in_array($sort, self::ALLOWED_SORTS, TRUE)) {
      $sort = '-created';
    }
    $sort_field = ltrim($sort, '-');

    $area_uuid = trim((string) $request->query->get('area', ''));
    $subject_uuid = trim((string) $request->query->get('subject', ''));

    $area_tid = $area_uuid !== '' ? $this->loadOwnedTermId($area_uuid, 'area', $current_uid) : NULL;
    if ($area_uuid !== '' && $area_tid === NULL) {
      // Filter references a term that doesn't exist / isn't the user's —
      // nothing can match it.
      return new JsonResponse(['error' => 'excluded_by_filter'], 404);
    }

    $subject_tid = $subject_uuid !== '' ? $this->loadOwnedTermId($subject_uuid, 'subject', $current_uid) : NULL;
    if ($subject_uuid !== '' && $subject_tid === NULL) {
      return new JsonResponse(['error' => 'excluded_by_filter'], 404);
    }

    if ($area_tid !== NULL && !$this->nodeReferencesTerm($node, 'field_area', $area_tid)) {
      return new JsonResponse(['error' => 'excluded_by_filter'], 404);
    }
    if ($subject_tid !== NULL && !$this->nodeReferencesTerm($node, 'field_subject', $subject_tid)) {
      return new JsonResponse(['error' => 'excluded_by_filter'], 404);
    }

    $offset = $this->countNotesBefore($node, $sort_field, $current_uid, $area_tid, $subject_tid);

    return new JsonResponse(['offset' => $offset]);
  }

  /**
   * Resolves a taxonomy term UUID to its integer id, scoped to the given
   * vocabulary and owner. Returns NULL when no such term exists.
   */
  private function loadOwnedTermId(string $uuid, string $vocabulary, int $owner_uid): ?int {
    $terms = $this->entityTypeManager()
      ->getStorage('taxonomy_term')
      ->loadByProperties([
        'uuid' => $uuid,
        'vid' => $vocabulary,
        'field_owner' => $owner_uid,
      ]);
    $term = reset($terms);
    return $term ? (int) $term->id() : NULL;
  }

  /**
   * True when $node's multi-value reference field $field_name includes
   * $term_id among its targets.
   */
  private function nodeReferencesTerm(NodeInterface $node, string $field_name, int $term_id): bool {
    if (!$node->hasField($field_name)) {
      return FALSE;
    }
    foreach ($node->get($field_name)->getValue() as $item) {
      if ((int) ($item['target_id'] ?? 0) === $term_id) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Counts how many of the current user's study_notes (matching the given
   * area/subject filters) sort strictly before $node under $sort_field
   * descending order, using node id as a deterministic tiebreaker for
   * equal timestamps — this mirrors how Drupal's JSON:API resolves ties
   * on a single-column sort, and is what the sidebar's own offset means.
   */
  private function countNotesBefore(
    NodeInterface $node,
    string $sort_field,
    int $owner_uid,
    ?int $area_tid,
    ?int $subject_tid,
  ): int {
    $target_value = $this->sortFieldValue($node, $sort_field);

    $storage = $this->entityTypeManager()->getStorage('node');

    $query = $storage->getQuery();
    $query->accessCheck(TRUE);
    $query->condition('type', 'study_note');
    $query->condition('uid', $owner_uid);
    if ($area_tid !== NULL) {
      $query->condition('field_area', $area_tid);
    }
    if ($subject_tid !== NULL) {
      $query->condition('field_subject', $subject_tid);
    }

    // Descending sort: notes with a strictly greater value than the
    // target come before it, OR equal value with a strictly greater nid
    // (ties broken by nid descending, matching Drupal JSON:API's implicit
    // secondary sort for stable pagination).
    $or = $query->orConditionGroup()
      ->condition($sort_field, $target_value, '>')
      ->condition(
        $query->andConditionGroup()
          ->condition($sort_field, $target_value, '=')
          ->condition('nid', (int) $node->id(), '>'),
      );
    $query->condition($or);

    $query->count();
    return (int) $query->execute();
  }

  /**
   * Reads the raw comparable value for the given sort field.
   *
   * `field_last_viewed` is a nullable datetime field stored as a string
   * (e.g. "2025-01-01T00:00:00"); an empty note sorts as the empty
   * string, which is correctly "less than" any real timestamp under
   * `-field_last_viewed`.
   */
  private function sortFieldValue(NodeInterface $node, string $sort_field): string {
    if (!$node->hasField($sort_field) || $node->get($sort_field)->isEmpty()) {
      return '';
    }
    return (string) $node->get($sort_field)->value;
  }

}
