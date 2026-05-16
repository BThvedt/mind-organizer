<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

/**
 * Thrown by EmbeddingClient and QdrantClient.
 *
 * The `kind` flag lets the queue worker decide whether to retry (transient)
 * or log-and-skip (permanent). Anything network-shaped, 429, or 5xx counts
 * as transient; misconfiguration, malformed input, and 4xx other than 429
 * count as permanent.
 */
class EmbeddingException extends \RuntimeException {

  public const TRANSIENT = 'transient';
  public const PERMANENT = 'permanent';

  public function __construct(
    string $message,
    public readonly string $kind = self::PERMANENT,
    ?\Throwable $previous = NULL,
  ) {
    parent::__construct($message, 0, $previous);
  }

  public function isTransient(): bool {
    return $this->kind === self::TRANSIENT;
  }

}
