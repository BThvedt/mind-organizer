<?php

declare(strict_types=1);

namespace Drupal\study_share\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\node\NodeInterface;
use Drupal\paragraphs\ParagraphInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Public read-only endpoints for shared study content, plus a
 * narrowly-scoped PATCH for toggling individual todo items.
 *
 * Access is gated on the share token (URL parameter) plus the
 * field_is_shared flag on the parent node. Entities are loaded directly
 * (bypassing JSON:API), so anonymous users cannot enumerate other shared
 * content via filter queries on /jsonapi.
 */
class ShareController extends ControllerBase {

  /**
   * GET /api/share/note/{token}
   */
  public function viewNote(string $token): JsonResponse {
    $node = $this->loadSharedNodeByToken($token, 'study_note');
    if ($node === NULL) {
      return $this->notFound();
    }

    $body = $node->hasField('field_body') && !$node->get('field_body')->isEmpty()
      ? (string) $node->get('field_body')->value
      : '';

    return $this->jsonNoStore([
      'type'    => 'study_note',
      'title'   => $node->getTitle(),
      'body'    => $body,
      'area'    => $this->termRef($node, 'field_area'),
      'subject' => $this->termRef($node, 'field_subject'),
      'links'   => array_merge(
        $this->serializeSharedLinks($node, 'field_linked_decks'),
        $this->serializeSharedLinks($node, 'field_linked_notes'),
        $this->serializeSharedLinks($node, 'field_linked_todos'),
      ),
      'updated' => (int) $node->getChangedTime(),
    ]);
  }

  /**
   * GET /api/share/deck/{token}
   */
  public function viewDeck(string $token): JsonResponse {
    $node = $this->loadSharedNodeByToken($token, 'flashcard_deck');
    if ($node === NULL) {
      return $this->notFound();
    }

    $description = '';
    if ($node->hasField('body') && !$node->get('body')->isEmpty()) {
      $description = (string) $node->get('body')->value;
    }

    // Load the deck's flashcards (newest first to match the dashboard order).
    $card_storage = $this->entityTypeManager()->getStorage('node');
    $card_ids = $card_storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('type', 'flashcard')
      ->condition('field_deck', $node->id())
      ->sort('created', 'ASC')
      ->execute();

    $cards = [];
    if (!empty($card_ids)) {
      foreach ($card_storage->loadMultiple($card_ids) as $card) {
        $cards[] = [
          'uuid'  => $card->uuid(),
          'front' => $card->hasField('field_front') && !$card->get('field_front')->isEmpty()
            ? (string) $card->get('field_front')->value
            : '',
          'back'  => $card->hasField('field_back') && !$card->get('field_back')->isEmpty()
            ? (string) $card->get('field_back')->value
            : '',
        ];
      }
    }

    return $this->jsonNoStore([
      'type'        => 'flashcard_deck',
      'title'       => $node->getTitle(),
      'description' => $description,
      'area'        => $this->termRef($node, 'field_area'),
      'subject'     => $this->termRef($node, 'field_subject'),
      'cards'       => $cards,
      'links'       => array_merge(
        $this->serializeSharedLinks($node, 'field_linked_decks'),
        $this->serializeSharedLinks($node, 'field_linked_todos'),
        $this->serializeSharedReverseDeckNotes($node),
      ),
      'updated'     => (int) $node->getChangedTime(),
    ]);
  }

