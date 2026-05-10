<?php

declare(strict_types=1);

namespace Drupal\media_functionality\Service;

use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Http\Message\StreamInterface;
use Psr\Log\LoggerInterface;

/**
 * Thin wrapper around the AWS S3 SDK.
 *
 * Reads credentials from environment variables (set via
 * backend/.ddev/config.local.yaml locally, or the prod server's .env).
 */
class S3Service {

  private LoggerInterface $logger;
  private ?S3Client $client = NULL;

  public function __construct(LoggerChannelFactoryInterface $loggerFactory) {
    $this->logger = $loggerFactory->get('media_functionality');
  }

  private function client(): S3Client {
    if ($this->client !== NULL) {
      return $this->client;
    }
    $region = getenv('AWS_REGION') ?: '';
    $key = getenv('AWS_ACCESS_KEY_ID') ?: '';
    $secret = getenv('AWS_SECRET_ACCESS_KEY') ?: '';
    if ($region === '' || $key === '' || $secret === '') {
      throw new \RuntimeException('AWS credentials are not configured (AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).');
    }
    $this->client = new S3Client([
      'version' => 'latest',
      'region' => $region,
      'credentials' => [
        'key' => $key,
        'secret' => $secret,
      ],
    ]);
    return $this->client;
  }

  private function bucket(): string {
    $bucket = getenv('AWS_S3_BUCKET') ?: '';
    if ($bucket === '') {
      throw new \RuntimeException('AWS_S3_BUCKET is not configured.');
    }
    return $bucket;
  }

  /**
   * Builds an S3 object key.
   *
   * Format: <prefix>/media/<user-uuid>/<asset-uuid>/<filename>
   * The prefix (typically "dev" or "prod") keeps environments segregated
   * inside one bucket.
   */
  public function buildKey(string $userUuid, string $assetUuid, string $filename): string {
    $prefix = trim((string) (getenv('AWS_S3_PREFIX') ?: ''), '/');
    $safeName = $this->sanitizeFilename($filename);
    $head = $prefix !== '' ? $prefix . '/' : '';
    return $head . 'media/' . $userUuid . '/' . $assetUuid . '/' . $safeName;
  }

  public function putObject(string $key, string $body, string $contentType): void {
    try {
      $this->client()->putObject([
        'Bucket' => $this->bucket(),
        'Key' => $key,
        'Body' => $body,
        'ContentType' => $contentType,
      ]);
    }
    catch (S3Exception $e) {
      $this->logger->error('S3 putObject failed for @key: @msg', ['@key' => $key, '@msg' => $e->getMessage()]);
      throw new \RuntimeException('Failed to store media in S3.', 0, $e);
    }
  }

  /**
   * Returns a streaming body for an S3 object.
   *
   * The returned stream is read incrementally by the controller so we never
   * load the full media payload into PHP memory.
   */
  public function getObjectStream(string $key): StreamInterface {
    try {
      $result = $this->client()->getObject([
        'Bucket' => $this->bucket(),
        'Key' => $key,
      ]);
    }
    catch (S3Exception $e) {
      $this->logger->error('S3 getObject failed for @key: @msg', ['@key' => $key, '@msg' => $e->getMessage()]);
      throw new \RuntimeException('Failed to fetch media from S3.', 0, $e);
    }
    /** @var \Psr\Http\Message\StreamInterface $body */
    $body = $result['Body'];
    return $body;
  }

  public function deleteObject(string $key): void {
    try {
      $this->client()->deleteObject([
        'Bucket' => $this->bucket(),
        'Key' => $key,
      ]);
    }
    catch (S3Exception $e) {
      // Soft-delete in DB still proceeds even if the S3 object is gone.
      $this->logger->warning('S3 deleteObject failed for @key (continuing): @msg', ['@key' => $key, '@msg' => $e->getMessage()]);
    }
  }

  /**
   * Removes path components and unsafe characters from a filename.
   */
  private function sanitizeFilename(string $name): string {
    $name = basename($name);
    $name = preg_replace('/[^A-Za-z0-9._-]+/', '_', $name) ?? 'file';
    $name = trim($name, '._-');
    if ($name === '') {
      $name = 'file';
    }
    return mb_substr($name, 0, 120);
  }

}
