/**
 * Minimal JSON:API types and helpers, safe to import from both server and
 * client components. Keep this file free of any server-only imports
 * (e.g. `next/headers`, `cookies()`).
 */

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

/**
 * Normalizes a JSON:API relationship `data` value to a flat array.
 * Handles single object (legacy single-cardinality), array (multi), null,
 * and undefined uniformly.
 */
export function toRelArray(
  data: JsonApiRelData | JsonApiRelData[] | null | undefined,
): JsonApiRelData[] {
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

/** Returns just the IDs from a relationship value. */
export function toRelIds(
  data: JsonApiRelData | JsonApiRelData[] | null | undefined,
): string[] {
  return toRelArray(data).map((d) => d.id);
}

/**
 * Reads a multi-value `string` JSON:API field (e.g. `field_missing_media`)
 * defensively. JSON:API typically serializes these as a flat `string[]`,
 * but older proxies or PATCH echoes can return `[{ value: '…' }]` shapes —
 * we accept either and ignore everything else.
 */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): string | null => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'value' in item) {
        const v = (item as { value: unknown }).value;
        return typeof v === 'string' ? v : null;
      }
      return null;
    })
    .filter((s): s is string => s !== null);
}
