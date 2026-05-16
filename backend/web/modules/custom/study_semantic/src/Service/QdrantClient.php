<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Service;

use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Thin client for Qdrants REST API.
 *
 * One collection ("content_embeddings"), one vector per entity (point id =
 * entity UUID), payload carries the bookkeeping fields we filter on at
 * search time (`owner_uid`, `bundle`, `entity_type`, `entity_uuid`).
 *
 * Cosine distance is sufficient for our use case and matches what Voyage
 * recommends for `voyage-3-lite`.
 */
class QdrantClient {

  public const COLLECTION = 'content_embeddings';
  private const TIMEOUT_SECONDS = 10;

  private LoggerInterface $logger;

  public function __construct(LoggerChannelFactoryInterface $loggerFactory) {
    $this->logger = $loggerFactory->get('study_semantic');
  }

  /**
   * Creates the collection if it doesnt exist.
   *
   * Safe to call repeatedly; subsequent calls are no-ops as long as the
   * existing collections vector size matches.
   */
  public function ensureCollection(): void {
    $existing = $this->request('GET', '/collections/' . self::COLLECTION, NULL, [404]);
    $httpCode = $existing['code'];
    if ($httpCode === 200) {
      // Sanity-check vector size if we can see it.
      $size = $existing['body']['result']['config']['params']['vectors']['size'] ?? NULL;
      if ($size !== NULL && (int) $size !== EmbeddingClient::DIMENSIONS) {
        $this->logger->error(
          'Qdrant collection @name exists with vector size @size; expected @expected. A model change requires recreating the collection.',
          [
            '@name' => self::COLLECTION,
            '@size' => $size,
            '@expected' => EmbeddingClient::DIMENSIONS,
          ],
        );
      }
      return;
    }

    $this->request('PUT', '/collections/' . self::COLLECTION, [
      'vectors' => [
        'size' => EmbeddingClient::DIMENSIONS,
        'distance' => 'Cosine',
      ],
    ]);

    // Payload indexes speed up the owner/bundle filters we always apply.
    $this->request('PUT', '/collections/' . self::COLLECTION . '/index', [
      'field_name' => 'owner_uid',
      'field_schema' => 'integer',
    ]);
    $this->request('PUT', '/collections/' . self::COLLECTION . '/index', [
      'field_name' => 'bundle',
      'field_schema' => 'keyword',
    ]);
    // `include_in_rag` is filtered on every RAG query; bool index keeps it cheap.
    $this->request('PUT', '/collections/' . self::COLLECTION . '/index', [
      'field_name' => 'include_in_rag',
      'field_schema' => 'bool',
    ]);
  }

  /**
   * Creates the include_in_rag payload index on a collection that already
   * exists. Safe to call repeatedly: Qdrant returns 200 if the index is
   * already present. Used by `study_semantic_update_10002` to backfill the
   * index for environments that ran `ensureCollection()` before the index
   * was added.
   */
  public function ensureIncludeInRagIndex(): void {
    $this->request('PUT', '/collections/' . self::COLLECTION . '/index', [
      'field_name' => 'include_in_rag',
      'field_schema' => 'bool',
    ]);
  }

  /**
   * Upserts a single point.
   *
   * @param string $pointId
   *   Stable point id — we use the entity UUID so re-embeds of the same
   *   entity replace the existing vector cleanly.
   * @param array<int, float> $vector
   * @param array<string, mixed> $payload
   */
  public function upsert(string $pointId, array $vector, array $payload): void {
    $this->request('PUT', '/collections/' . self::COLLECTION . '/points?wait=true', [
      'points' => [
        [
          'id' => $pointId,
          'vector' => $vector,
          'payload' => $payload,
        ],
      ],
    ]);
  }

  /**
   * Deletes a single point by id.
   */
  public function delete(string $pointId): void {
    $this->request('POST', '/collections/' . self::COLLECTION . '/points/delete?wait=true', [
      'points' => [$pointId],
    ]);
  }

  /**
   * Vector similarity search.
   *
   * @param array<int, float> $vector
   * @param int $ownerUid
   * @param array<int, string>|null $bundles
   *   Restrict to these bundle values, or NULL for no bundle filter.
   * @param int $limit
   * @param float $scoreThreshold
   *
   * @return array<int, array{id: string, score: float, payload: array<string, mixed>}>
   */
  public function search(
    array $vector,
    int $ownerUid,
    ?array $bundles,
    int $limit,
    float $scoreThreshold,
  ): array {
    $body = [
      'vector' => $vector,
      'limit' => $limit,
      'with_payload' => TRUE,
      'score_threshold' => $scoreThreshold,
      'filter' => $this->buildFilter($ownerUid, $bundles),
    ];
    $res = $this->request('POST', '/collections/' . self::COLLECTION . '/points/search', $body);
    return $this->normaliseHits($res['body']['result'] ?? []);
  }

