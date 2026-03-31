<?php

declare(strict_types=1);

namespace Drupal\study_flashcard_generator\Service;

use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Processes manually selected text pairs into flashcard candidates.
 *
 * The frontend sends an array of { "front": "...", "back": "..." } objects
 * where the user has highlighted question/answer pairs from their note.
 * This service validates and normalises them.
 */
class ManualSelectionService {

  private LoggerInterface $logger;

  public function __construct(LoggerChannelFactoryInterface $loggerFactory) {
    $this->logger = $loggerFactory->get('study_flashcard_generator');
  }

  /**
   * Validates and normalises manual selections into flashcard candidates.
   *
   * @param array<mixed> $selections
   *   Each element should be ['front' => string, 'back' => string].
   *
   * @return array<int, array{front: string, back: string}>
   *
   * @throws \InvalidArgumentException
   */
  public function process(array $selections): array {
    if (empty($selections)) {
      throw new \InvalidArgumentException('No selections provided.');
    }

    $candidates = [];

    foreach ($selections as $index => $item) {
      if (!is_array($item)) {
        $this->logger->warning('Skipping non-array selection at index @i.', ['@i' => $index]);
        continue;
      }

      $front = trim((string) ($item['front'] ?? ''));
      $back = trim((string) ($item['back'] ?? ''));

      if ($front === '' || $back === '') {
        $this->logger->warning('Skipping selection at index @i: front or back is empty.', ['@i' => $index]);
        continue;
      }

      $candidates[] = ['front' => $front, 'back' => $back];
    }

    if (empty($candidates)) {
      throw new \InvalidArgumentException('All selections were invalid (empty front or back).');
    }

    return $candidates;
  }

}
