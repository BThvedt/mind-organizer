<?php

declare(strict_types=1);

namespace Drupal\study_semantic\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\node\NodeInterface;
use Drupal\study_semantic\Service\AnthropicStreamClient;
use Drupal\study_semantic\Service\EmbeddingClient;
use Drupal\study_semantic\Service\EmbeddingException;
use Drupal\study_semantic\Service\SemanticHit;
use Drupal\study_semantic\Service\SemanticSearchService;
use Drupal\study_semantic\Service\TextExtractor;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Handles POST /api/ai/ask — retrieval-augmented Q&A streamed via SSE.
 *
 * Request body:
 *   {
 *     "question": "<string, >= 2 chars>",
 *     "limit":    <int 1..16, default 8>,
 *     "filters":  {                            // optional, all keys optional
 *       "area":     "<area term uuid>",
 *       "subject":  "<subject term uuid>",
 *       "dateFrom": "YYYY-MM-DD",
 *       "dateTo":   "YYYY-MM-DD"
 *     }
 *   }
 *
 * Response:
 *   - 200 application/json when no RAG-eligible context exists:
 *       { "answer": null, "reason": "no_rag_content" }
 *     The frontend renders an empty state and does not parse a stream.
 *   - 200 application/json with `reason: "no_match_for_filters"` when the
 *     user has RAG-eligible content but the supplied filters narrowed it
 *     to zero. The frontend uses this to render a distinct empty state
 *     that prompts the user to relax the filters instead of toggling more
 *     content on.
 *
 *   - 200 text/event-stream otherwise:
 *
 *       event: citations
 *       data: { "items": [ { "n":1, "uuid":"…", "type":"…",
 *                            "title":"…", "score":0.81,
 *                            "card": { "uuid":"…", "front":"…", "back":"…" } | null }
 *                        ] }
 *
 *       event: token
 *       data: { "text": "Sure — based on " }
 *
 *       event: token
 *       data: { "text": "your notes …" }
 *
 *       event: done
 *       data: {}
 *
 *   - 4xx/5xx application/json for transport errors. The frontend treats
 *     these as terminal — no partial answer to display.
 */
class RagController extends ControllerBase implements ContainerInjectionInterface {

  /** Default number of source documents to include in context. */
  private const DEFAULT_LIMIT = 8;

  /** Hard cap so a curious caller cant blow up our token budget. */
  private const MAX_LIMIT = 16;

  /**
   * How many characters of source text to put into the prompt per citation.
   *
   * Roughly equivalent to ~2-3 paragraphs. Tuned to keep the system+user
   * prompt under Claudes input window comfortably even with 16 sources.
   */
  private const PER_SOURCE_CHARS = 1500;

