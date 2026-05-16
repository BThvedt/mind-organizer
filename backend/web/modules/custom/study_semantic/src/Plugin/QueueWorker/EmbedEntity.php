<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Plugin\QueueWorker;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\Core\Queue\QueueWorkerBase;
use Drupal\Core\Queue\SuspendQueueException;
use Drupal\node\NodeInterface;
use Drupal\study_semantic\Service\EmbeddingClient;
use Drupal\study_semantic\Service\EmbeddingException;
use Drupal\study_semantic\Service\QdrantClient;
use Drupal\study_semantic\Service\TextExtractor;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;

/**
 * Processes embedding jobs queued by study_semantic hooks.
 *
 * Each item is one of:
 *   ['op' => 'embed',  'entity_type' => 'node', 'entity_id' => 123, 'entity_uuid' => '…', 'bundle' => '…']
 *   ['op' => 'delete', 'entity_type' => 'node', 'entity_id' => 123, 'entity_uuid' => '…', 'bundle' => '…']
 *
 * The worker re-loads the entity from storage at processing time so we
 * always embed the latest persisted state, even if the queue has lag.
 *
 * @QueueWorker(
 *   id = "study_semantic_embed",
 *   title = @Translation("Embed entity for semantic search"),
 *   cron = {"time" = 30}
 * )
 */
class EmbedEntity extends QueueWorkerBase implements ContainerFactoryPluginInterface {

  private LoggerInterface $logger;

