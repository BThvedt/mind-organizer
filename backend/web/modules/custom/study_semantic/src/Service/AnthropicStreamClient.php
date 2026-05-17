<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Streaming client for the Anthropic Messages API.
 *
 * Unlike `AiFlashcardService` in study_flashcard_generator (which calls
 * `messages` with stream=false and waits for the full JSON), this client
 * uses stream=true and yields text deltas as they arrive. Designed to be
 * consumed by a controller that turns the deltas into Server-Sent Events
 * for the browser.
 *
 * Reuses `ANTHROPIC_API_KEY`. Model mirrors AiFlashcardService for
 * consistency across the apps AI surface.
 *
 * IMPORTANT: this class deliberately performs blocking I/O via curl. The
 * RAG controller runs in php-fpm where flushing is handled per-write —
 * see `RagController` for how output buffering is configured.
 */
class AnthropicStreamClient {

  private const API_URL = 'https://api.anthropic.com/v1/messages';
  private const MODEL = 'claude-haiku-4-5';
  private const MAX_TOKENS = 2048;
  private const TIMEOUT_SECONDS = 60;

  private LoggerInterface $logger;

  public function __construct(LoggerChannelFactoryInterface $loggerFactory) {
    $this->logger = $loggerFactory->get('study_semantic');
  }

  /**
   * Streams an answer to a question grounded in the supplied context.
   *
   * @param string $systemPrompt
   *   System message — typically instructions about citation format and
   *   "only answer from these sources" rules.
   * @param string $userPrompt
   *   User message — typically the assembled context block + the question.
   * @param callable(string $textDelta): void $onDelta
   *   Called once per incoming text fragment. Implementations should
   *   flush to the wire immediately so the browser sees streaming output.
   *
   * @throws \RuntimeException on permanent API/transport failure.
   */
  public function stream(string $systemPrompt, string $userPrompt, callable $onDelta): void {
    $apiKey = getenv('ANTHROPIC_API_KEY');
    if (!is_string($apiKey) || $apiKey === '') {
      throw new \RuntimeException('ANTHROPIC_API_KEY is not configured.');
    }

    $payload = json_encode([
      'model' => self::MODEL,
      'max_tokens' => self::MAX_TOKENS,
      'stream' => TRUE,
      'system' => $systemPrompt,
      'messages' => [
        ['role' => 'user', 'content' => $userPrompt],
      ],
    ], JSON_THROW_ON_ERROR);

    // SSE parsing state. Anthropic sends events as
    //   event: content_block_delta
    //   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
    //
    // We buffer raw bytes from curl, split on "\n\n" (event boundaries),
    // and dispatch text_delta payloads to `$onDelta`.
    $buffer = '';
    $handleChunk = function (string $chunk) use (&$buffer, $onDelta): void {
      $buffer .= $chunk;
      while (($pos = strpos($buffer, "\n\n")) !== FALSE) {
        $rawEvent = substr($buffer, 0, $pos);
        $buffer = substr($buffer, $pos + 2);
        $this->dispatchSseEvent($rawEvent, $onDelta);
      }
    };

    $ch = curl_init(self::API_URL);
    curl_setopt_array($ch, [
      CURLOPT_POST => TRUE,
      CURLOPT_POSTFIELDS => $payload,
      CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: text/event-stream',
        'x-api-key: ' . $apiKey,
        'anthropic-version: 2023-06-01',
      ],
      CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
      // Write callback returns bytes consumed; returning anything other
      // than `strlen($chunk)` would abort the transfer.
      CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use ($handleChunk): int {
        $handleChunk($chunk);
        return strlen($chunk);
      },
    ]);

    $ok = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($ok === FALSE || $curlError !== '') {
      $this->logger->error('Anthropic stream curl error: @err', ['@err' => $curlError]);
      throw new \RuntimeException('Network error contacting Anthropic.');
    }

    if ($httpCode < 200 || $httpCode >= 300) {
      $this->logger->error('Anthropic stream returned HTTP @code', ['@code' => $httpCode]);
      throw new \RuntimeException('Anthropic returned HTTP ' . $httpCode . '.');
    }

    // Flush any trailing event the API didnt cap with a blank line.
    if ($buffer !== '') {
      $this->dispatchSseEvent($buffer, $onDelta);
    }
  }

  /**
   * Parses a single raw SSE block ("event: …\ndata: {…}") and forwards any
   * text_delta content to `$onDelta`.
   *
   * Robust to partial / non-JSON `data:` lines: anything we cant parse is
   * silently ignored (Anthropic sends ping events we dont care about).
   */
  private function dispatchSseEvent(string $rawEvent, callable $onDelta): void {
    $rawEvent = trim($rawEvent);
    if ($rawEvent === '') {
      return;
    }
    foreach (preg_split('/\r?\n/', $rawEvent) ?: [] as $line) {
      if (!str_starts_with($line, 'data:')) {
        continue;
      }
      $jsonPart = ltrim(substr($line, 5));
      if ($jsonPart === '' || $jsonPart === '[DONE]') {
        continue;
      }
      $decoded = json_decode($jsonPart, TRUE);
      if (!is_array($decoded)) {
        continue;
      }
      // Only emit user-visible text. message_start / message_delta /
      // content_block_stop / ping etc. are dropped on the floor.
      $type = (string) ($decoded['type'] ?? '');
      if ($type === 'content_block_delta') {
        $delta = $decoded['delta'] ?? [];
        if (is_array($delta) && ($delta['type'] ?? '') === 'text_delta') {
          $text = (string) ($delta['text'] ?? '');
          if ($text !== '') {
            $onDelta($text);
          }
        }
      }
    }
  }

}
