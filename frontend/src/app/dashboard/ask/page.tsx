'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  OFFLINE_ACTION_MESSAGE,
  messageWhenNetworkRequestThrows,
} from '@/lib/api-client-messages';

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
  | { kind: 'error'; message: string };

// ── SSE parsing ──────────────────────────────────────────────────────────────

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

export default function AskAiPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const { isOnline } = useOnlineStatus();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

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

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, limit: 8 }),
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
  }, [question, isOnline]);

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
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              <kbd className="font-mono">⌘</kbd>
              <kbd className="font-mono">↵</kbd> to send. Answers cite the source notes used.
            </p>
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
