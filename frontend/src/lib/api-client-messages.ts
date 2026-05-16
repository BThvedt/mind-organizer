/**
 * User-visible copy when the app has no valid session for an API call.
 * Prefer checking `response.status === 401` after a fetch.
 */
export const SESSION_EXPIRED_MESSAGE =
  'Your session expired. Please sign in again.';

export class ApiUnauthorizedError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'ApiUnauthorizedError';
  }
}

/**
 * Maps a failed JSON API response to a short message. Treats HTTP 401 as a signed-out
 * session regardless of JSON body.
 */
export function userFacingMessageForApiError(
  res: Response,
  body: unknown,
  genericFallback: string
): string {
  if (res.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'string'
  ) {
    return (body as { error: string }).error;
  }
  return genericFallback;
}

/** Shown when `/api/search` (or similar) returns a non-401 error body. */
export const SEARCH_HTTP_FALLBACK_MESSAGE = 'Search failed. Please try again.';

export const SEARCH_OFFLINE_MESSAGE =
  "You're offline. Search isn't available until you reconnect.";

export const SEARCH_CONNECTION_FAILED_MESSAGE =
  "Couldn't complete search. Check your connection and try again.";

/** Use in `catch` after a failed search `fetch` (timeout, network error). */
export function messageWhenSearchRequestThrows(): string {
  return typeof navigator !== 'undefined' && !navigator.onLine
    ? SEARCH_OFFLINE_MESSAGE
    : SEARCH_CONNECTION_FAILED_MESSAGE;
}

/**
 * Inline warning when the semantic half of a hybrid search fails but the
 * keyword half succeeded (or vice versa). The dialog still renders the
 * results it did get, and surfaces this near the divider so the user knows
 * AI matches arent in play right now.
 */
export const SEMANTIC_SEARCH_DEGRADED_MESSAGE =
  "AI search is temporarily unavailable. Showing keyword matches only.";

export const KEYWORD_SEARCH_DEGRADED_MESSAGE =
  "Keyword search is temporarily unavailable. Showing AI matches only.";

/** Shown when the user tries a network-dependent action while offline (mutations, AI, etc.). */
export const OFFLINE_ACTION_MESSAGE =
  "You're offline. Connect to the internet to continue.";

/**
 * Service worker (`sw.ts`) returns HTTP 202 + `{ queued: true }` when a mutation
 * could not reach the server (offline, timeout). Callers must not treat `res.ok`
 * as success — 202 is still "ok" in the fetch sense.
 */
export const MUTATION_QUEUED_MESSAGE =
  "Couldn't reach the server, so this wasn't confirmed. It will retry when you're online—check the site after reconnecting.";

/** Generic network failure in `catch` when there is no `Response` (timeout, dropped connection). */
export const REQUEST_CONNECTION_FAILED_MESSAGE =
  "Couldn't complete the request. Check your connection and try again.";

/** Use in `catch` after a failed `fetch` for non-search flows (same offline vs online split as search). */
export function messageWhenNetworkRequestThrows(): string {
  return typeof navigator !== 'undefined' && !navigator.onLine
    ? OFFLINE_ACTION_MESSAGE
    : REQUEST_CONNECTION_FAILED_MESSAGE;
}
