<?php

declare(strict_types=1);

namespace Drupal\study_flashcard_generator\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\study_flashcard_generator\Service\AiFlashcardService;
use Drupal\study_flashcard_generator\Service\ManualSelectionService;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Handles POST /api/study/generate-flashcards.
 *
 * Request body (JSON):
 *   {
 *     "note_id": "<uuid>",
 *     "mode": "ai" | "manual",
 *     "selections": [{ "front": "...", "back": "..." }]  // manual mode only
 *   }
 *
 * Response:
 *   { "candidates": [{ "front": "...", "back": "..." }] }
 */
class FlashcardGeneratorController extends ControllerBase {

  public function __construct(
    private readonly AiFlashcardService $aiService,
    private readonly ManualSelectionService $manualService,
  ) {}

  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('study_flashcard_generator.ai_service'),
      $container->get('study_flashcard_generator.manual_service'),
    );
  }

  /**
   * POST /api/study/generate-from-prompt
   *
   * Request body (JSON):
   *   { "prompt": "<free-form text>", "limit": 10 }
   *
   * Response:
   *   { "candidates": [{ "front": "...", "back": "..." }] }
   */
  public function generateFromPrompt(Request $request): JsonResponse {
    $body = json_decode($request->getContent(), TRUE);

    $prompt = trim($body['prompt'] ?? '');
    if (empty($prompt)) {
      return new JsonResponse(['error' => 'prompt is required.'], 400);
    }

    $limit = isset($body['limit']) ? (int) $body['limit'] : 10;

    try {
      $candidates = $this->aiService->generateFromPrompt($prompt, $limit);
    }
    catch (\Exception $e) {
      return new JsonResponse(['error' => 'Generation failed: ' . $e->getMessage()], 500);
    }

    return new JsonResponse(['candidates' => $candidates]);
  }

  public function generate(Request $request): JsonResponse {
    $body = json_decode($request->getContent(), TRUE);

    if (empty($body['note_id'])) {
      return new JsonResponse(['error' => 'note_id is required.'], 400);
    }

    $mode = $body['mode'] ?? 'ai';

    if (!in_array($mode, ['ai', 'manual'], TRUE)) {
      return new JsonResponse(['error' => 'mode must be "ai" or "manual".'], 400);
    }

    // Load and authorise the note node.
    $storage = $this->entityTypeManager()->getStorage('node');
    $nodes = $storage->loadByProperties([
      'type' => 'study_note',
      'uuid' => $body['note_id'],
    ]);

    if (empty($nodes)) {
      return new JsonResponse(['error' => 'Note not found.'], 404);
    }

    $note = reset($nodes);

    // Ensure the current user owns this note.
    if ($note->getOwnerId() !== (int) $this->currentUser()->id()) {
      return new JsonResponse(['error' => 'Access denied.'], 403);
    }

    try {
      if ($mode === 'ai') {
        $markdown = $note->get('field_body')->value ?? '';
        if (empty(trim($markdown))) {
          return new JsonResponse(['error' => 'Note body is empty.'], 422);
        }
        $candidates = $this->aiService->generate($markdown);
      }
      else {
        $selections = $body['selections'] ?? [];
        if (empty($selections)) {
          return new JsonResponse(['error' => 'selections are required for manual mode.'], 400);
        }
        $candidates = $this->manualService->process($selections);
      }
    }
    catch (\Exception $e) {
      return new JsonResponse(['error' => 'Generation failed: ' . $e->getMessage()], 500);
    }

    return new JsonResponse(['candidates' => $candidates]);
  }

}
