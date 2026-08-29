<?php

declare(strict_types=1);

namespace Drupal\study_flashcard_audio\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\study_flashcard_audio\Service\AudioGenerationService;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * REST endpoints for flashcard audio generation and management.
 *
 * Mounted at /api/study/flashcard-audio/* (see routing.yml).
 */
class FlashcardAudioController extends ControllerBase {

  public function __construct(
    private readonly AudioGenerationService $audioService,
  ) {}

  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('study_flashcard_audio.generator'),
    );
  }

  /**
   * POST /api/study/flashcard-audio/generate
   *
   * Body: { "card": "<uuid>", "face": "front"|"back" }
   * Returns: { "uuid": "<uuid>", "url": "/api/media/<uuid>/file" }
   */
  public function generate(Request $request): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $body = json_decode($request->getContent(), TRUE);
    if (!is_array($body)) {
      return $this->json(['error' => 'Invalid JSON body.'], 400);
    }

    $cardUuid = isset($body['card']) && is_string($body['card']) ? trim($body['card']) : '';
    $face = isset($body['face']) && $body['face'] === 'back' ? 'back' : 'front';

    if ($cardUuid === '') {
      return $this->json(['error' => 'Missing or empty "card" uuid.'], 400);
    }

    try {
      $result = $this->audioService->generate($cardUuid, $face);
      return $this->json($result, 201);
    }
    catch (\RuntimeException $e) {
      $message = $e->getMessage();
      if (str_contains($message, 'OPENAI_API_KEY is not configured')) {
        return $this->json(['error' => $message], 503);
      }
      return $this->json(['error' => $message], 400);
    }
  }

  /**
   * DELETE /api/study/flashcard-audio/{uuid}/delete
   *
   * Soft-deletes the audio asset with the given UUID and clears the
   * referencing card field.
   */
  public function delete(string $uuid): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    try {
      $this->audioService->delete($uuid);
      return $this->json(['status' => 'deleted']);
    }
    catch (\RuntimeException $e) {
      return $this->json(['error' => $e->getMessage()], 404);
    }
  }

  /**
   * GET /api/study/flashcard-audio
   *
   * Lists all flashcard audio assets belonging to the current user,
   * with card and deck context.
   */
  public function list(): JsonResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return $this->json(['error' => 'Unauthenticated'], 401);
    }

    $uid = (int) $account->id();

    $assets = $this->audioService->listForUser($uid);

    return $this->json(['data' => $assets]);
  }

  private function json(array $payload, int $status = 200): JsonResponse {
    $response = new JsonResponse($payload, $status);
    $response->headers->set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return $response;
  }

}