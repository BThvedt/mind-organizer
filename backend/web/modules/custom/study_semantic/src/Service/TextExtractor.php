<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

use Drupal\node\NodeInterface;

/**
 * Flattens an embeddable node into a single string for the embedding API.
 *
 * Each bundle has its own extraction rule so we can include the fields a
 * user would actually want to surface in semantic search results. For
 * `todo_list` we reach into the child paragraphs the same way
 * `_media_functionality_todo_list_text()` does — the two helpers are
 * intentionally parallel.
 */
class TextExtractor {

  /**
   * Builds the canonical "text to embed" for an entity.
   *
   * Returns an empty string when the bundle isnt supported or has no
   * extractable content — callers should treat empty as "skip embedding".
   */
  public function extract(NodeInterface $node): string {
    return match ($node->bundle()) {
      'study_note' => $this->extractStudyNote($node),
      'flashcard_deck' => $this->extractDeck($node),
      'flashcard' => $this->extractFlashcard($node),
      'todo_list' => $this->extractTodoList($node),
      default => '',
    };
  }

  private function extractStudyNote(NodeInterface $node): string {
    $title = (string) $node->getTitle();
    $body = $this->stringValue($node, 'field_body');
    return $this->joinNonEmpty([$title, $body]);
  }

  private function extractDeck(NodeInterface $node): string {
    $title = (string) $node->getTitle();
    $body = '';
    if ($node->hasField('body') && !$node->get('body')->isEmpty()) {
      $first = $node->get('body')->first();
      $body = $first ? (string) ($first->value ?? '') : '';
    }
    return $this->joinNonEmpty([$title, $body]);
  }

  private function extractFlashcard(NodeInterface $node): string {
    $front = $this->stringValue($node, 'field_front');
    $back = $this->stringValue($node, 'field_back');
    return $this->joinNonEmpty([$front, $back]);
  }

  private function extractTodoList(NodeInterface $node): string {
    $title = (string) $node->getTitle();
    $parts = [$title];
    if ($node->hasField('field_items') && !$node->get('field_items')->isEmpty()) {
      foreach ($node->get('field_items')->referencedEntities() as $paragraph) {
        if ($paragraph->hasField('field_item_text') && !$paragraph->get('field_item_text')->isEmpty()) {
          $parts[] = (string) $paragraph->get('field_item_text')->value;
        }
        if ($paragraph->hasField('field_notes') && !$paragraph->get('field_notes')->isEmpty()) {
          $parts[] = (string) $paragraph->get('field_notes')->value;
        }
      }
    }
    return $this->joinNonEmpty($parts);
  }

  private function stringValue(NodeInterface $node, string $field): string {
    if (!$node->hasField($field) || $node->get($field)->isEmpty()) {
      return '';
    }
    return (string) $node->get($field)->value;
  }

  /**
   * @param array<int, string> $parts
   */
  private function joinNonEmpty(array $parts): string {
    $filtered = array_values(array_filter(
      array_map('trim', $parts),
      static fn (string $p): bool => $p !== '',
    ));
    return implode("\n\n", $filtered);
  }

}
