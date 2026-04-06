import { cookies } from 'next/headers';
import { refreshAccessToken, applyTokenCookies } from '@/lib/auth';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

function buildHeaders(token: string | undefined, extra?: HeadersInit): HeadersInit {
  return {
    'Content-Type': 'application/vnd.api+json',
    Accept: 'application/vnd.api+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

/**
 * Server-side authenticated fetch to Drupal JSON:API.
 * Reads the access_token httpOnly cookie and attaches it as a Bearer token.
 * Proactively refreshes when the access_token is missing but refresh_token
 * exists, and also retries once on a 401 response.
 */
export async function drupalFetch(path: string, options?: RequestInit) {
  const cookieStore = await cookies();
  let token = cookieStore.get('access_token')?.value;

  // Proactive refresh: access_token expired/missing but refresh_token remains.
  // Without this, the request would reach Drupal as anonymous and return 403
  // (not 401), bypassing the reactive refresh below.
  if (!token) {
    const refreshToken = cookieStore.get('refresh_token')?.value;
    if (refreshToken) {
      const newTokens = await refreshAccessToken(refreshToken);
      if (newTokens) {
        applyTokenCookies(
          { cookies: { set: (name: string, value: string, opts: object) => cookieStore.set(name, value, opts) } },
          newTokens
        );
        token = newTokens.access_token;
      }
    }
  }

  const res = await fetch(`${DRUPAL_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(token, options?.headers),
  });

  // Reactive refresh: token was present but Drupal rejected it (e.g. revoked).
  if (res.status === 401) {
    const refreshToken = cookieStore.get('refresh_token')?.value;
    if (refreshToken) {
      const newTokens = await refreshAccessToken(refreshToken);
      if (newTokens) {
        applyTokenCookies(
          { cookies: { set: (name: string, value: string, opts: object) => cookieStore.set(name, value, opts) } },
          newTokens
        );

        return fetch(`${DRUPAL_BASE_URL}${path}`, {
          ...options,
          headers: buildHeaders(newTokens.access_token, options?.headers),
        });
      }
    }
  }

  return res;
}

/**
 * Retrieves the current authenticated user's UUID from the JSON:API meta links.
 * Returns null if the user is not authenticated or the request fails.
 */
export async function getCurrentUserUuid(): Promise<string | null> {
  try {
    const res = await drupalFetch('/jsonapi');
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.meta?.links?.me?.meta?.id as string) ?? null;
  } catch {
    return null;
  }
}

/** Minimal shape of a JSON:API resource object */
export interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: JsonApiRelData | JsonApiRelData[] | null }>;
}

export interface JsonApiRelData {
  id: string;
  type: string;
}

export interface JsonApiListResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}

export interface JsonApiSingleResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
}
