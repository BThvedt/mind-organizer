'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  Sparkles,
  Loader2,
  Send,
  FileText,
  Layers,
  CheckSquare,
  WifiOff,
  AlertCircle,
  Filter,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  OFFLINE_ACTION_MESSAGE,
  messageWhenNetworkRequestThrows,
} from '@/lib/api-client-messages';
import {
  MATCH_STRENGTH_DEFAULT,
  MATCH_STRENGTH_MAX,
  MATCH_STRENGTH_MIN,
  MATCH_STRENGTH_STEP,
} from '@/lib/match-strength';
import { useMatchStrengthPreferences } from '@/hooks/useMatchStrengthPreferences';

// ── Types ────────────────────────────────────────────────────────────────────

type CitationCard = {
  uuid: string;
  front: string;
  back: string;
  score: number | null;
};

interface Citation {
  n: number;
  uuid: string;
  type: 'study_note' | 'flashcard_deck' | 'todo_list' | string;
  title: string;
  score: number;
  card: CitationCard | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'streaming' }
  | { kind: 'done' }
  | { kind: 'empty' /* no_rag_content */ }
  | { kind: 'empty_filtered' /* no_match_for_filters */ }
  | { kind: 'error'; message: string };

interface TaxonomyTerm {
  id: string;
  attributes: { name: string };
}

// Score-threshold slider bounds live in `@/lib/match-strength`. The user's
// saved default comes from their Drupal profile via useMatchStrengthPreferences.

