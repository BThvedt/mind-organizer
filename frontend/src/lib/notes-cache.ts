/**
 * localStorage cache for the paginated notes sidebar (`/dashboard/notes`).
 *
 * Why a cache: the sidebar list is the first thing the user sees on that
 * page, and re-fetching page 1 on every visit means an empty skeleton for
 * a round-trip. We paint from localStorage immediately, then always
 * revalidate page 1 from the network and reconcile.
 *
 * Entries are keyed per sort + area + subject combination, because each
 * combination is a *different* server-side query now that filtering is
 * done by Drupal rather than in the browser.
 *
 * Storage discipline (localStorage is ~5 MB, shared with the SRS pool and
 * session log):
 *   - `field_body` is trimmed to a preview length — the sidebar only ever
 *     renders ~110 characters of it. The reader re-fetches the full note.
 *   - at most MAX_ENTRIES filter combinations are kept (LRU by savedAt)
 *   - at most MAX_NOTES_PER_ENTRY notes per combination
 *   - entries older than TTL_MS are ignored and dropped on read
 *   - every write is wrapped; on quota errors the whole cache is dropped
 */

import type { JsonApiResource } from '@/lib/json-api';

const STORAGE_KEY = 'notes_list_cache_v1';

/** Bumped when the entry shape changes, which discards older payloads. */
const CACHE_VERSION = 1;

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 6;
const MAX_NOTES_PER_ENTRY = 60;

/** Characters of `field_body` kept per note (sidebar shows ~110). */
const BODY_PREVIEW_LENGTH = 300;

/**
 * Marker attribute set on notes whose `field_body` was trimmed on the way
 * into the cache. The reader checks it and re-fetches the full note before
 * rendering markdown, so a truncated body is never displayed as the whole
 * note.
 */
export const TRUNCATED_BODY_FLAG = '__bodyTruncated';

export interface NotesCacheEntry {
  notes: JsonApiResource[];
  included: JsonApiResource[];
  /** Whether the server reported more pages after the cached window. */
  hasMore: boolean;
  /** Offset to resume infinite scroll from (i.e. number of cached notes). */
  offset: number;
  savedAt: number;
}

interface CacheFile {
  version: number;
  entries: Record<string, NotesCacheEntry>;
}

/** Builds the per-query cache key. `*` stands for "no filter". */
export function notesCacheKey(
  sort: string,
  areaId: string,
  subjectId: string,
): string {
  return `${sort}|${areaId || '*'}|${subjectId || '*'}`;
}

function readFile(): CacheFile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.entries) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeFile(file: CacheFile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch {
    // Most likely QuotaExceededError. The cache is disposable, so drop it
    // entirely rather than leaving a half-written payload behind.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage is unavailable (private mode / disabled) — nothing to do.
    }
  }
}

/** Trims `field_body` so cached payloads stay small. */
function trimNote(note: JsonApiResource): JsonApiResource {
  const body = note.attributes?.field_body;
  if (typeof body !== 'string' || body.length <= BODY_PREVIEW_LENGTH) {
    return note;
  }
  return {
    ...note,
    attributes: {
      ...note.attributes,
      field_body: body.slice(0, BODY_PREVIEW_LENGTH),
      [TRUNCATED_BODY_FLAG]: true,
    },
  };
}

/** True when this note's cached body is only a preview. */
export function hasTruncatedBody(
  note: JsonApiResource | null | undefined,
): boolean {
  return !!note?.attributes?.[TRUNCATED_BODY_FLAG];
}

/**
 * Reads the cached page-1 window for a query, or null when absent/stale.
 * Expired entries are pruned as a side effect.
 */
export function readNotesCache(key: string): NotesCacheEntry | null {
  const file = readFile();
  if (!file) return null;

  const entry = file.entries[key];
  if (!entry) return null;

  if (Date.now() - entry.savedAt > TTL_MS) {
    delete file.entries[key];
    writeFile(file);
    return null;
  }

  return entry;
}

/**
 * Stores the currently loaded window for a query, enforcing the note and
 * entry caps. Never throws.
 */
export function writeNotesCache(
  key: string,
  entry: Omit<NotesCacheEntry, 'savedAt' | 'offset'>,
): void {
  if (typeof window === 'undefined') return;

  const file = readFile() ?? { version: CACHE_VERSION, entries: {} };

  const capped = entry.notes.slice(0, MAX_NOTES_PER_ENTRY);
  const cappedIds = new Set(capped.map((n) => n.id));

  // Keep only side-loaded resources still referenced by the capped notes'
  // relationships, plus any resource that is itself one of those notes.
  const referenced = new Set<string>();
  for (const note of capped) {
    for (const rel of Object.values(note.relationships ?? {})) {
      const data = rel?.data;
      if (!data) continue;
      for (const item of Array.isArray(data) ? data : [data]) {
        referenced.add(item.id);
      }
    }
  }

  file.entries[key] = {
    notes: capped.map(trimNote),
    included: entry.included
      .filter((r) => referenced.has(r.id) || cappedIds.has(r.id))
      .map(trimNote),
    // If the note list was capped there is definitely more to fetch.
    hasMore: entry.hasMore || capped.length < entry.notes.length,
    offset: capped.length,
    savedAt: Date.now(),
  };

  // LRU eviction — oldest savedAt goes first.
  const keys = Object.keys(file.entries);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => file.entries[a].savedAt - file.entries[b].savedAt)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete file.entries[k]);
  }

  writeFile(file);
}

/**
 * Drops every cached window. Called after any note create / update /
 * delete: a single insertion or removal shifts every subsequent offset,
 * so partial invalidation would be wrong as well as more complex.
 */
export function invalidateNotesCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the TTL and page-1 revalidation still apply.
  }
}