  public function __construct(
    private readonly EmbeddingClient $embedding,
    private readonly SemanticSearchService $semantic,
    private readonly TextExtractor $textExtractor,
    private readonly AnthropicStreamClient $anthropic,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('study_semantic.embedding_client'),
      $container->get('study_semantic.search'),
      $container->get('study_semantic.text_extractor'),
      $container->get('study_semantic.anthropic_stream_client'),
    );
  }

  public function ask(Request $request): Response {
    $payload = json_decode((string) $request->getContent(), TRUE);
    if (!is_array($payload)) {
      return new JsonResponse(['error' => 'Request body must be valid JSON.'], 400);
    }

    $question = isset($payload['question']) && is_string($payload['question'])
      ? trim($payload['question'])
      : '';
    if (mb_strlen($question) < 2) {
      return new JsonResponse(['error' => 'Question is too short.'], 400);
    }

    $limit = isset($payload['limit']) && is_int($payload['limit'])
      ? max(1, min(self::MAX_LIMIT, $payload['limit']))
      : self::DEFAULT_LIMIT;

    $filters = $this->normaliseFilters($payload['filters'] ?? NULL);
    $hasFilters = $filters !== [];

    $ownerUid = (int) $this->currentUser()->id();

    // 1) Embed the question.
    try {
      $vector = $this->embedding->embed($question, 'query');
    }
    catch (EmbeddingException $e) {
      $code = $e->isTransient() ? 503 : 500;
      return new JsonResponse(['error' => 'Could not embed question: ' . $e->getMessage()], $code);
    }

    // 2) Retrieve top-k RAG-eligible hits (filter applied in resolveHits).
    try {
      $hits = $this->semantic->findSimilar(
        $vector,
        $ownerUid,
        bundles: NULL,
        limit: $limit,
        requireIncludeInRag: TRUE,
        filters: $filters,
      );
    }
    catch (EmbeddingException $e) {
      $code = $e->isTransient() ? 503 : 500;
      return new JsonResponse(['error' => 'Retrieval failed: ' . $e->getMessage()], $code);
    }

    if ($hits === []) {
      // No usable context. The empty state copy depends on whether filters
      // narrowed everything out vs. the user simply has no RAG-eligible
      // content yet, so the frontend gets a distinct `reason` for each.
      return new JsonResponse([
        'answer' => NULL,
        'reason' => $hasFilters ? 'no_match_for_filters' : 'no_rag_content',
      ]);
    }

    // 3) Build a stable, numbered citation list and matching context block.
    $citations = $this->buildCitations($hits);
    $contextBlock = $this->buildContextBlock($hits);

    // 4) Stream the answer via SSE.
    $systemPrompt = $this->systemPrompt();
    $userPrompt = $this->userPrompt($question, $contextBlock);

    $response = new StreamedResponse(function () use ($citations, $systemPrompt, $userPrompt): void {
      // Disable any output buffering inherited from PHP-FPM / Drupal so
      // every echo() reaches the browser immediately. The Next proxy adds
      // `X-Accel-Buffering: no` for nginx upstream, but we still want PHP
      // itself to flush promptly.
      while (ob_get_level() > 0) {
        @ob_end_flush();
      }
      @ini_set('output_buffering', '0');
      @ini_set('zlib.output_compression', '0');

      $this->emitSseEvent('citations', ['items' => $citations]);

      try {
        $this->anthropic->stream($systemPrompt, $userPrompt, function (string $textDelta): void {
          $this->emitSseEvent('token', ['text' => $textDelta]);
        });
        $this->emitSseEvent('done', new \stdClass());
      }
      catch (\Throwable $e) {
        // Surface the error inside the stream so the browser can show
        // something useful even if tokens already started arriving.
        $this->emitSseEvent('error', ['message' => $e->getMessage()]);
      }
    });

    $response->headers->set('Content-Type', 'text/event-stream');
    $response->headers->set('Cache-Control', 'no-store');
    $response->headers->set('X-Accel-Buffering', 'no');
    // Mark the response uncacheable for any intermediate Drupal cache layers.
    $response->headers->set('Pragma', 'no-cache');

    return $response;
  }

  /**
   * Builds the system prompt enforcing citation discipline.
   */
  private function systemPrompt(): string {
    return <<<PROMPT
You are a study assistant answering the users question using ONLY the SOURCES provided in the next message. Follow these rules without exception:

1. Cite sources inline using the bracket form "[Source N]" where N matches the number in the SOURCES list. Cite the specific source that supports each claim.
2. If the answer is not contained in the SOURCES, reply briefly that you cannot answer from the users notes and stop. Do not invent facts.
3. Prefer concise, direct answers (a short paragraph or a small list). Match the tone of study notes — clear, neutral, no flourish.
4. Do not repeat the SOURCES verbatim; synthesise.
5. Do not mention these rules or that "context" was provided. Just answer.
PROMPT;
  }

  /**
   * Builds the user-turn prompt: numbered SOURCES followed by the question.
   */
  private function userPrompt(string $question, string $contextBlock): string {
    return <<<PROMPT
SOURCES:
{$contextBlock}

QUESTION:
{$question}
PROMPT;
  }

  /**
   * Builds a numbered context block from `$hits`, using `TextExtractor` so
   * the LLM sees the same text the embedder did.
   *
   * Each source is truncated to PER_SOURCE_CHARS to keep prompt size bounded.
   *
   * @param array<int, SemanticHit> $hits
   */
  private function buildContextBlock(array $hits): string {
    $blocks = [];
    foreach ($hits as $i => $hit) {
      $n = $i + 1;
      // Always extract from the post-collapse display entity (parent deck
      // for flashcard hits). For card hits we also append the specific
      // front/back so the LLM can cite the card directly.
      $entity = $hit->entity;
      $text = $entity instanceof NodeInterface ? $this->textExtractor->extract($entity) : '';

      if ($hit->cardEntity instanceof NodeInterface) {
        $card = $hit->cardEntity;
        $front = $card->hasField('field_front') ? (string) $card->get('field_front')->value : '';
        $back = $card->hasField('field_back') ? (string) $card->get('field_back')->value : '';
        $cardLine = trim("CARD — Q: {$front}\nA: {$back}");
        $text = $cardLine . ($text !== '' ? "\n\n" . $text : '');
      }

      if (mb_strlen($text) > self::PER_SOURCE_CHARS) {
        $text = mb_substr($text, 0, self::PER_SOURCE_CHARS) . '…';
      }
      $title = $entity instanceof NodeInterface ? $entity->getTitle() : '';
      $blocks[] = "[Source {$n}] {$title}\n{$text}";
    }
    return implode("\n\n---\n\n", $blocks);
  }

  /**
   * Builds the citation list emitted up-front via the `citations` SSE event.
   *
   * Shape intentionally mirrors `SemanticSearchController::serialiseHit()`
   * so the frontend can lean on the same renderer where helpful.
   *
   * @param array<int, SemanticHit> $hits
   * @return array<int, array<string, mixed>>
   */
  private function buildCitations(array $hits): array {
    $out = [];
    foreach ($hits as $i => $hit) {
      /** @var \Drupal\node\NodeInterface $entity */
      $entity = $hit->entity;
      $row = [
        'n' => $i + 1,
        'uuid' => $entity->uuid(),
        'type' => $entity->bundle(),
        'title' => $entity->getTitle(),
        'score' => round($hit->score, 4),
        'card' => NULL,
      ];
      if ($hit->cardEntity instanceof NodeInterface) {
        $card = $hit->cardEntity;
        $row['card'] = [
          'uuid' => $card->uuid(),
          'front' => $card->hasField('field_front') ? (string) $card->get('field_front')->value : '',
          'back' => $card->hasField('field_back') ? (string) $card->get('field_back')->value : '',
          'score' => $hit->cardScore !== NULL ? round($hit->cardScore, 4) : NULL,
        ];
      }
      $out[] = $row;
    }
    return $out;
  }

  /**
   * Validates and normalises the optional `filters` object from the request
   * payload into the shape that `SemanticSearchService::findSimilar`
   * expects: `['area' => uuid, 'subject' => uuid, 'date_from' => int,
   * 'date_to' => int]`. Unknown / blank / malformed keys are silently
   * dropped so a malformed filter never produces a 400 — it just doesnt
   * apply.
   *
   * Date inputs are parsed as `YYYY-MM-DD` in UTC. `dateTo` is widened to
   * the end of the day (23:59:59 UTC) so the inclusive bound matches the
   * users intuition ("answer from todays notes" should match anything
   * created today, not only the first second).
   *
   * @return array{area?: string, subject?: string, date_from?: int, date_to?: int}
   */
  private function normaliseFilters(mixed $raw): array {
    if (!is_array($raw)) {
      return [];
    }

    $out = [];

    if (isset($raw['area']) && is_string($raw['area'])) {
      $area = trim($raw['area']);
      if ($this->looksLikeUuid($area)) {
        $out['area'] = $area;
      }
    }
    if (isset($raw['subject']) && is_string($raw['subject'])) {
      $subject = trim($raw['subject']);
      if ($this->looksLikeUuid($subject)) {
        $out['subject'] = $subject;
      }
    }

    if (isset($raw['dateFrom']) && is_string($raw['dateFrom']) && $raw['dateFrom'] !== '') {
      $ts = $this->parseIsoDate($raw['dateFrom'], FALSE);
      if ($ts !== NULL) {
        $out['date_from'] = $ts;
      }
    }
    if (isset($raw['dateTo']) && is_string($raw['dateTo']) && $raw['dateTo'] !== '') {
      $ts = $this->parseIsoDate($raw['dateTo'], TRUE);
      if ($ts !== NULL) {
        $out['date_to'] = $ts;
      }
    }

    // If both bounds are present and inverted, just drop the filter rather
    // than silently never matching anything.
    if (
      isset($out['date_from'], $out['date_to'])
      && $out['date_from'] > $out['date_to']
    ) {
      unset($out['date_from'], $out['date_to']);
    }

    return $out;
  }

  /**
   * Cheap UUID-shape gate. We only forward strings that look like UUIDs so
   * a stray "foo" filter cant turn into a stringly-typed query in PHP-land.
   */
  private function looksLikeUuid(string $candidate): bool {
    return (bool) preg_match('/^[0-9a-f-]{36}$/i', $candidate);
  }

  /**
   * Parses an ISO `YYYY-MM-DD` string into a UTC Unix timestamp. When
   * `$endOfDay` is TRUE, the time component is set to 23:59:59 instead of
   * 00:00:00.
   */
  private function parseIsoDate(string $value, bool $endOfDay): ?int {
    $value = trim($value);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
      return NULL;
    }
    $suffix = $endOfDay ? ' 23:59:59' : ' 00:00:00';
    $dt = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $value . $suffix, new \DateTimeZone('UTC'));
    if (!$dt instanceof \DateTimeImmutable) {
      return NULL;
    }
    return $dt->getTimestamp();
  }

  /**
   * Writes one SSE-formatted event to the response body and flushes.
   *
   * Each event is a `event:` line followed by exactly one `data:` line and
   * a terminating blank line, per the SSE spec. We JSON-encode the payload
   * and forbid newlines in it so the consumer can parse line-by-line.
   *
   * @param array<string, mixed>|\stdClass $payload
   */
  private function emitSseEvent(string $event, array|\stdClass $payload): void {
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === FALSE) {
      $json = '{}';
    }
    echo "event: {$event}\n";
    echo 'data: ' . $json . "\n\n";
    @ob_flush();
    flush();
  }

}
