<?php

declare(strict_types=1);

namespace Drupal\study_flashcard_generator\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Generates flashcard candidates by calling the Anthropic Messages API.
 *
 * Uses the ANTHROPIC_API_KEY environment variable.
 * Model: claude-3-5-haiku-20241022
 */
class AiFlashcardService {

  private LoggerInterface $logger;

  private const API_URL = 'https://api.anthropic.com/v1/messages';
  private const MODEL = 'claude-haiku-4-5';
  private const MAX_TOKENS = 2048;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    LoggerChannelFactoryInterface $loggerFactory,
  ) {
    $this->logger = $loggerFactory->get('study_flashcard_generator');
  }

  /**
   * Sends markdown study-note content to Claude and returns flashcard candidates.
   *
   * @param string $markdown
   *   Raw markdown from study_note.field_body.
   *
   * @return array<int, array{front: string, back: string}>
   *
   * @throws \RuntimeException
   */
  public function generate(string $markdown): array {
    $prompt = <<<PROMPT
You are a study assistant. Given the following study notes written in Markdown, generate between 5 and 10 flashcard pairs that cover the most important concepts.

Return ONLY a valid JSON array with no extra text, where each element is an object with exactly two string keys: "front" (the question or prompt) and "back" (the answer or explanation). Example format:
[{"front": "What is X?", "back": "X is ..."}]

Study notes:
---
{$markdown}
---
PROMPT;

    return $this->callApi($prompt);
  }

  /**
   * Generates flashcard candidates from a free-form user prompt.
   *
   * @param string $userPrompt
   *   A topic description or raw text entered by the user.
   * @param int $limit
   *   Maximum number of cards to generate (1–10).
   *
   * @return array<int, array{front: string, back: string}>
   *
   * @throws \RuntimeException
   */
  public function generateFromPrompt(string $userPrompt, int $limit = 10): array {
    $limit = max(1, min(10, $limit));

    $prompt = <<<PROMPT
You are a study assistant. The user wants to create flashcards about the following topic or content:

---
{$userPrompt}
---

Generate up to {$limit} flashcard pairs that cover the most important concepts. Prefer concise, testable questions on the front and clear, direct answers on the back.

Return ONLY a valid JSON array with no extra text, where each element is an object with exactly two string keys: "front" (the question or prompt) and "back" (the answer or explanation). Example format:
[{"front": "What is X?", "back": "X is ..."}]
PROMPT;

    $candidates = $this->callApi($prompt);
    return array_slice($candidates, 0, $limit);
  }

  /**
   * Sends a single-turn prompt to the Anthropic Messages API.
   *
   * @param string $prompt
   *   The full user-turn message to send.
   *
   * @return array<int, array{front: string, back: string}>
   *
   * @throws \RuntimeException
   */
  private function callApi(string $prompt): array {
    $apiKey = getenv('ANTHROPIC_API_KEY');
    if (empty($apiKey)) {
      throw new \RuntimeException('ANTHROPIC_API_KEY is not configured.');
    }

    $payload = json_encode([
      'model' => self::MODEL,
      'max_tokens' => self::MAX_TOKENS,
      'messages' => [
        ['role' => 'user', 'content' => $prompt],
      ],
    ]);

    $ch = curl_init(self::API_URL);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => TRUE,
      CURLOPT_POST => TRUE,
      CURLOPT_POSTFIELDS => $payload,
      CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey,
        'anthropic-version: 2023-06-01',
      ],
      CURLOPT_TIMEOUT => 30,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
      $this->logger->error('Anthropic API curl error: @error', ['@error' => $curlError]);
      throw new \RuntimeException('Network error contacting Anthropic API.');
    }

    $data = json_decode($response, TRUE);

    if ($httpCode !== 200 || empty($data['content'][0]['text'])) {
      $this->logger->error('Anthropic API error @code: @body', [
        '@code' => $httpCode,
        '@body' => $response,
      ]);
      throw new \RuntimeException('Anthropic API returned an error (HTTP ' . $httpCode . ').');
    }

    $text = trim($data['content'][0]['text']);

    // Strip markdown code fences if Claude wraps the JSON.
    $text = preg_replace('/^```(?:json)?\s*/i', '', $text);
    $text = preg_replace('/\s*```$/', '', $text);

    $candidates = json_decode($text, TRUE);

    if (!is_array($candidates)) {
      $this->logger->error('Could not parse Claude response as JSON: @text', ['@text' => $text]);
      throw new \RuntimeException('Failed to parse AI response as flashcard JSON.');
    }

    return $this->sanitiseCandidates($candidates);
  }

  /**
   * Ensures each candidate has non-empty front and back string values.
   *
   * @param array<mixed> $raw
   * @return array<int, array{front: string, back: string}>
   */
  private function sanitiseCandidates(array $raw): array {
    $result = [];
    foreach ($raw as $item) {
      if (
        is_array($item)
        && !empty($item['front'])
        && !empty($item['back'])
        && is_string($item['front'])
        && is_string($item['back'])
      ) {
        $result[] = [
          'front' => trim($item['front']),
          'back' => trim($item['back']),
        ];
      }
    }
    return $result;
  }

}
