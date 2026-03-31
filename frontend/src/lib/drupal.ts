import { cookies } from 'next/headers';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

/**
 * Server-side authenticated fetch to Drupal JSON:API.
 * Reads the access_token httpOnly cookie and attaches it as a Bearer token.
 */
export async function drupalFetch(path: string, options?: RequestInit) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  return fetch(`${DRUPAL_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
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
