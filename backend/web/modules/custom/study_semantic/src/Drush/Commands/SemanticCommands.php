<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Drush\Commands;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drush\Attributes as CLI;
use Drush\Commands\AutowireTrait;
use Drush\Commands\DrushCommands;

/**
 * Drush commands for the study_semantic module.
 *
 * Use after a fresh install or after bumping the embedding model to push
 * every embeddable node onto the queue. The actual embedding/upsert happens
 * in the queue worker — run `drush queue:run study_semantic_embed` (or wait
 * for cron) to drain it afterwards.
 */
final class SemanticCommands extends DrushCommands {

  use AutowireTrait;

  /**
   * Bundles that the embedding pipeline knows how to flatten.
   */
  private const EMBEDDED_BUNDLES = [
    'study_note',
    'flashcard_deck',
    'flashcard',
    'todo_list',
  ];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
  ) {
    parent::__construct();
  }

  /**
   * Re-queues embeddable entities for the semantic search index.
   *
   * By default queues every node in every embedded bundle. Pass --bundle
   * one or more times to limit the scope. Pass --only-stale to skip nodes
   * whose stored `content_embeddings.model_version` already matches the
   * current EmbeddingClient::MODEL_VERSION (cheaper after a partial backfill).
   *
   * The queue worker handles dedupe/hash-skip on its own, so re-running
   * this command is always safe.
   */
  #[CLI\Command(name: 'study:semantic-backfill', aliases: ['ssb'])]
  #[CLI\Option(name: 'bundle', description: 'Restrict to a specific bundle. Repeatable. Defaults to all embedded bundles.')]
  #[CLI\Option(name: 'only-stale', description: 'Only enqueue nodes whose stored model_version is missing or different from the current EmbeddingClient::MODEL_VERSION.')]
  #[CLI\Usage(name: 'drush study:semantic-backfill', description: 'Enqueue every embeddable node.')]
  #[CLI\Usage(name: 'drush study:semantic-backfill --bundle=study_note --bundle=flashcard_deck', description: 'Only notes and decks.')]
  #[CLI\Usage(name: 'drush study:semantic-backfill --only-stale', description: 'Re-embed only entities pointing at an older model.')]
  public function backfill(array $options = ['bundle' => [], 'only-stale' => FALSE]): void {
    $bundles = $this->resolveBundles((array) ($options['bundle'] ?? []));
    $onlyStale = (bool) ($options['only-stale'] ?? FALSE);

    $storage = $this->entityTypeManager->getStorage('node');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('type', $bundles, 'IN');
    $nids = $query->execute();

    if (!$nids) {
      $this->logger()->notice('No nodes match those bundles.');
      return;
    }

    if ($onlyStale) {
      $nids = $this->filterStale(array_map('intval', array_values($nids)));
      if (!$nids) {
        $this->logger()->notice('All matching nodes are already on the current model.');
        return;
      }
    }

    $queue = \Drupal::queue('study_semantic_embed');
    $count = 0;

    // Load in chunks so we can build the queue item payload (uuid, bundle)
    // without holding every node in memory at once.
    foreach (array_chunk(array_map('intval', array_values($nids)), 200) as $chunk) {
      $nodes = $storage->loadMultiple($chunk);
      foreach ($nodes as $node) {
        $queue->createItem([
          'op' => 'embed',
          'entity_type' => 'node',
          'entity_id' => (int) $node->id(),
          'entity_uuid' => (string) $node->uuid(),
          'bundle' => $node->bundle(),
        ]);
        $count++;
      }
    }

    $this->logger()->success(sprintf(
      'Enqueued %d node(s). Drain with: drush queue:run study_semantic_embed',
      $count,
    ));
  }

  /**
   * Prints quick stats about the embedding pipeline.
   *
   * Includes a per-bundle RAG-eligible count so we can answer "the Ask AI
   * page says I have nothing, but I have notes — whats wrong?" with a
   * single command.
   */
  #[CLI\Command(name: 'study:semantic-status', aliases: ['sss'])]
  public function status(): void {
    $rows = $this->database->select('content_embeddings', 'ce')
      ->fields('ce', ['bundle', 'model_version'])
      ->execute()
      ->fetchAll();

    if (!$rows) {
      $this->output()->writeln('No embeddings stored yet.');
      return;
    }

    $byBundle = [];
    $byVersion = [];
    foreach ($rows as $row) {
      $byBundle[$row->bundle] = ($byBundle[$row->bundle] ?? 0) + 1;
      $byVersion[$row->model_version] = ($byVersion[$row->model_version] ?? 0) + 1;
    }

    $this->output()->writeln('Embeddings by bundle:');
    foreach ($byBundle as $bundle => $n) {
      $this->output()->writeln(sprintf('  %-16s %d', $bundle, $n));
    }

    $ragCounts = $this->countsByRagEligibility();
    $this->output()->writeln('');
    $this->output()->writeln('RAG-eligible (field_include_in_rag = 1):');
    foreach (self::RAG_BUNDLES as $bundle) {
      $total = $ragCounts[$bundle]['total'] ?? 0;
      $included = $ragCounts[$bundle]['included'] ?? 0;
      $this->output()->writeln(sprintf(
        '  %-16s %d / %d',
        $bundle,
        $included,
        $total,
      ));
    }
    // Flashcards inherit from their parent deck — list them separately so
    // the bundle column isnt misleading.
    $flashcards = $ragCounts['flashcard'] ?? ['total' => 0, 'included' => 0];
    $this->output()->writeln(sprintf(
      '  %-16s %d / %d  (inherit parent deck)',
      'flashcard',
      $flashcards['included'],
      $flashcards['total'],
    ));

    $this->output()->writeln('');
    $this->output()->writeln('Embeddings by model_version:');
    foreach ($byVersion as $version => $n) {
      $this->output()->writeln(sprintf('  %-20s %d', $version, $n));
    }

    $queueDepth = \Drupal::queue('study_semantic_embed')->numberOfItems();
    $this->output()->writeln('');
    $this->output()->writeln(sprintf('Pending queue items: %d', $queueDepth));
  }

  /**
   * Bundles that carry `field_include_in_rag` directly. Flashcards are
   * intentionally excluded — they read the flag from their parent deck.
   */
  private const RAG_BUNDLES = ['study_note', 'flashcard_deck', 'todo_list'];

  /**
   * Returns `[bundle => ['total' => N, 'included' => M]]` rows for the
   * RAG-eligible breakdown. Flashcards are counted by walking parent decks.
   *
   * @return array<string, array{total: int, included: int}>
   */
  private function countsByRagEligibility(): array {
    $out = [];
    $storage = $this->entityTypeManager->getStorage('node');

    foreach (self::RAG_BUNDLES as $bundle) {
      $totalQuery = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('type', $bundle);
      $total = (int) $totalQuery->count()->execute();

      $includedQuery = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('type', $bundle)
        ->condition('field_include_in_rag', 1);
      $included = (int) $includedQuery->count()->execute();

      $out[$bundle] = ['total' => $total, 'included' => $included];
    }

    // Flashcards: count cards whose parent deck has field_include_in_rag = 1.
    $totalCards = (int) $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('type', 'flashcard')
      ->count()
      ->execute();

    // Cards inheriting a TRUE flag = cards with a deck reference where the
    // referenced deck has field_include_in_rag = 1. Joins the card-side
    // field_deck table to the deck-side field_include_in_rag table on the
    // deck nid; we count rows directly to avoid a second pass.
    $q = $this->database->select('node__field_deck', 'fd');
    $q->innerJoin(
      'node__field_include_in_rag',
      'rag',
      'rag.entity_id = fd.field_deck_target_id AND rag.bundle = :rag_bundle',
      [':rag_bundle' => 'flashcard_deck'],
    );
    $q->condition('fd.bundle', 'flashcard');
    $q->condition('rag.field_include_in_rag_value', 1);
    $q->addExpression('COUNT(*)');
    $includedCards = (int) $q->execute()->fetchField();

    $out['flashcard'] = ['total' => $totalCards, 'included' => $includedCards];

    return $out;
  }

  /**
   * @param array<int, string> $userBundles
   * @return array<int, string>
   */
  private function resolveBundles(array $userBundles): array {
    if ($userBundles === []) {
      return self::EMBEDDED_BUNDLES;
    }
    $invalid = array_diff($userBundles, self::EMBEDDED_BUNDLES);
    if ($invalid !== []) {
      throw new \InvalidArgumentException(
        'Unknown bundle(s): ' . implode(', ', $invalid)
        . '. Allowed: ' . implode(', ', self::EMBEDDED_BUNDLES),
      );
    }
    return array_values($userBundles);
  }

  /**
   * @param array<int, int> $nids
   * @return array<int, int>
   */
  private function filterStale(array $nids): array {
    if ($nids === []) {
      return [];
    }
    $current = \Drupal\study_semantic\Service\EmbeddingClient::MODEL_VERSION;
    $rows = $this->database->select('content_embeddings', 'ce')
      ->fields('ce', ['entity_id', 'model_version'])
      ->condition('entity_type', 'node')
      ->condition('entity_id', $nids, 'IN')
      ->execute()
      ->fetchAllKeyed();

    $stale = [];
    foreach ($nids as $nid) {
      $stored = $rows[$nid] ?? NULL;
      if ($stored === NULL || (string) $stored !== $current) {
        $stale[] = $nid;
      }
    }
    return $stale;
  }

}