  /**
   * GET /api/share/todo/{token}
   */
  public function viewTodo(string $token): JsonResponse {
    $node = $this->loadSharedNodeByToken($token, 'todo_list');
    if ($node === NULL) {
      return $this->notFound();
    }

    $items = [];
    if ($node->hasField('field_items') && !$node->get('field_items')->isEmpty()) {
      foreach ($node->get('field_items') as $delta => $reference) {
        /** @var \Drupal\paragraphs\ParagraphInterface|null $paragraph */
        $paragraph = $reference->entity;
        if (!$paragraph instanceof ParagraphInterface) {
          continue;
        }
        $items[] = $this->serializeTodoItem($paragraph);
      }
    }

    return $this->jsonNoStore([
      'type'    => 'todo_list',
      'title'   => $node->getTitle(),
      'area'    => $this->termRef($node, 'field_area'),
      'subject' => $this->termRef($node, 'field_subject'),
      'items'   => $items,
      'links'   => array_merge(
        $this->serializeSharedLinks($node, 'field_linked_decks'),
        $this->serializeSharedLinks($node, 'field_linked_notes'),
        $this->serializeSharedLinks($node, 'field_linked_todos'),
      ),
      'updated' => (int) $node->getChangedTime(),
    ]);
  }

  /**
   * PATCH /api/share/todo/{token}/items/{item_uuid}
   *
   * Body: { "completed": bool }
   *
   * Only field_completed can be modified through this endpoint. Anonymous
   * viewers cannot create or delete todo items.
   */
  public function toggleTodoItem(string $token, string $item_uuid, Request $request): JsonResponse {
    $node = $this->loadSharedNodeByToken($token, 'todo_list');
    if ($node === NULL) {
      return $this->notFound();
    }

    $body = json_decode($request->getContent(), TRUE);
    if (!is_array($body) || !array_key_exists('completed', $body)) {
      return new JsonResponse(['error' => 'Field "completed" (bool) is required.'], 400);
    }
    $completed = (bool) $body['completed'];

    // Locate the paragraph by UUID and verify it actually belongs to this list.
    $paragraph = NULL;
    if ($node->hasField('field_items') && !$node->get('field_items')->isEmpty()) {
      foreach ($node->get('field_items') as $reference) {
        $candidate = $reference->entity;
        if ($candidate instanceof ParagraphInterface && $candidate->uuid() === $item_uuid) {
          $paragraph = $candidate;
          break;
        }
      }
    }

    if ($paragraph === NULL) {
      return $this->notFound('Item not found in this list.');
    }
    if (!$paragraph->hasField('field_completed')) {
      return new JsonResponse(['error' => 'Item does not support completion.'], 400);
    }

    $paragraph->set('field_completed', $completed ? 1 : 0);
    try {
      $paragraph->save();
    }
    catch (\Exception $e) {
      return new JsonResponse(['error' => 'Failed to update item.'], 500);
    }

    return $this->jsonNoStore($this->serializeTodoItem($paragraph));
  }

  /**
   * Loads a node by its share token, requiring field_is_shared = 1 and the
   * expected bundle. Returns NULL on miss.
   */
  private function loadSharedNodeByToken(string $token, string $bundle): ?NodeInterface {
    $token = trim($token);
    if ($token === '') {
      return NULL;
    }
    $storage = $this->entityTypeManager()->getStorage('node');
    $matches = $storage->loadByProperties([
      'type'              => $bundle,
      'field_is_shared'   => 1,
      'field_share_token' => $token,
    ]);
    if (empty($matches)) {
      return NULL;
    }
    /** @var \Drupal\node\NodeInterface $node */
    $node = reset($matches);
    return $node->isPublished() ? $node : NULL;
  }

  /**
   * Reduces a taxonomy reference field on a node to { uuid, name } | null.
   */
  private function termRef(NodeInterface $node, string $field): ?array {
    if (!$node->hasField($field) || $node->get($field)->isEmpty()) {
      return NULL;
    }
    $term = $node->get($field)->entity;
    if ($term === NULL) {
      return NULL;
    }
    return ['uuid' => $term->uuid(), 'name' => $term->label()];
  }

