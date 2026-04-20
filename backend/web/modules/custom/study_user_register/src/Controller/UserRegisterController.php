<?php

namespace Drupal\study_user_register\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Handles public user registration for the Mind Organizer frontend.
 */
class UserRegisterController extends ControllerBase {

  /**
   * Creates a new user account.
   *
   * POST /api/user/register
   * Body: { "username": "...", "email": "...", "password": "..." }
   */
  public function register(Request $request): JsonResponse {
    $data = json_decode($request->getContent(), TRUE);

    $username = trim($data['username'] ?? '');
    $email    = trim($data['email'] ?? '');
    $password = $data['password'] ?? '';

    if ($username === '' || $email === '' || $password === '') {
      return new JsonResponse(['error' => 'Username, email, and password are required.'], 422);
    }

    // Validate email format.
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
      return new JsonResponse(['error' => 'Invalid email address.'], 422);
    }

    // Check username uniqueness.
    $existing = \Drupal::entityQuery('user')
      ->accessCheck(FALSE)
      ->condition('name', $username)
      ->execute();
    if (!empty($existing)) {
      return new JsonResponse(['error' => 'That username is already taken.'], 409);
    }

    // Check email uniqueness.
    $existing = \Drupal::entityQuery('user')
      ->accessCheck(FALSE)
      ->condition('mail', $email)
      ->execute();
    if (!empty($existing)) {
      return new JsonResponse(['error' => 'An account with that email already exists.'], 409);
    }

    $user = User::create([
      'name'   => $username,
      'mail'   => $email,
      'pass'   => $password,
      'status' => 1,
    ]);

    $violations = $user->validate();
    if (count($violations) > 0) {
      $messages = [];
      foreach ($violations as $violation) {
        $messages[] = $violation->getMessage();
      }
      return new JsonResponse(['error' => implode(' ', $messages)], 422);
    }

    $user->save();

    return new JsonResponse(['id' => $user->uuid()], 201);
  }

}
