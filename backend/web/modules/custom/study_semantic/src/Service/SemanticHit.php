<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

use Drupal\Core\Entity\EntityInterface;

/**
 * One hit returned by SemanticSearchService.
 *
 * `$entity` is always the "display" entity (deck for collapsed flashcard
 * hits, the entity itself otherwise). `$cardEntity` is set only when the
 * original Qdrant hit was a flashcard, so RAG can cite the specific card
 * even though search dialogs only ever surface the parent deck.
 */
final class SemanticHit {

  public function __construct(
    public readonly EntityInterface $entity,
    public readonly float $score,
    public readonly ?EntityInterface $cardEntity = NULL,
    public readonly ?float $cardScore = NULL,
  ) {}

  public function isCollapsedCard(): bool {
    return $this->cardEntity !== NULL;
  }

}