  /**
   * Serializes a todo_item paragraph into the public response shape.
   */
  private function serializeTodoItem(ParagraphInterface $paragraph): array {
    $text      = $paragraph->hasField('field_item_text') && !$paragraph->get('field_item_text')->isEmpty()
      ? (string) $paragraph->get('field_item_text')->value
      : '';
    $completed = $paragraph->hasField('field_completed') && !$paragraph->get('field_completed')->isEmpty()
      ? (bool) $paragraph->get('field_completed')->value
      : FALSE;
    $priority  = $paragraph->hasField('field_priority') && !$paragraph->get('field_priority')->isEmpty()
      ? (string) $paragraph->get('field_priority')->value
      : NULL;
    $notes     = $paragraph->hasField('field_notes') && !$paragraph->get('field_notes')->isEmpty()
      ? (string) $paragraph->get('field_notes')->value
      : '';

    return [
      'uuid'      => $paragraph->uuid(),
      'text'      => $text,
      'completed' => $completed,
      'priority'  => $priority,
      'notes'     => $notes,
    ];
  }

  /**
   * Maps a node bundle to the public share-link type segment.
   */
  private function typeForBundle(string $bundle): ?string {
    return match ($bundle) {
      'study_note'     => 'note',
      'flashcard_deck' => 'deck',
      'todo_list'      => 'todo',
      default          => NULL,
    };
  }

  /**
   * Builds a shared-link descriptor for a node, or NULL if the node is not
   * publicly shared (no share flag, no token, unpublished, or unsupported
   * bundle).
   *
   * @return array{type: string, title: string, token: string}|null
   */
  private function buildSharedLink(NodeInterface $node): ?array {
    if (!$node->isPublished()) {
      return NULL;
    }
    if (!$node->hasField('field_is_shared') || $node->get('field_is_shared')->isEmpty()) {
      return NULL;
    }
    if (!(bool) $node->get('field_is_shared')->value) {
      return NULL;
    }
    if (!$node->hasField('field_share_token') || $node->get('field_share_token')->isEmpty()) {
      return NULL;
    }
    $type = $this->typeForBundle($node->bundle());
    if ($type === NULL) {
      return NULL;
    }
    return [
      'type'  => $type,
      'title' => (string) $node->getTitle(),
      'token' => (string) $node->get('field_share_token')->value,
    ];
  }

  /**
   * Serializes a multi-value entity reference field on a node into a list of
   * shared-link descriptors. Targets that aren't publicly shared are silently
   * dropped.
   *
   * @return array<int, array{type: string, title: string, token: string}>
   */
  private function serializeSharedLinks(NodeInterface $node, string $field): array {
    if (!$node->hasField($field) || $node->get($field)->isEmpty()) {
      return [];
    }
    $links = [];
    foreach ($node->get($field) as $item) {
      $target = $item->entity;
      if (!$target instanceof NodeInterface) {
        continue;
      }
      $link = $this->buildSharedLink($target);
      if ($link !== NULL) {
        $links[] = $link;
      }
    }
    return $links;
  }

  /**
   * Reverse query for the deck share view: notes whose field_linked_decks
   * targets the given deck and which are themselves publicly shared.
   *
   * @return array<int, array{type: string, title: string, token: string}>
   */
  private function serializeSharedReverseDeckNotes(NodeInterface $deck): array {
    $storage = $this->entityTypeManager()->getStorage('node');
    $nids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('type', 'study_note')
      ->condition('status', 1)
      ->condition('field_linked_decks', $deck->id())
      ->condition('field_is_shared', 1)
      ->sort('changed', 'DESC')
      ->execute();

    if (empty($nids)) {
      return [];
    }

    $links = [];
    foreach ($storage->loadMultiple($nids) as $note) {
      if (!$note instanceof NodeInterface) {
        continue;
      }
      $link = $this->buildSharedLink($note);
      if ($link !== NULL) {
        $links[] = $link;
      }
    }
    return $links;
  }

  private function notFound(string $message = 'Share link is invalid or no longer available.'): JsonResponse {
    return $this->jsonNoStore(['error' => $message], 404);
  }

  private function jsonNoStore(array $payload, int $status = 200): JsonResponse {
    $response = new JsonResponse($payload, $status);
    $response->headers->set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return $response;
  }

}
