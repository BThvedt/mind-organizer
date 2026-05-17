'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Layers, CheckSquare, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type RelatedKind = 'note' | 'deck' | 'todo';

type Bundle = 'study_note' | 'flashcard_deck' | 'todo_list';

interface TermRef {
  uuid: string;
  name: string;
}

interface RelatedCard {
  uuid: string;
  front: string;
  back: string;
  score: number | null;
}

interface RelatedResult {
  uuid: string;
  type: Bundle | string;
  title: string;
  areas: TermRef[];
  subjects: TermRef[];
  score: number;
  card?: RelatedCard | null;
}

interface ApiResponse {
  results?: RelatedResult[];
  total?: number;
}

interface RelatedItemsProps {
  /**
   * Which content type the seed entity is. Used in the URL the endpoint
   * expects; the actual related results may span any embedded bundle.
   */
  entityType: RelatedKind;
  entityUuid: string;
  /** How many items to show. Defaults to 6 (endpoint default). */
  limit?: number;
  /** Optional className for the outer wrapper. */
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bundleHref(r: RelatedResult): string {
  switch (r.type) {
    case 'study_note':
      return `/dashboard/notes/${r.uuid}`;
    case 'flashcard_deck':
      return `/dashboard/decks/${r.uuid}`;
    case 'todo_list':
      // The todos page renders its lists inline. There is no per-list URL
      // convention today, so we route to the index.
      return '/dashboard/todos';
    default:
      return '/dashboard';
  }
}

function bundleIcon(bundle: string) {
  switch (bundle) {
    case 'study_note':
      return <FileText className="h-3.5 w-3.5" aria-hidden />;
    case 'flashcard_deck':
      return <Layers className="h-3.5 w-3.5" aria-hidden />;
    case 'todo_list':
      return <CheckSquare className="h-3.5 w-3.5" aria-hidden />;
    default:
      return null;
  }
}

function bundleLabel(bundle: string): string {
  switch (bundle) {
    case 'study_note':
      return 'Note';
    case 'flashcard_deck':
      return 'Deck';
    case 'todo_list':
      return 'Todo';
    default:
      return '';
  }
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * "More like this" panel.
 *
 * Fetches `/api/search/related/{type}/{uuid}` on mount (and when the
 * `entityUuid` prop changes) and renders the resulting entities as a
 * compact list. Flashcard hits are exposed via the parent decks card
 * preview in the title tooltip — the link still goes to the parent deck
 * because individual cards dont have a detail page yet.
 *
 * Failure modes are intentionally quiet: a network error or 5xx renders
 * the same empty state as "no results," with a slightly different label,
 * so a broken Qdrant / embedding pipeline doesnt take the host page down.
 */
export function RelatedItems({
  entityType,
  entityUuid,
  limit = 6,
  className,
}: RelatedItemsProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [results, setResults] = useState<RelatedResult[]>([]);

  // Abort the in-flight request when the seed entity changes (handy on
  // the todos page where the user can switch between lists without a
  // full unmount).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!entityUuid) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setResults([]);

    fetch(`/api/search/related/${entityType}/${entityUuid}?limit=${limit}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('related-failed');
        const data: ApiResponse = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setStatus('error');
        setResults([]);
      });
  }, [entityType, entityUuid, limit]);

  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Related
        </h2>
        {status === 'loading' && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
        )}
      </header>

      {status === 'loading' && (
        <ul className="divide-y divide-border">
          {Array.from({ length: Math.min(limit, 3) }).map((_, i) => (
            <li key={i} className="px-4 py-3">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-2.5 w-1/3 animate-pulse rounded bg-muted/60" />
            </li>
          ))}
        </ul>
      )}

      {status === 'ready' && results.length === 0 && (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          No related items yet. Keep adding notes, decks, or todos and they&apos;ll show up here.
        </p>
      )}

      {status === 'error' && (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          Couldn&apos;t load related items right now.
        </p>
      )}

      {status === 'ready' && results.length > 0 && (
        <ul className="divide-y divide-border">
          {results.map((r) => {
            const tooltip = r.card
              ? `Card: ${r.card.front}`
              : `${Math.round(r.score * 100)}% match`;
            return (
              <li key={`${r.uuid}-${r.card?.uuid ?? ''}`}>
                <Link
                  href={bundleHref(r)}
                  title={tooltip}
                  className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                    {bundleIcon(r.type)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{r.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{bundleLabel(r.type)}</span>
                      {r.card && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate max-w-[16ch]" title={r.card.front}>
                            {r.card.front}
                          </span>
                        </>
                      )}
                      {r.areas.slice(0, 2).map((a) => (
                        <span
                          key={a.uuid}
                          className="rounded-full bg-muted px-1.5 py-px"
                        >
                          {a.name}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span
                    className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground"
                    aria-label={`${Math.round(r.score * 100)} percent match`}
                  >
                    {Math.round(r.score * 100)}%
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
