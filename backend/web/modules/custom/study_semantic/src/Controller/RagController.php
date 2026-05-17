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
 *   { "question": "<string, >= 2 chars>", "limit": <int 1..16, default 8> }
 *
 * Response:
 *   - 200 application/json when no RAG-eligible context exists:
 *       { "answer": null, "reason": "no_rag_content" }
 *     The frontend renders an empty state and does not parse a stream.
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
      );
    }
    catch (EmbeddingException $e) {
      $code = $e->isTransient() ? 503 : 500;
      return new JsonResponse(['error' => 'Retrieval failed: ' . $e->getMessage()], $code);
    }

    if ($hits === []) {
      // No usable context. Hand the frontend a non-streaming sentinel so
      // it can render an empty state without parsing an SSE stream.
      return new JsonResponse([
        'answer' => NULL,
        'reason' => 'no_rag_content',
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