  /**
   * Seeds a "more like this" recommendation from one or more existing points.
   *
   * @param array<int, string> $positiveIds
   * @param int $ownerUid
   * @param array<int, string>|null $bundles
   * @param int $limit
   * @param float $scoreThreshold
   *
   * @return array<int, array{id: string, score: float, payload: array<string, mixed>}>
   */
  public function recommend(
    array $positiveIds,
    int $ownerUid,
    ?array $bundles,
    int $limit,
    float $scoreThreshold,
  ): array {
    $body = [
      'positive' => array_values($positiveIds),
      'limit' => $limit,
      'with_payload' => TRUE,
      'score_threshold' => $scoreThreshold,
      'filter' => $this->buildFilter($ownerUid, $bundles),
    ];
    $res = $this->request('POST', '/collections/' . self::COLLECTION . '/points/recommend', $body);
    return $this->normaliseHits($res['body']['result'] ?? []);
  }

  /**
   * @param array<int, string>|null $bundles
   * @return array<string, mixed>
   */
  private function buildFilter(int $ownerUid, ?array $bundles): array {
    $must = [
      [
        'key' => 'owner_uid',
        'match' => ['value' => $ownerUid],
      ],
    ];
    if ($bundles !== NULL && $bundles !== []) {
      $must[] = [
        'key' => 'bundle',
        'match' => ['any' => array_values($bundles)],
      ];
    }
    return ['must' => $must];
  }

  /**
   * @param array<int, array<string, mixed>> $hits
   * @return array<int, array{id: string, score: float, payload: array<string, mixed>}>
   */
  private function normaliseHits(array $hits): array {
    $out = [];
    foreach ($hits as $hit) {
      if (!isset($hit['id'], $hit['score'])) {
        continue;
      }
      $out[] = [
        'id' => (string) $hit['id'],
        'score' => (float) $hit['score'],
        'payload' => is_array($hit['payload'] ?? NULL) ? $hit['payload'] : [],
      ];
    }
    return $out;
  }

  /**
   * Issues a JSON request to Qdrant.
   *
   * @param 'GET'|'POST'|'PUT'|'DELETE' $method
   * @param string $path
   * @param array<string, mixed>|null $body
   * @param array<int, int> $okExtraCodes
   *   Status codes (besides 2xx) we should treat as non-fatal — used by
   *   ensureCollection() to detect "collection doesnt exist yet".
   *
   * @return array{code: int, body: array<string, mixed>}
   */
  private function request(string $method, string $path, ?array $body = NULL, array $okExtraCodes = []): array {
    $base = getenv('QDRANT_URL');
    if (!is_string($base) || $base === '') {
      throw new EmbeddingException('QDRANT_URL is not configured.', EmbeddingException::PERMANENT);
    }
    $url = rtrim($base, '/') . $path;

    $ch = curl_init($url);
    $opts = [
      CURLOPT_RETURNTRANSFER => TRUE,
      CURLOPT_CUSTOMREQUEST => $method,
      CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
      CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ];
    if ($body !== NULL) {
      $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_THROW_ON_ERROR);
    }
    curl_setopt_array($ch, $opts);

    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '') {
      $this->logger->warning('Qdrant curl error on @method @path: @err', [
        '@method' => $method,
        '@path' => $path,
        '@err' => $curlError,
      ]);
      throw new EmbeddingException('Network error contacting Qdrant.', EmbeddingException::TRANSIENT);
    }

    $decoded = is_string($response) ? json_decode($response, TRUE) : NULL;
    $decoded = is_array($decoded) ? $decoded : [];

    $ok = ($httpCode >= 200 && $httpCode < 300) || in_array($httpCode, $okExtraCodes, TRUE);
    if (!$ok) {
      $isTransient = $httpCode === 429 || ($httpCode >= 500 && $httpCode < 600);
      $this->logger->error('Qdrant @method @path HTTP @code: @body', [
        '@method' => $method,
        '@path' => $path,
        '@code' => $httpCode,
        '@body' => is_string($response) ? mb_substr($response, 0, 500) : '',
      ]);
      throw new EmbeddingException(
        'Qdrant returned HTTP ' . $httpCode . ' for ' . $method . ' ' . $path . '.',
        $isTransient ? EmbeddingException::TRANSIENT : EmbeddingException::PERMANENT,
      );
    }

    return ['code' => $httpCode, 'body' => $decoded];
  }

}
