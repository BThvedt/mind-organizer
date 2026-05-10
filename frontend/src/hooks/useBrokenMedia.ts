'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface BrokenMediaResponse {
  data?: Array<{
    uuid: string;
    originalFilename: string;
    deletedAt: number | null;
  }>;
}

const MEDIA_PATH_RE = /\/api\/media\/([0-9a-f-]{36})/gi;

/**
 * Extracts all `/api/media/<uuid>` references from a piece of text.
 *
 * Exported so callers can compare body content against the broken-media
 * set in a stable, lower-cased form.
 */
export function extractMediaReferences(text: string): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(MEDIA_PATH_RE)) {
    refs.add(match[1].toLowerCase());
  }
  return refs;
}

/**
 * Loads the current user's soft-deleted asset uuids from
 * /api/media/broken and returns:
 *
 *   - `brokenSet`: every soft-deleted uuid the current user owns
 *   - `brokenInBody(body)`: the subset that's actually referenced in the
 *     given markdown body — used to drive the per-note banner
 *
 * Cached for the lifetime of the page mount; refresh by toggling `enabled`.
 */
export function useBrokenMedia(enabled: boolean = true): {
  brokenSet: ReadonlySet<string>;
  brokenInBody: (body: string) => string[];
} {
  const [brokenSet, setBrokenSet] = useState<ReadonlySet<string>>(() => new Set());
  // Avoid re-fetching on every render of a parent that flips `enabled`.
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!enabled || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    fetch('/api/media/broken')
      .then(async (res) => {
        if (!res.ok) return;
        const data: BrokenMediaResponse = await res.json();
        if (cancelled) return;
        const set = new Set<string>();
        for (const row of data.data ?? []) {
          set.add(row.uuid.toLowerCase());
        }
        setBrokenSet(set);
      })
      .catch(() => { /* silent: missing banner is acceptable */ });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => ({
    brokenSet,
    brokenInBody: (body: string) => {
      const refs = extractMediaReferences(body);
      const broken: string[] = [];
      for (const uuid of refs) {
        if (brokenSet.has(uuid)) broken.push(uuid);
      }
      return broken;
    },
  }), [brokenSet]);
}