/**
 * Parses a raw SSE byte stream into discrete events. Each yielded event has
 * an `event` name and a JSON-parsed `data` payload (or undefined if the
 * payload was not valid JSON, which we treat as ignorable).
 *
 * Implemented as an async generator so the consumer can `for await … of`
 * the stream and update React state per event.
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseOneEvent(rawEvent);
        if (parsed) yield parsed;
      }
    }
    // Flush any trailing event without a blank line terminator.
    if (buffer.trim() !== '') {
      const parsed = parseOneEvent(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseOneEvent(raw: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(joined) };
  } catch {
    return { event, data: undefined };
  }
}

// ── Citation helpers ─────────────────────────────────────────────────────────

function citationHref(c: Citation): string {
  switch (c.type) {
    case 'study_note':
      return `/dashboard/notes/${c.uuid}`;
    case 'flashcard_deck':
      return `/dashboard/decks/${c.uuid}`;
    case 'todo_list':
      // The todos page renders the list inline; deep-linking by id is not
      // currently a routing convention, so we send the user to the index
      // and rely on familiarity. Future enhancement: add `?selected=`.
      return `/dashboard/todos`;
    default:
      return '/dashboard';
  }
}

function citationIcon(type: string) {
  switch (type) {
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

// ── Page ─────────────────────────────────────────────────────────────────────

// `useSearchParams()` reads from the request URL, so any component that
// calls it bails out of static prerender unless it's wrapped in a
// <Suspense> boundary. Vercel's `next build` enforces this — without
// the boundary the build fails with the "missing-suspense-with-csr-bailout"
// error. Matches the pattern used by /dashboard/notes and /dashboard/todos.
export default function AskAiPage() {
  return (
    <Suspense>
      <AskAiPageInner />
    </Suspense>
  );
}

function AskAiPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const { isOnline } = useOnlineStatus();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const { askDefault, loaded: prefsLoaded } = useMatchStrengthPreferences();

  // Optional retrieval filters. Empty values mean "no filter on that
  // dimension" and the request body omits them, so a fresh visit to the
  // page behaves exactly as before. Filters apply at submit time only —
  // we deliberately do not auto-resubmit when these change.
  const [showFilters, setShowFilters] = useState(false);
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterScoreThreshold, setFilterScoreThreshold] = useState(MATCH_STRENGTH_DEFAULT);
  const [areas, setAreas] = useState<TaxonomyTerm[]>([]);
  const [subjects, setSubjects] = useState<TaxonomyTerm[]>([]);

  useEffect(() => {
    if (!prefsLoaded) return;
    setFilterScoreThreshold(askDefault);
  }, [prefsLoaded, askDefault]);

  // Track the active fetch so we can cancel on unmount / new submission.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Track which incoming `?q=` value weve already auto-submitted so a
  // re-render (StrictMode double-effect, hot reload, etc.) doesnt re-fire
  // the same question. Cleared whenever the URL `q` changes.
  const autoSubmittedRef = useRef<string | null>(null);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  const submit = useCallback(async (override?: string) => {
    // `override` lets callers (e.g. the `?q=` auto-submit effect) submit a
    // value that hasnt yet been flushed into `question` state.
    const q = (override ?? question).trim();
    if (q.length < 2) return;
    if (!isOnline) {
      setStatus({ kind: 'error', message: OFFLINE_ACTION_MESSAGE });
      return;
    }

    // Cancel any in-flight request from a previous submission.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAnswer('');
    setCitations([]);
    setStatus({ kind: 'streaming' });

    // Build the optional `filters` object. We omit keys with empty values
    // so an unfiltered submission produces the exact same request body the
    // backend already understands. Subject is intentionally only sent when
    // an area is set — the cascade UI prevents an orphan subject anyway,
    // but the extra guard keeps the contract honest.
    const filters: Record<string, string> = {};
    if (filterAreaId) filters.area = filterAreaId;
    if (filterAreaId && filterSubjectId) filters.subject = filterSubjectId;
    if (filterDateFrom) filters.dateFrom = filterDateFrom;
    if (filterDateTo) filters.dateTo = filterDateTo;

    // `scoreThreshold` lives at the top-level of the request (not inside
    // `filters`) because it's a retrieval tuning knob rather than a
    // content predicate. We only send it when the user moved the slider
    // away from the page default — otherwise the backend default applies
    // and the empty-state for users with no content stays unchanged.
    const thresholdCustomised = filterScoreThreshold !== askDefault;

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          limit: 8,
          ...(Object.keys(filters).length > 0 ? { filters } : {}),
          ...(thresholdCustomised ? { scoreThreshold: filterScoreThreshold } : {}),
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        let msg = 'Could not get an answer.';
        try {
          const data = await res.json();
          if (typeof data?.error === 'string') msg = data.error;
        } catch {
          /* ignore */
        }
        setStatus({ kind: 'error', message: msg });
        return;
      }

      // Empty-context sentinel — non-streaming JSON.
      if (!contentType.startsWith('text/event-stream')) {
        const data = await res.json().catch(() => ({}));
        if (data?.reason === 'no_rag_content') {
          setStatus({ kind: 'empty' });
        } else if (data?.reason === 'no_match_for_filters') {
          setStatus({ kind: 'empty_filtered' });
        } else {
          setStatus({ kind: 'error', message: 'Unexpected response from the server.' });
        }
        return;
      }

      if (!res.body) {
        setStatus({ kind: 'error', message: 'No response stream.' });
        return;
      }

      let sawError = false;
      let sawDone = false;
      for await (const evt of parseSseStream(res.body)) {
        if (evt.event === 'citations' && evt.data && typeof evt.data === 'object') {
          const items = (evt.data as { items?: Citation[] }).items;
          if (Array.isArray(items)) setCitations(items);
        } else if (evt.event === 'token' && evt.data && typeof evt.data === 'object') {
          const text = (evt.data as { text?: string }).text;
          if (typeof text === 'string' && text !== '') {
            setAnswer((prev) => prev + text);
          }
        } else if (evt.event === 'error') {
          sawError = true;
          let msg = 'The answer stream was interrupted.';
          if (evt.data && typeof evt.data === 'object') {
            const candidate = (evt.data as { message?: unknown }).message;
            if (typeof candidate === 'string' && candidate.trim() !== '') {
              msg = candidate;
            }
          }
          setStatus({ kind: 'error', message: msg });
        } else if (evt.event === 'done') {
          sawDone = true;
        }
      }
      if (!sawError) {
        // If the upstream cleanly closed without an explicit `done` (e.g.
        // a flaky proxy), still mark complete — but only if we received
        // any tokens at all.
        setStatus(sawDone ? { kind: 'done' } : { kind: 'done' });
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setStatus({ kind: 'error', message: messageWhenNetworkRequestThrows() });
    }
  }, [question, isOnline, filterAreaId, filterSubjectId, filterDateFrom, filterDateTo, filterScoreThreshold, askDefault]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl-Enter submits.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  // Handoff from the global search dialog: when a `?q=` is present on
  // mount (or changes), pre-fill the composer and auto-submit. Authentication
  // must be resolved first so the API call doesnt fire while
  // `useAuth()` is still in its initial null/false state.
  useEffect(() => {
    if (!authenticated) return;
    const q = (searchParams.get('q') ?? '').trim();
    if (q.length < 2) return;
    if (autoSubmittedRef.current === q) return;
    autoSubmittedRef.current = q;
    setQuestion(q);
    void submit(q);
  }, [authenticated, searchParams, submit]);

  // Load the users areas once auth resolves. Same endpoint and shape the
  // search dialog uses, so the term ids returned here are JSON:API UUIDs.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    fetch('/api/taxonomy?type=areas')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => {
        if (!cancelled) setAreas(d.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setAreas([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  // Reload the subject list whenever the chosen area changes. Clearing the
  // area also clears the subject so the user cant submit an orphaned
  // subject filter that no longer belongs to a selected area.
  useEffect(() => {
    if (!filterAreaId) {
      setSubjects([]);
      setFilterSubjectId('');
      return;
    }
    let cancelled = false;
    fetch(`/api/taxonomy?type=subjects&area=${encodeURIComponent(filterAreaId)}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => {
        if (!cancelled) setSubjects(d.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setSubjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filterAreaId]);

  // Count of dimensions currently constraining the query. Drives the badge
  // on the Filters toggle. Subject is only counted when it would actually
  // be sent (i.e. area is set too). The threshold counts only when it
  // differs from the page default.
  const activeFilterCount =
    (filterAreaId ? 1 : 0) +
    (filterSubjectId && filterAreaId ? 1 : 0) +
    (filterDateFrom ? 1 : 0) +
    (filterDateTo ? 1 : 0) +
    (filterScoreThreshold !== askDefault ? 1 : 0);

  const clearFilters = useCallback(() => {
    setFilterAreaId('');
    setFilterSubjectId('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterScoreThreshold(askDefault);
  }, [askDefault]);

  if (!authenticated) return null;

  const streaming = status.kind === 'streaming';

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-3xl px-6 pt-28 pb-16">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Ask AI</h1>
            <p className="text-sm text-muted-foreground">
              Get answers grounded in the notes, decks, and todos you&apos;ve flagged for AI Q&amp;A.
            </p>
          </div>
        </div>

        {/* ── Composer ── */}
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What would you like to know?"
            rows={3}
            className="resize-none"
            disabled={streaming}
            autoFocus
          />

          {/*
            Filters panel. Off by default; the toggle reveals area / subject /
            date-range inputs that narrow the retrieval pool when set. The
            panel is collapsible (rather than always-visible) so the page
            stays low-noise for users who never need filtering.
          */}
          {showFilters && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">
                  Filters
                </p>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" aria-hidden />
                    Clear all
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Area */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Area
                  <select
                    value={filterAreaId}
                    onChange={(e) => {
                      setFilterAreaId(e.target.value);
                      setFilterSubjectId('');
                    }}
                    disabled={areas.length === 0 || streaming}
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                  >
                    <option value="">Any area</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.attributes.name}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Subject — only meaningful once an area is picked */}
                {filterAreaId && subjects.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Subject
                    <select
                      value={filterSubjectId}
                      onChange={(e) => setFilterSubjectId(e.target.value)}
                      disabled={streaming}
                      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    >
                      <option value="">Any subject</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.attributes.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Date range — both bounds optional and inclusive on the backend */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  From
                  <Input
                    type="date"
                    value={filterDateFrom}
                    max={filterDateTo || undefined}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    disabled={streaming}
                    className="h-7 w-36 rounded-md border border-border bg-background px-2 text-xs"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  To
                  <Input
                    type="date"
                    value={filterDateTo}
                    min={filterDateFrom || undefined}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    disabled={streaming}
                    className="h-7 w-36 rounded-md border border-border bg-background px-2 text-xs"
                  />
                </label>
              </div>

              {/*
                Match-strength slider. Cosine score on voyage-3-lite ranges
                roughly 0–0.95 in practice; we cap the range there to keep
                the slider's working surface usable. Lower values include
                weaker matches as context (good for vague questions and
                small corpora); higher values demand a stronger overlap
                between the question and a source.
              */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="filter-score-threshold"
                    className="text-xs text-muted-foreground"
                  >
                    Match strength
                  </label>
                  <span className="font-mono text-xs text-foreground tabular-nums">
                    {filterScoreThreshold.toFixed(2)}
                  </span>
                </div>
                <input
                  id="filter-score-threshold"
                  type="range"
                  min={MATCH_STRENGTH_MIN}
                  max={MATCH_STRENGTH_MAX}
                  step={MATCH_STRENGTH_STEP}
                  value={filterScoreThreshold}
                  onChange={(e) => setFilterScoreThreshold(parseFloat(e.target.value))}
                  disabled={streaming}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary disabled:opacity-60"
                />
                <p className="text-[11px] text-muted-foreground">
                  Everyone&apos;s notes are different. Too many results? Raise the
                  threshold. Too few? Lower it.
                </p>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Filters apply on the next <span className="font-medium">Ask</span>;
                changes here do not auto-resubmit. Cards inherit their parent
                deck&apos;s area and subject.
              </p>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                <kbd className="font-mono">⌘</kbd>
                <kbd className="font-mono">↵</kbd> to send. Answers cite the source notes used.
              </p>
              {/* Filter toggle — mirrors the search dialogs Date range pill */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                aria-pressed={showFilters}
                aria-label="Toggle filters"
                className={cn(
                  'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs transition-colors',
                  showFilters || activeFilterCount > 0
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <Filter className="h-3.5 w-3.5" aria-hidden />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
            <Button
              size="sm"
              disabled={!isOnline || streaming || question.trim().length < 2}
              onClick={() => void submit()}
              className="gap-2"
            >
              {streaming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Thinking…
                </>
              ) : !isOnline ? (
                <>
                  <WifiOff className="h-4 w-4" aria-hidden />
                  Offline
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden />
                  Ask
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ── Citation chips ── */}
        {citations.length > 0 && (
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Sources</p>
            <div className="flex flex-wrap gap-2">
              {citations.map((c) => (
                <Link
                  key={`${c.uuid}-${c.n}`}
                  href={citationHref(c)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground hover:border-ring/50 hover:bg-muted/40 transition-colors"
                  title={
                    c.card
                      ? `Card from "${c.title}": ${c.card.front}`
                      : `${c.title} — ${Math.round(c.score * 100)}% match`
                  }
                >
                  <span className="text-muted-foreground font-mono">[{c.n}]</span>
                  {citationIcon(c.type)}
                  <span className="max-w-[18ch] truncate">{c.title}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Answer / states ── */}
        {status.kind === 'idle' && (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            Toggle <span className="font-medium text-foreground">Include in AI Q&amp;A</span> on a
            note, deck, or todo list to make it available here. Notes are included by default;
            decks and todo lists are off until you flip them on.
          </div>
        )}

        {status.kind === 'empty_filtered' && (
          <div className="rounded-xl border border-border bg-card px-4 py-6">
            <div className="flex items-start gap-3">
              <Filter className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">
                  No matching content for the current filters
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  You have AI&nbsp;Q&amp;A content, but nothing matches the area, subject, or date
                  range you selected. Try clearing or widening the filters.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearFilters}
                    disabled={activeFilterCount === 0}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Clear filters
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowFilters(true)}
                  >
                    <Filter className="h-3.5 w-3.5" aria-hidden />
                    Edit filters
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {status.kind === 'empty' && (
          <div className="rounded-xl border border-border bg-card px-4 py-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">
                  No AI Q&amp;A content yet
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Nothing in your library is currently marked for AI Q&amp;A. Open a note, deck,
                  or todo list and flip the <span className="font-medium">Include in AI Q&amp;A</span>{' '}
                  toggle in its AI Actions menu.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/dashboard/notes" />}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Recent notes
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/dashboard/decks" />}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden />
                    Decks
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/dashboard/todos" />}
                  >
                    <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                    Todos
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {(status.kind === 'streaming' || status.kind === 'done' || (status.kind === 'error' && answer)) && (
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <div className={cn(streaming && 'opacity-95')}>
              <MarkdownRenderer>{answer || '_…_'}</MarkdownRenderer>
            </div>
            {status.kind === 'streaming' && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Streaming…
              </p>
            )}
          </div>
        )}

        {status.kind === 'error' && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {status.message}
          </div>
        )}
      </main>
    </>
  );
}
