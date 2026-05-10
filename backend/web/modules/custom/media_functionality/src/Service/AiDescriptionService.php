<?php

declare(strict_types=1);

namespace Drupal\media_functionality\Service;

use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Generates a short prose description for an image asset by calling the
 * Anthropic Messages API with a vision-enabled model.
 *
 * Uses the ANTHROPIC_API_KEY environment variable (same as the flashcard
 * generator). Caller is responsible for ensuring the asset is an image and
 * that the user is allowed to access it.
 */
class AiDescriptionService {

  private const API_URL = 'https://api.anthropic.com/v1/messages';
  private const MODEL = 'claude-haiku-4-5';
  private const MAX_TOKENS = 256;

  /**
   * Approximate hard cap on bytes we'll send to the API; the Anthropic SDK
   * accepts up to 5MB per image after base64-encoding, so 3.5MB raw is a
   * comfortable ceiling. Anything bigger gets refused — calling code can
   * surface the error or transcode/resize first.
   */
  private const MAX_IMAGE_BYTES = 3_500_000;

  private LoggerInterface $logger;

  public function __construct(LoggerChannelFactoryInterface $loggerFactory) {
    $this->logger = $loggerFactory->get('media_functionality');
  }

  /**
   * Describes the given image bytes in 1-2 sentences.
   *
   * @param string $imageBytes
   *   Raw image bytes (jpeg, png, webp, or gif).
   * @param string $mimeType
   *   The image's MIME type, e.g. `image/jpeg`.
   *
   * @return string
   *   A short, plain-prose description suitable for display.
   *
   * @throws \RuntimeException
   *   On configuration / network / API errors, or if the image is too large.
   */
  public function describeImage(string $imageBytes, string $mimeType): string {
    $apiKey = getenv('ANTHROPIC_API_KEY');
    if (empty($apiKey)) {
      throw new \RuntimeException('ANTHROPIC_API_KEY is not configured.');
    }

    if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], TRUE)) {
      throw new \RuntimeException('Unsupported image type for AI description: ' . $mimeType);
    }
    $size = strlen($imageBytes);
    if ($size === 0) {
      throw new \RuntimeException('Image is empty.');
    }
    if ($size > self::MAX_IMAGE_BYTES) {
      throw new \RuntimeException('Image is too large to describe (max ~3.5 MB).');
    }

    $prompt = 'Write a short, factual description of this image in 1-2 sentences. '
      . 'Plain prose only, no markdown, no quotes, no preamble like "This image shows". '
      . 'Be concise and concrete.';

    $payload = json_encode([
      'model' => self::MODEL,
      'max_tokens' => self::MAX_TOKENS,
      'messages' => [
        [
          'role' => 'user',
          'content' => [
            [
              'type' => 'image',
              'source' => [
                'type' => 'base64',
                'media_type' => $mimeType,
                'data' => base64_encode($imageBytes),
              ],
            ],
            ['type' => 'text', 'text' => $prompt],
          ],
        ],
      ],
    ]);
    if ($payload === FALSE) {
      throw new \RuntimeException('Failed to encode AI request payload.');
    }

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
      $this->logger->error('Anthropic vision curl error: @error', ['@error' => $curlError]);
      throw new \RuntimeException('Network error contacting Anthropic API.');
    }

    $data = json_decode((string) $response, TRUE);
    if ($httpCode !== 200 || empty($data['content'][0]['text'])) {
      $this->logger->error('Anthropic vision error @code: @body', [
        '@code' => $httpCode,
        '@body' => (string) $response,
      ]);
      throw new \RuntimeException('AI service returned an error (HTTP ' . $httpCode . ').');
    }

    $text = trim((string) $data['content'][0]['text']);
    // Strip surrounding quotes if Claude wraps the response anyway.
    $text = trim($text, "\"' \t\n\r");
    if ($text === '') {
      throw new \RuntimeException('AI returned an empty description.');
    }
    return $text;
  }

}
