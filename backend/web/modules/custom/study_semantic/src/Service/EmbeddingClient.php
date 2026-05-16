<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Thin client for the Voyage AI embeddings API.
 *
 * Mirrors the cURL-based style used elsewhere in this project (see
 * AiFlashcardService) so we keep one HTTP convention across modules.
 *
 * Voyage distinguishes "document" (indexed content) from "query" (search
 * text) inputs and uses slightly different prompts under the hood. The
 * queue worker passes "document"; search/RAG controllers pass "query".
 */
class EmbeddingClient {

  /**
   * Public, stable identifier persisted in `content_embeddings.model_version`.
   * Bumping this — together with switching `MODEL` — flags every existing
   * row as stale and forces re-embed on the next queue pass.
   */
  public const MODEL_VERSION = 'voyage-3-lite';

  private const API_URL = 'https://api.voyageai.com/v1/embeddings';
  private const MODEL = 'voyage-3-lite';
  public const DIMENSIONS = 512;
  private const TIMEOUT_SECONDS = 30;

  /**
   * Voyage rejects inputs longer than the modes context window. The model
   * page lists 32k tokens; we cap to ~12k chars (~3k tokens) since none of
   * our notes get anywhere close and the cap protects against pathological
   * pasted content.
   */
  private const MAX_INPUT_CHARS = 12000;

  private LoggerInterface $logger;

  public function __construct(LoggerChannelFactoryInterface $loggerFactory) {
    $this->logger = $loggerFactory->get('study_semantic');
  }

  /**
   * Embeds a single string and returns the vector.
   *
   * @param string $text
   *   Raw text to embed. Empty / whitespace-only input is rejected so we
   *   never pay for a no-op API call.
   * @param string $inputType
   *   "document" when embedding stored content; "query" when embedding
   *   a search/RAG question. Voyage uses different prompts for asymmetric
   *   retrieval; the caller picks the right one.
   *
   * @return array<int, float>
   *   The 512-dimensional embedding.
   *
   * @throws EmbeddingException
   *   On any failure. The queue worker turns transient ones into
   *   `SuspendQueueException` and lets permanent ones surface as errors.
   */
  public function embed(string $text, string $inputType = 'document'): array {
    $text = trim($text);
    if ($text === '') {
      throw new EmbeddingException('Cannot embed empty text.', EmbeddingException::PERMANENT);
    }

    if (!in_array($inputType, ['document', 'query'], TRUE)) {
      throw new EmbeddingException('inputType must be "document" or "query".', EmbeddingException::PERMANENT);
    }

    if (mb_strlen($text) > self::MAX_INPUT_CHARS) {
      $text = mb_substr($text, 0, self::MAX_INPUT_CHARS);
    }

    $apiKey = getenv('VOYAGE_API_KEY');
    if (!is_string($apiKey) || $apiKey === '') {
      throw new EmbeddingException('VOYAGE_API_KEY is not configured.', EmbeddingException::PERMANENT);
    }

    $payload = json_encode([
      'model' => self::MODEL,
      'input' => [$text],
      'input_type' => $inputType,
    ]);

    $ch = curl_init(self::API_URL);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => TRUE,
      CURLOPT_POST => TRUE,
      CURLOPT_POSTFIELDS => $payload,
      CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey,
      ],
      CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '') {
      $this->logger->warning('Voyage embeddings curl error: @err', ['@err' => $curlError]);
      throw new EmbeddingException('Network error contacting Voyage.', EmbeddingException::TRANSIENT);
    }

    // 429 = rate limited, 5xx = server-side — both transient.
    if ($httpCode === 429 || ($httpCode >= 500 && $httpCode < 600)) {
      $this->logger->warning('Voyage embeddings transient HTTP @code: @body', [
        '@code' => $httpCode,
        '@body' => is_string($response) ? mb_substr($response, 0, 500) : '',
      ]);
      throw new EmbeddingException('Voyage returned HTTP ' . $httpCode . '.', EmbeddingException::TRANSIENT);
    }

    if ($httpCode !== 200) {
      $this->logger->error('Voyage embeddings permanent HTTP @code: @body', [
        '@code' => $httpCode,
        '@body' => is_string($response) ? mb_substr($response, 0, 500) : '',
      ]);
      throw new EmbeddingException('Voyage returned HTTP ' . $httpCode . '.', EmbeddingException::PERMANENT);
    }

    $data = json_decode((string) $response, TRUE);
    $vector = $data['data'][0]['embedding'] ?? NULL;
    if (!is_array($vector) || count($vector) !== self::DIMENSIONS) {
      $this->logger->error('Voyage returned an unexpected payload shape: @body', [
        '@body' => is_string($response) ? mb_substr($response, 0, 500) : '',
      ]);
      throw new EmbeddingException('Voyage returned an unexpected payload.', EmbeddingException::PERMANENT);
    }

    return array_map(static fn ($v): float => (float) $v, $vector);
  }

}
