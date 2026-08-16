'use client';

import {
  Suspense,
  Fragment,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText, ArrowLeft, Plus, Pencil, Layers, ChevronLeft, CheckSquare, X, Maximize2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/json-api';
import { toRelArray, toRelIds, toStringArray } from '@/lib/json-api';
import { MissingMediaIndicator } from '@/components/missing-media-indicator';
import { ShareIndicator } from '@/components/share-indicator';
import { AttachmentsIndicator } from '@/components/attachments-indicator';
import { groupByDateLabel } from '@/lib/date-groups';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import {
  notesCacheKey,
  readNotesCache,
  writeNotesCache,
  hasTruncatedBody,
} from '@/lib/notes-cache';

/** Notes fetched per page. Drupal JSON:API caps `page[limit]` at 50. */
const PAGE_SIZE = 25;

/**
 * When jumping to a note that isn't in the loaded window (opened via
 * Search or Ask AI), how many notes on either side to load alongside it —
 * enough context to scroll around without an immediate extra fetch.
 */
const JUMP_WINDOW_BEFORE = 20;
const JUMP_WINDOW_AFTER = 9;

/** How long the highlight pulse stays visible on a jumped-to note. */
const HIGHLIGHT_DURATION_MS = 2200;

interface NotesListResponse {
  data?: JsonApiResource[];
  included?: JsonApiResource[];
  meta?: { offset?: number; limit?: number; hasMore?: boolean };
}

interface NotePositionResponse {
  offset?: number;
  error?: 'not_found' | 'excluded_by_filter';
}

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NotesPage() {
  return (
    <Suspense>
      <NotesPageContent />
    </Suspense>
  );
}

function NotesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [notes, setNotes] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Note to visually pulse once it scrolls into view after a jump. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** Shown near the filter bar when a jump target is hidden by filters. */
  const [hiddenByFilterNote, setHiddenByFilterNote] = useState<{ id: string } | null>(null);
  const [mobileShowReader, setMobileShowReader] = useState(false);
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  type SortOption = 'created' | 'changed' | 'field_last_viewed';
  const [sortBy, setSortBy] = useState<SortOption>('created');

  // Filter dropdown options come from the taxonomy endpoints rather than
  // from the loaded notes: with server-side pagination the loaded window
  // no longer knows every area/subject the user has.
  const [areaOptions, setAreaOptions] = useState<{ id: string; name: string }[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<{ id: string; name: string }[]>([]);

  /**
   * Full notes fetched on demand for the reader, keyed by UUID. Needed
   * because a note may be missing from the loaded window (deep link via
   * `?id=`, or a link to a note on a later page) or may have come from the
   * cache with a truncated body.
   */
  const [noteDetails, setNoteDetails] = useState<Record<string, JsonApiResource>>({});

  // Scroll container + sentinel for infinite scroll.
  const listViewportRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * Increments on every query change (sort/area/subject). Responses whose
   * id no longer matches are discarded, so a slow page-1 request for the
   * previous filter can't overwrite the current list.
   */
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Mirrors the loaded count so `loadMore` doesn't need it as a dep. */
  const offsetRef = useRef(0);
  /**
   * Absolute offset of the first loaded row in the current query's sort
   * order. Zero for a normal page-1 load; non-zero after a "jump to note"
   * loads a window centred elsewhere in the list. Upward infinite scroll
   * fetches the previous page ending at this offset.
   */
  const windowStartOffsetRef = useRef(0);
  /**
   * Mirrors `notes` / `included` so page merging can read the current list
   * synchronously. React state updater callbacks run during render, not at
   * call time, so their result isn't available for the cache write.
   */
  const notesRef = useRef<JsonApiResource[]>([]);
  const includedRef = useRef<JsonApiResource[]>([]);
  /** Scroll container for the sidebar list, used to preserve scroll
   *  position when prepending older notes above the current window. */
  const topSentinelRef = useRef<HTMLDivElement>(null);
  /** Guards against re-triggering the jump-to-note flow for the same id. */
  const jumpedForIdRef = useRef<string | null>(null);
  /** DOM nodes for each rendered row, keyed by note id — used to scroll a
   *  jumped-to note into view once it renders. */
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  const sortParam = `-${sortBy}`;
  const cacheKey = notesCacheKey(sortParam, filterAreaId, filterSubjectId);

  // Sync selection from the URL. Re-runs whenever `?id=` changes, not just
  // on mount — Search and Ask AI navigate here with `router.push`/`<Link>`,
  // which is a client-side soft navigation on this same route (no remount),
  // so a mount-only effect would silently miss it until a hard refresh.
  useEffect(() => {
    const id = searchParams.get('id');
    if (id && id !== selectedId) {
      setSelectedId(id);
      setMobileShowReader(true);
    }
    // Only `id` should drive this — `selectedId` is read for comparison,
    // not as a trigger, otherwise selecting a note in the sidebar (which
    // also updates the URL) would immediately re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** Builds the list URL for a given window of the current query. */
  const buildUrl = useCallback(
    (offset: number, limit: number = PAGE_SIZE) => {
      const params = new URLSearchParams({
        sort: sortParam,
        limit: String(limit),
        offset: String(offset),
      });
      if (filterAreaId) params.set('area', filterAreaId);
      if (filterSubjectId) params.set('subject', filterSubjectId);
      return `/api/notes?${params.toString()}`;
    },
    [sortParam, filterAreaId, filterSubjectId],
  );

  /**
   * Loads one page. `reset` replaces the list (new query / revalidation);
   * otherwise the page is appended, de-duplicated by id — offset paging on
   * a `-changed` sort can otherwise repeat a row if a note was edited
   * between requests.
   *
   * `limit` lets a one-off "jump to note" fetch request a wider window
   * than the normal page size. `windowStart`, when given, records the
   * absolute offset of the first row in the *resulting* list — needed so
   * a jump (which doesn't start at offset 0) can still support loading
   * older notes above it later. Caching is skipped whenever the resulting
   * window doesn't start at 0, so the localStorage "page 1" entry used
   * for instant paint on a normal visit is never overwritten with an
   * off-center window.
   */
  const loadPage = useCallback(
    async (
      offset: number,
      opts: { reset: boolean; limit?: number; windowStart?: number },
    ) => {
      const myRequestId = opts.reset ? ++requestIdRef.current : requestIdRef.current;

      if (opts.reset) {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
      }
      const signal = abortRef.current?.signal;

      if (opts.reset) {
        setLoading(true);
        // An in-flight append is now orphaned by the bumped request id and
        // will skip its own cleanup, so clear its flag here — otherwise
        // `loadingMore` sticks and blocks all further scroll loading.
        setLoadingMore(false);
      } else {
        setLoadingMore(true);
      }

      try {
        const res = await fetch(buildUrl(offset, opts.limit), { signal });
        if (!res.ok) return;
        if (requestIdRef.current !== myRequestId) return;

        const data: NotesListResponse = await res.json();
        if (requestIdRef.current !== myRequestId) return;

        const page = data.data ?? [];
        const pageIncluded = data.included ?? [];
        const requestedLimit = opts.limit ?? PAGE_SIZE;
        const more = data.meta?.hasMore ?? page.length === requestedLimit;

        let merged: JsonApiResource[];
        if (opts.reset) {
          merged = page;
        } else {
          const seen = new Set(notesRef.current.map((n) => n.id));
          merged = [...notesRef.current, ...page.filter((n) => !seen.has(n.id))];
        }

        let mergedIncluded: JsonApiResource[];
        if (opts.reset) {
          mergedIncluded = pageIncluded;
        } else {
          const byId = new Map(includedRef.current.map((r) => [r.id, r]));
          for (const r of pageIncluded) byId.set(r.id, r);
          mergedIncluded = [...byId.values()];
        }

        notesRef.current = merged;
        includedRef.current = mergedIncluded;
        setNotes(merged);
        setIncluded(mergedIncluded);

        const windowStart = opts.windowStart ?? windowStartOffsetRef.current;
        windowStartOffsetRef.current = windowStart;
        setHasPrevious(windowStart > 0);

        offsetRef.current = windowStart + merged.length;
        setHasMore(more);

        if (windowStart === 0) {
          writeNotesCache(cacheKey, {
            notes: merged,
            included: mergedIncluded,
            hasMore: more,
          });
        }
      } catch {
        // Aborted or offline — keep whatever is on screen. The service
        // worker serves a cached response for GETs when available.
      } finally {
        if (requestIdRef.current === myRequestId) {
          if (opts.reset) setLoading(false);
          else setLoadingMore(false);
        }
      }
    },
    [buildUrl, cacheKey],
  );

  /**
   * On mount and whenever the query changes: paint from localStorage for
   * an instant list, then always revalidate page 1 from the network.
   */
  useEffect(() => {
    if (!authenticated) return;

    const cached = readNotesCache(cacheKey);
    windowStartOffsetRef.current = 0;
    setHasPrevious(false);
    // A new query invalidates any pending "jump to note" for the previous
    // one — the effect below will re-evaluate once this page settles.
    jumpedForIdRef.current = null;
    setHiddenByFilterNote(null);

    if (cached) {
      notesRef.current = cached.notes;
      includedRef.current = cached.included;
      setNotes(cached.notes);
      setIncluded(cached.included);
      setHasMore(cached.hasMore);
      offsetRef.current = cached.offset;
      setLoading(false);
    } else {
      notesRef.current = [];
      includedRef.current = [];
      setNotes([]);
      setIncluded([]);
      setHasMore(false);
      offsetRef.current = 0;
      setLoading(true);
    }

    void loadPage(0, { reset: true, windowStart: 0 });
  }, [authenticated, cacheKey, loadPage]);

  /** Appends the next page below; guarded against overlapping requests. */
  const loadMore = useCallback(() => {
    if (loading || loadingMore || loadingPrevious || !hasMore) return;
    void loadPage(offsetRef.current, { reset: false });
  }, [loading, loadingMore, loadingPrevious, hasMore, loadPage]);

  useInfiniteScroll({
    rootRef: listViewportRef,
    sentinelRef,
    hasMore,
    loading: loading || loadingMore || loadingPrevious,
    onLoadMore: loadMore,
  });

  /**
   * Prepends the page immediately above the current window, preserving
   * scroll position (the standard "load older content upward" trick: grow
   * the content above the viewport, then subtract exactly that much from
   * scrollTop so nothing visibly jumps).
   */
  const loadPrevious = useCallback(async () => {
    if (loading || loadingMore || loadingPrevious || !hasPrevious) return;
    const viewport = listViewportRef.current;
    const startOffset = windowStartOffsetRef.current;
    const take = Math.min(PAGE_SIZE, startOffset);
    if (take <= 0) return;
    const fetchOffset = startOffset - take;

    const myRequestId = requestIdRef.current;
    setLoadingPrevious(true);
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const prevScrollTop = viewport?.scrollTop ?? 0;

    try {
      const res = await fetch(buildUrl(fetchOffset, take));
      if (!res.ok) return;
      if (requestIdRef.current !== myRequestId) return;

      const data: NotesListResponse = await res.json();
      if (requestIdRef.current !== myRequestId) return;

      const page = data.data ?? [];
      const pageIncluded = data.included ?? [];

      const seen = new Set(notesRef.current.map((n) => n.id));
      const merged = [...page.filter((n) => !seen.has(n.id)), ...notesRef.current];

      const byId = new Map(includedRef.current.map((r) => [r.id, r]));
      for (const r of pageIncluded) byId.set(r.id, r);
      const mergedIncluded = [...byId.values()];

      notesRef.current = merged;
      includedRef.current = mergedIncluded;
      setNotes(merged);
      setIncluded(mergedIncluded);

      windowStartOffsetRef.current = fetchOffset;
      setHasPrevious(fetchOffset > 0);
      offsetRef.current = fetchOffset + merged.length;

      // Restore the visual scroll position: the viewport grew above the
      // fold by however many pixels the prepended rows added.
      requestAnimationFrame(() => {
        if (!viewport) return;
        const grew = viewport.scrollHeight - prevScrollHeight;
        viewport.scrollTop = prevScrollTop + grew;
      });
    } catch {
      // Aborted or offline — leave the list as-is.
    } finally {
      if (requestIdRef.current === myRequestId) setLoadingPrevious(false);
    }
  }, [loading, loadingMore, loadingPrevious, hasPrevious, buildUrl]);

  useInfiniteScroll({
    rootRef: listViewportRef,
    sentinelRef: topSentinelRef,
    hasMore: hasPrevious,
    loading: loading || loadingMore || loadingPrevious,
    onLoadMore: loadPrevious,
  });

  // Areas for the filter dropdown — loaded once.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    fetch('/api/taxonomy?type=areas')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d: { data?: JsonApiResource[] }) => {
        if (cancelled) return;
        setAreaOptions(
          (d.data ?? [])
            .map((t) => ({ id: t.id, name: String(t.attributes?.name ?? '') }))
            .filter((t) => t.name)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authenticated]);

  // Subjects for the selected area.
  useEffect(() => {
    if (!authenticated || !filterAreaId) {
      setSubjectOptions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/taxonomy?type=subjects&area=${filterAreaId}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d: { data?: JsonApiResource[] }) => {
        if (cancelled) return;
        setSubjectOptions(
          (d.data ?? [])
            .map((t) => ({ id: t.id, name: String(t.attributes?.name ?? '') }))
            .filter((t) => t.name)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authenticated, filterAreaId]);

  useEffect(() => {
    router.prefetch('/dashboard/notes/new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  function selectNote(id: string) {
    setSelectedId(id);
    setMobileShowReader(true);
    router.replace(`/dashboard/notes?id=${id}`, { scroll: false });
    fetch(`/api/notes/${id}/last-viewed`, { method: 'POST' })
      .then((res) => {
        if (!res.ok) return;
        // Patch + re-sort in memory instead of refetching the list: a
        // refetch would discard every page loaded so far and reset the
        // user's scroll position.
        if (sortBy !== 'field_last_viewed') return;
        const now = new Date().toISOString();
        const resorted = notesRef.current
          .map((n) =>
            n.id === id
              ? { ...n, attributes: { ...n.attributes, field_last_viewed: now } }
              : n,
          )
          .sort((a, b) => {
            const av = (a.attributes.field_last_viewed as string | null) ?? '';
            const bv = (b.attributes.field_last_viewed as string | null) ?? '';
            return bv.localeCompare(av);
          });
        notesRef.current = resorted;
        setNotes(resorted);
      })
      .catch(() => {});
  }

  /**
   * Ensures the reader has the complete note. The sidebar window may not
   * contain it at all (deep link, or a linked note on a later page), and
   * cached notes carry only a trimmed body.
   */
  const ensureFullNote = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/notes/${id}`);
        if (!res.ok) return;
        const data: { data?: JsonApiResource; included?: JsonApiResource[] } =
          await res.json();
        if (!data.data) return;
        setNoteDetails((prev) => ({ ...prev, [id]: data.data as JsonApiResource }));
        if (data.included?.length) {
          const byId = new Map(includedRef.current.map((r) => [r.id, r]));
          for (const r of data.included) byId.set(r.id, r);
          const mergedIncluded = [...byId.values()];
          includedRef.current = mergedIncluded;
          setIncluded(mergedIncluded);
        }
      } catch {
        // Reader falls back to the list copy / empty state.
      }
    },
    [],
  );

  // Fetch the selected note's full record when the list copy is missing or
  // only holds a cached preview body.
  useEffect(() => {
    if (!authenticated || !selectedId) return;
    if (noteDetails[selectedId]) return;
    const fromList = notes.find((n) => n.id === selectedId);
    if (fromList && !hasTruncatedBody(fromList)) return;
    void ensureFullNote(selectedId);
  }, [authenticated, selectedId, notes, noteDetails, ensureFullNote]);

  /**
   * "Jump to note" — when a note is selected (typically via `?id=` from
   * Search or Ask AI) but isn't anywhere in the currently loaded sidebar
   * window, look up its position in the active sort/filter order and load
   * a window centred on it, so the sidebar can highlight it in context
   * instead of leaving the list looking unrelated to what's open.
   */
  useEffect(() => {
    if (!authenticated || !selectedId || loading) return;
    if (jumpedForIdRef.current === selectedId) return;
    if (notesRef.current.some((n) => n.id === selectedId)) return;

    jumpedForIdRef.current = selectedId;
    setHiddenByFilterNote(null);

    const params = new URLSearchParams({ sort: sortParam });
    if (filterAreaId) params.set('area', filterAreaId);
    if (filterSubjectId) params.set('subject', filterSubjectId);

    fetch(`/api/notes/${selectedId}/position?${params.toString()}`)
      .then(async (res) => {
        if (jumpedForIdRef.current !== selectedId) return;
        const data: NotePositionResponse = await res.json().catch(() => ({}));
        if (!res.ok || data.offset === undefined) {
          if (data.error === 'excluded_by_filter') {
            setHiddenByFilterNote({ id: selectedId });
          }
          // Otherwise (not_found / network issue): nothing to highlight —
          // the reader still shows the note via `ensureFullNote`.
          return;
        }

        const windowStart = Math.max(0, data.offset - JUMP_WINDOW_BEFORE);
        const take = data.offset - windowStart + 1 + JUMP_WINDOW_AFTER;

        setHighlightId(selectedId);
        void loadPage(windowStart, {
          reset: true,
          limit: take,
          windowStart,
        });
      })
      .catch(() => {
        // Offline or request failure — leave the sidebar as-is.
      });
  }, [authenticated, selectedId, loading, sortParam, filterAreaId, filterSubjectId, loadPage]);

  // Once the jumped-to note actually renders, scroll it into view (near
  // the top of the viewport, so there's visible context below it) and
  // clear the highlight after the pulse animation finishes.
  useEffect(() => {
    if (!highlightId) return;
    const el = rowRefs.current.get(highlightId);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    const viewport = listViewportRef.current;
    if (viewport) viewport.scrollTop -= 8; // small breathing room above the row
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [highlightId, notes]);

  /**
   * When a note that's already loaded in the sidebar is selected (e.g. via
   * Search/Ask AI, or simply re-selecting one that's scrolled out of view)
   * but isn't the target of an in-flight "jump to note" fetch, just scroll
   * it into view and pulse the highlight — no fetch needed, since the row
   * already exists in the DOM.
   */
  useEffect(() => {
    if (!selectedId || loading) return;
    if (jumpedForIdRef.current === selectedId) return;
    if (!notesRef.current.some((n) => n.id === selectedId)) return;
    setHighlightId(selectedId);
  }, [selectedId, loading]);

  // ── Filters ───────────────────────────────────────────────────────────────
  //
  // Area/subject filtering is applied by Drupal (see `/api/notes`), so the
  // loaded list is already scoped — no client-side filtering step here.

  const uniqueAreas = areaOptions;
  const uniqueSubjectsForArea = subjectOptions;
  const visibleNotes = notes;

  const hasFilters = !!(filterAreaId || filterSubjectId);

  function clearFilters() {
    setFilterAreaId('');
    setFilterSubjectId('');
  }

  if (!authenticated) return null;

  // ── Derive data for the selected note ─────────────────────────────────────
  // Prefer the on-demand full record (complete body) over the list copy,
  // which may be a cached preview or absent entirely.
  const selectedNote = selectedId
    ? (noteDetails[selectedId] ?? notes.find((n) => n.id === selectedId) ?? null)
    : null;

  const selectedAreaIds = selectedNote
    ? toRelIds(selectedNote.relationships?.field_area?.data)
    : [];
  const selectedSubjectIds = selectedNote
    ? toRelIds(selectedNote.relationships?.field_subject?.data)
    : [];

  const selectedAreaTags = selectedAreaIds
    .map((id) => ({
      id,
      name: included.find((r) => r.id === id)?.attributes.name as string | undefined,
    }))
    .filter((x): x is { id: string; name: string } => !!x.name);
  const selectedSubjectTags = selectedSubjectIds
    .map((id) => ({
      id,
      name: included.find((r) => r.id === id)?.attributes.name as string | undefined,
    }))
    .filter((x): x is { id: string; name: string } => !!x.name);
  const linkedDecks = (toRelArray(selectedNote?.relationships?.field_linked_decks?.data)
    .map((rel) => included.find((r) => r.id === rel.id))
    .filter(Boolean) as JsonApiResource[]);
  const linkedNotes = (toRelArray(selectedNote?.relationships?.field_linked_notes?.data)
    .map((rel) => included.find((r) => r.id === rel.id) ?? notes.find((n) => n.id === rel.id))
    .filter(Boolean) as JsonApiResource[]);
  const linkedTodos = (toRelArray(selectedNote?.relationships?.field_linked_todos?.data)
    .map((rel) => included.find((r) => r.id === rel.id))
    .filter(Boolean) as JsonApiResource[]);

  const noteBody = (selectedNote?.attributes.field_body as string | null) ?? '';

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <div className="fixed inset-x-0 bottom-0 top-16 flex min-h-0">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className={cn(
            'flex min-h-0 flex-col border-r border-border bg-background shrink-0',
            'w-full md:w-72 lg:w-80',
            mobileShowReader ? 'hidden md:flex' : 'flex'
          )}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-border shrink-0">
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                render={<Link href="/dashboard" />}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to dashboard</span>
              </Button>
              <h1 className="font-semibold text-sm text-foreground">My Notes</h1>
              {!loading && (
                /* Drupal reports no total for collections, so show the
                   loaded count with a "+" while more pages remain. */
                <span className="text-xs text-muted-foreground">
                  ({notes.length}{hasMore ? '+' : ''})
                </span>
              )}
            </div>
            <Button
              size="icon-sm"
              nativeButton={false}
              render={<Link href="/dashboard/notes/new" />}
            >
              <Plus className="h-4 w-4" />
              <span className="sr-only">New note</span>
            </Button>
          </div>

          {/* Controls: sort + area/subject filters.
              Always rendered — changing a filter now triggers a server
              refetch, so the controls must stay usable while loading. */}
          <div className="px-3 py-2 border-b border-border flex flex-col gap-1.5 shrink-0">
              <div className="flex items-center gap-2">
                {uniqueAreas.length > 0 && (
                  <Select
                    value={filterAreaId || '__all__'}
                    onValueChange={(v) => {
                      setFilterAreaId(!v || v === '__all__' ? '' : v);
                      setFilterSubjectId('');
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                      <span className={cn(!filterAreaId && 'text-muted-foreground')}>
                        {filterAreaId
                          ? (uniqueAreas.find((a) => a.id === filterAreaId)?.name ?? 'All areas')
                          : 'All areas'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All areas</SelectItem>
                      {uniqueAreas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as SortOption)}
                >
                  <SelectTrigger className="h-7 text-xs w-36 shrink-0">
                    <SelectValue>
                      {{ created: 'Created', changed: 'Last Modified', field_last_viewed: 'Last Viewed' }[sortBy]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created">Created</SelectItem>
                    <SelectItem value="changed">Last Modified</SelectItem>
                    <SelectItem value="field_last_viewed">Last Viewed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filterAreaId && (
                <Select
                  value={filterSubjectId || '__all__'}
                  onValueChange={(v) => setFilterSubjectId(!v || v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <span className={cn(!filterSubjectId && 'text-muted-foreground')}>
                      {filterSubjectId
                        ? (uniqueSubjectsForArea.find((s) => s.id === filterSubjectId)?.name ?? 'All subjects')
                        : 'All subjects'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All subjects</SelectItem>
                    {uniqueSubjectsForArea.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              )}

              {/* Shown when a note opened from Search / Ask AI doesn't
                  match the active filters — it can't be highlighted in
                  this list without either widening or clearing them. */}
              {hiddenByFilterNote && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <span>This note is hidden by your current filters.</span>
                  <button
                    onClick={() => {
                      clearFilters();
                      setHiddenByFilterNote(null);
                    }}
                    className="shrink-0 font-medium text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                  >
                    Clear filters
                  </button>
                </div>
              )}
          </div>

          {/* Note list */}
          <ScrollArea className="flex-1 min-h-0" viewportRef={listViewportRef}>
            {/* Upward infinite-scroll sentinel: entering view loads the
                notes immediately above the current window. Only relevant
                after a "jump to note" landed somewhere past offset 0. */}
            {!loading && hasPrevious && (
              <div ref={topSentinelRef} aria-hidden="true" className="h-px" />
            )}
            {loadingPrevious && (
              <div className="px-4 py-3 border-b border-border">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted mb-2" />
                <div className="h-3 w-full animate-pulse rounded bg-muted mb-1" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            )}
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-border">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted mb-2" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted mb-1" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              ))
            ) : visibleNotes.length === 0 ? (
              /* With server-side filtering an empty result means either the
                 user has no notes at all, or none match the filters. */
              hasFilters ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                  <FileText className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No notes match the selected filters.</p>
                  <button
                    onClick={clearFilters}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                  <FileText className="h-8 w-8 text-muted-foreground/40" />
                  <div>
                    <p className="text-sm font-medium text-foreground">No notes yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Create your first note to get started.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/dashboard/notes/new" />}
                  >
                    <Plus className="h-4 w-4" />
                    New note
                  </Button>
                </div>
              )
            ) : (
              <>
              {groupByDateLabel(
                visibleNotes,
                (note) =>
                  sortBy === 'field_last_viewed'
                    ? (note.attributes.field_last_viewed as string | null | undefined)
                    : sortBy === 'created'
                    ? (note.attributes.created as string | undefined)
                    : (note.attributes.changed as string | undefined),
              ).map(({ label, items }) => (
                <Fragment key={label}>
                  <div className="sticky top-0 z-10 px-4 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {label}
                    </span>
                  </div>
                  {items.map((note) => {
                const nAreaTags = toRelIds(note.relationships?.field_area?.data)
                  .map((id) => ({
                    id,
                    name: included.find((r) => r.id === id)?.attributes.name as string | undefined,
                  }))
                  .filter((x): x is { id: string; name: string } => !!x.name);
                const nSubjectTags = toRelIds(note.relationships?.field_subject?.data)
                  .map((id) => ({
                    id,
                    name: included.find((r) => r.id === id)?.attributes.name as string | undefined,
                  }))
                  .filter((x): x is { id: string; name: string } => !!x.name);
                const rawBody = (note.attributes.field_body as string | null) ?? '';
                const preview = stripMarkdown(rawBody).slice(0, 110);
                const changed = note.attributes.changed as string | undefined;
                const isSelected = selectedId === note.id;

                return (
                  <div
                    key={note.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(note.id, el);
                      else rowRefs.current.delete(note.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectNote(note.id)}
                    onDoubleClick={() => router.push(`/dashboard/notes/${note.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectNote(note.id);
                      }
                    }}
                    className={cn(
                      'group relative w-full text-left px-4 py-3 border-b border-border transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-muted'
                        : 'hover:bg-muted/50',
                      highlightId === note.id && 'note-jump-highlight'
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground truncate leading-snug">
                          {note.attributes.title as string}
                        </span>
                        <MissingMediaIndicator
                          count={toStringArray(note.attributes.field_missing_media).length}
                        />
                        <AttachmentsIndicator
                          hasAttachments={!!note.attributes.field_has_attachments}
                        />
                        <ShareIndicator shared={!!note.attributes.field_is_shared} />
                      </span>
                      {changed && (
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {timeAgo(changed)}
                        </span>
                      )}
                    </div>
                    {preview && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed pr-6">
                        {preview}
                      </p>
                    )}
                    {(nAreaTags.length > 0 || nSubjectTags.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {nAreaTags.map((a) => (
                          <Badge key={a.id} variant="secondary" className="text-[10px] py-0 h-4 px-1.5">
                            {a.name}
                          </Badge>
                        ))}
                        {nSubjectTags.map((s) => (
                          <Badge key={s.id} variant="outline" className="text-[10px] py-0 h-4 px-1.5">
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Full-screen view — hidden until hover, absolutely
                        positioned so it doesn't shift the row's layout. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/dashboard/notes/${note.id}/view`);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="absolute bottom-1.5 right-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="Open full-screen view"
                      title="Open full-screen view"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
                </Fragment>
              ))}

              {/* Infinite-scroll sentinel: entering view loads the next
                  page. The button is a fallback for when the observer
                  can't fire (and gives keyboard users a way through). */}
              <div ref={sentinelRef} aria-hidden="true" className="h-px" />

              {loadingMore && (
                <div className="px-4 py-3 border-b border-border">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted mb-2" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted mb-1" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              )}

              {hasMore && !loadingMore && (
                <div className="flex justify-center p-3">
                  <button
                    onClick={loadMore}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    Load more
                  </button>
                </div>
              )}

              {!hasMore && notes.length > 0 && (
                <p className="p-3 text-center text-[11px] text-muted-foreground">
                  {hasFilters ? 'End of filtered notes' : 'End of notes'}
                </p>
              )}
              </>
            )}
          </ScrollArea>
        </aside>

        {/* ── Reader ──────────────────────────────────────────────────────── */}
        <main
          className={cn(
            'flex min-h-0 flex-1 flex-col bg-background',
            mobileShowReader ? 'flex' : 'hidden md:flex'
          )}
        >
          {selectedNote ? (
            <ScrollArea className="flex-1 min-h-0">
            <div className="max-w-3xl mx-auto w-full px-6 py-8">

              {/* Reader header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-start gap-2 min-w-0">
                  {/* Mobile: back to sidebar */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setMobileShowReader(false)}
                    className="md:hidden mt-0.5 shrink-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">Back to list</span>
                  </Button>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground leading-tight">
                      {selectedNote.attributes.title as string}
                    </h1>
                    {(selectedAreaTags.length > 0 || selectedSubjectTags.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selectedAreaTags.map((a) => (
                          <Badge key={a.id} variant="secondary">{a.name}</Badge>
                        ))}
                        {selectedSubjectTags.map((s) => (
                          <Badge key={s.id} variant="outline">{s.name}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  nativeButton={false}
                  render={<Link href={`/dashboard/notes/${selectedNote.id}`} />}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              </div>

              {/* Markdown body */}
              {noteBody.trim() ? (
                <article className="prose prose-sm max-w-none">
                  <MarkdownRenderer>{noteBody}</MarkdownRenderer>
                </article>
              ) : (
                <p className="text-sm text-muted-foreground italic">No content yet.</p>
              )}

              {/* Linked decks */}
              {linkedDecks.length > 0 && (
                <section className="mt-12 pt-8 border-t border-border">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Layers className="h-4 w-4" />
                    Linked decks
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {linkedDecks.map((deck) => (
                      <Link
                        key={deck.id}
                        href={`/dashboard/decks/${deck.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                      >
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        {deck.attributes.title as string}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Linked notes */}
              {linkedNotes.length > 0 && (
                <section className={cn("pt-8 border-t border-border", linkedDecks.length > 0 ? "mt-6" : "mt-12")}>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />
                    Linked notes
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {linkedNotes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => { setSelectedId(note.id); setMobileShowReader(true); }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                      >
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {note.attributes.title as string}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Linked todos */}
              {linkedTodos.length > 0 && (
                <section className={cn("pt-8 border-t border-border", (linkedDecks.length > 0 || linkedNotes.length > 0) ? "mt-6" : "mt-12")}>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <CheckSquare className="h-4 w-4" />
                    Linked todos
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {linkedTodos.map((todo) => (
                      <Link
                        key={todo.id}
                        href={`/dashboard/todos?id=${todo.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                      >
                        <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        {todo.attributes.title as string}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
            </ScrollArea>
          ) : (
            /* Empty state — only visible on desktop when nothing is selected */
            <div className="hidden md:flex flex-col flex-1 items-center justify-center text-center p-8">
              <FileText className="h-10 w-10 text-muted-foreground/25 mb-3" />
              <p className="text-sm text-muted-foreground">Select a note to read it</p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