  public function __construct(
    array $configuration,
    string $plugin_id,
    mixed $plugin_definition,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TextExtractor $textExtractor,
    private readonly EmbeddingClient $embedding,
    private readonly QdrantClient $qdrant,
    private readonly Connection $database,
    LoggerChannelFactoryInterface $loggerFactory,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->logger = $loggerFactory->get('study_semantic');
  }

  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): self {
    return new self(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('study_semantic.text_extractor'),
      $container->get('study_semantic.embedding_client'),
      $container->get('study_semantic.qdrant_client'),
      $container->get('database'),
      $container->get('logger.factory'),
    );
  }

  /**
   * @param array{op: string, entity_type: string, entity_id: int, entity_uuid: string, bundle: string} $data
   */
  public function processItem($data): void {
    if (!is_array($data) || empty($data['op']) || empty($data['entity_type']) || empty($data['entity_id'])) {
      $this->logger->warning('Malformed queue item discarded: @data', ['@data' => json_encode($data)]);
      return;
    }

    $op = (string) $data['op'];
    $entityType = (string) $data['entity_type'];
    $entityId = (int) $data['entity_id'];
    $entityUuidFromQueue = (string) ($data['entity_uuid'] ?? '');
    $bundleFromQueue = (string) ($data['bundle'] ?? '');

    if ($op === 'delete') {
      $this->processDelete($entityType, $entityId, $entityUuidFromQueue);
      return;
    }

    if ($op !== 'embed') {
      $this->logger->warning('Unknown queue op "@op"; dropping item.', ['@op' => $op]);
      return;
    }

    $this->processEmbed($entityType, $entityId, $entityUuidFromQueue, $bundleFromQueue);
  }

  private function processDelete(string $entityType, int $entityId, string $entityUuid): void {
    if ($entityUuid === '') {
      // Try to look up via the bookkeeping row in case the queue payload
      // didnt carry the uuid (older items, manual enqueues, …).
      $row = $this->database->select('content_embeddings', 'ce')
        ->fields('ce', ['entity_uuid'])
        ->condition('entity_type', $entityType)
        ->condition('entity_id', $entityId)
        ->execute()
        ->fetchAssoc();
      if (!$row || empty($row['entity_uuid'])) {
        return;
      }
      $entityUuid = (string) $row['entity_uuid'];
    }

    try {
      $this->qdrant->delete($entityUuid);
    }
    catch (EmbeddingException $e) {
      if ($e->isTransient()) {
        throw new SuspendQueueException($e->getMessage(), 0, $e);
      }
      $this->logger->error('Permanent error deleting @uuid from Qdrant: @msg', [
        '@uuid' => $entityUuid,
        '@msg' => $e->getMessage(),
      ]);
      // Fall through and drop the bookkeeping row anyway — better to leak
      // a stale Qdrant point than to keep retrying a permanent error.
    }

    $this->database->delete('content_embeddings')
      ->condition('entity_type', $entityType)
      ->condition('entity_id', $entityId)
      ->execute();
  }

  private function processEmbed(string $entityType, int $entityId, string $entityUuidFromQueue, string $bundleFromQueue): void {
    $storage = $this->entityTypeManager->getStorage($entityType);
    $entity = $storage->load($entityId);

    if (!$entity instanceof NodeInterface) {
      // Entity was deleted between enqueue and processing — clean up
      // anything that might still be in Qdrant for that id.
      $this->processDelete($entityType, $entityId, $entityUuidFromQueue);
      return;
    }

    $text = $this->textExtractor->extract($entity);
    if ($text === '') {
      // Nothing meaningful to embed (e.g. an empty todo_list). Remove any
      // existing vector so the entity doesnt linger in search.
      $this->processDelete($entityType, $entityId, (string) $entity->uuid());
      return;
    }

    $hash = hash('sha256', $text);
    $existing = $this->database->select('content_embeddings', 'ce')
      ->fields('ce', ['content_hash', 'model_version'])
      ->condition('entity_type', $entityType)
      ->condition('entity_id', $entityId)
      ->execute()
      ->fetchAssoc();

    if (
      $existing
      && (string) $existing['content_hash'] === $hash
      && (string) $existing['model_version'] === EmbeddingClient::MODEL_VERSION
    ) {
      // Nothing has changed since the last embed — skip the API call.
      return;
    }

    try {
      $vector = $this->embedding->embed($text, 'document');
    }
    catch (EmbeddingException $e) {
      if ($e->isTransient()) {
        throw new SuspendQueueException($e->getMessage(), 0, $e);
      }
      $this->logger->error('Permanent embed error for @type/@id: @msg', [
        '@type' => $entityType,
        '@id' => $entityId,
        '@msg' => $e->getMessage(),
      ]);
      return;
    }

    $ownerUid = (int) $entity->getOwnerId();
    $uuid = (string) $entity->uuid();
    $bundle = $entity->bundle();

    // Resolve the include-in-RAG flag. For flashcards (which dont carry
    // the field themselves) the flag is inherited from the parent deck —
    // the RAG endpoint will filter on the parent deck via Qdrant payload,
    // but mirroring it on the card too keeps payload-only filtering simple.
    $includeInRag = $this->resolveIncludeInRag($entity);

    try {
      $this->qdrant->upsert($uuid, $vector, [
        'entity_type' => $entityType,
        'entity_uuid' => $uuid,
        'bundle' => $bundle,
        'owner_uid' => $ownerUid,
        'include_in_rag' => $includeInRag,
      ]);
    }
    catch (EmbeddingException $e) {
      if ($e->isTransient()) {
        throw new SuspendQueueException($e->getMessage(), 0, $e);
      }
      $this->logger->error('Permanent Qdrant upsert error for @type/@id: @msg', [
        '@type' => $entityType,
        '@id' => $entityId,
        '@msg' => $e->getMessage(),
      ]);
      return;
    }

    // Upsert the bookkeeping row. We use merge() so it works on both first-
    // time embeds and refreshes without needing an explicit insert/update split.
    $this->database->merge('content_embeddings')
      ->keys([
        'entity_type' => $entityType,
        'entity_id' => $entityId,
      ])
      ->fields([
        'entity_uuid' => $uuid,
        'bundle' => $bundle,
        'owner_uid' => $ownerUid,
        'content_hash' => $hash,
        'model_version' => EmbeddingClient::MODEL_VERSION,
        'embedded_at' => \Drupal::time()->getRequestTime(),
      ])
      ->execute();
  }

  /**
   * Reads the include-in-RAG flag for the given node.
   *
   * For `flashcard` (which doesnt carry `field_include_in_rag` directly),
   * the flag is read off the parent deck via `field_deck`. If the parent
   * isnt available for any reason, default to FALSE — better to omit from
   * Q&A than to leak content the user expected to be excluded.
   */
  private function resolveIncludeInRag(NodeInterface $node): bool {
    if ($node->bundle() === 'flashcard') {
      if (!$node->hasField('field_deck') || $node->get('field_deck')->isEmpty()) {
        return FALSE;
      }
      /** @var \Drupal\node\NodeInterface|null $deck */
      $deck = $node->get('field_deck')->entity;
      if (!$deck instanceof NodeInterface || !$deck->hasField('field_include_in_rag')) {
        return FALSE;
      }
      return (bool) $deck->get('field_include_in_rag')->value;
    }

    if (!$node->hasField('field_include_in_rag')) {
      // Bundle hasnt been migrated yet; bias-safe default depends on bundle.
      return $node->bundle() === 'study_note';
    }
    if ($node->get('field_include_in_rag')->isEmpty()) {
      return $node->bundle() === 'study_note';
    }
    return (bool) $node->get('field_include_in_rag')->value;
  }

}
