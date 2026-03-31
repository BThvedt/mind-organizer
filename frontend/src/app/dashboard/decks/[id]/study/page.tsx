'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, X, RotateCcw, ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

type Result = 'correct' | 'incorrect';

interface CardsResponse {
  data: JsonApiResource[];
}

interface DeckResponse {
  data: JsonApiResource;
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function StudyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [deckTitle, setDeckTitle] = useState('');
  const [cards, setCards] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);

  // Session state
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Map<string, Result>>(new Map());
  const [done, setDone] = useState(false);
  const [sessionCards, setSessionCards] = useState<JsonApiResource[]>([]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([
      fetch(`/api/decks/${id}`),
      fetch(`/api/decks/${id}/cards`),
    ]).then(async ([deckRes, cardsRes]) => {
      if (deckRes.ok) {
        const d: DeckResponse = await deckRes.json();
        setDeckTitle(d.data.attributes.title as string);
      }
      if (cardsRes.ok) {
        const c: CardsResponse = await cardsRes.json();
        const loaded = c.data ?? [];
        setCards(loaded);
        setSessionCards(loaded);
      }
      setLoading(false);
    });
  }, [authenticated, id]);

  const currentCard = sessionCards[index];
  const total = sessionCards.length;
  const correctCount = [...results.values()].filter((v) => v === 'correct').length;
  const incorrectCount = [...results.values()].filter((v) => v === 'incorrect').length;
  const progressPercent = total > 0 ? Math.round((index / total) * 100) : 0;

  const flip = useCallback(() => setRevealed((r) => !r), []);

  const goBack = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setRevealed(false);
    }
  }, [index]);

  const goForward = useCallback(() => {
    if (index + 1 >= total) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
      setRevealed(false);
    }
  }, [index, total]);

  const record = useCallback(
    (result: Result) => {
      if (!currentCard) return;
      setResults((prev) => new Map(prev).set(currentCard.id, result));
      goForward();
    },
    [currentCard, goForward]
  );

  const shuffleRemaining = useCallback(() => {
    setSessionCards((prev) => {
      const visited = prev.slice(0, index + 1);
      const remaining = fisherYates(prev.slice(index + 1));
      return [...visited, ...remaining];
    });
  }, [index]);

  const restartAll = useCallback(() => {
    setSessionCards(cards);
    setIndex(0);
    setRevealed(false);
    setResults(new Map());
    setDone(false);
  }, [cards]);

  const restartMissed = useCallback(() => {
    const missed = sessionCards.filter((c) => results.get(c.id) !== 'correct');
    if (missed.length === 0) return;
    setSessionCards(missed);
    setIndex(0);
    setRevealed(false);
    setResults(new Map());
    setDone(false);
  }, [sessionCards, results]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (done) return;

      if (e.key === ' ') {
        e.preventDefault();
        flip();
      }
      if (e.key === 'ArrowLeft') goBack();
      if (e.key === 'ArrowRight') goForward();
      if (revealed) {
        if (e.key === 'x' || e.key === 'X') record('incorrect');
        if (e.key === 'Enter') { e.preventDefault(); record('correct'); }
      } else {
        if (e.key === 'Enter') { e.preventDefault(); flip(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [revealed, done, flip, goBack, goForward, record]);

  if (!authenticated || loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-foreground">No cards in this deck yet.</p>
        <Button nativeButton={false} render={<Link href={`/dashboard/decks/${id}`} />}>
          Back to deck
        </Button>
      </div>
    );
  }

  // ── End screen ───────────────────────────────────────────────────────────
  if (done) {
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const missedCount = sessionCards.filter((c) => results.get(c.id) !== 'correct').length;

    return (
      <div className="flex h-dvh flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 h-14 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href={`/dashboard/decks/${id}`} />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to deck</span>
          </Button>
          <span className="font-medium text-foreground truncate">{deckTitle}</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
          <div className="text-center">
            <p className="text-4xl font-bold text-foreground mb-1">{pct}%</p>
            <p className="text-muted-foreground text-sm">
              {pct >= 80 ? 'Great work!' : pct >= 50 ? 'Keep it up!' : 'Keep practicing!'}
            </p>
          </div>

          <div className="flex gap-6">
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                <Check className="h-6 w-6 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-foreground">{correctCount}</p>
              <p className="text-xs text-muted-foreground">Correct</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <X className="h-6 w-6 text-destructive" />
              </div>
              <p className="text-2xl font-bold text-foreground">{incorrectCount}</p>
              <p className="text-xs text-muted-foreground">Incorrect</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {missedCount > 0 && (
              <Button onClick={restartMissed}>
                <RotateCcw className="h-4 w-4" />
                Study {missedCount} missed {missedCount === 1 ? 'card' : 'cards'}
              </Button>
            )}
            <Button variant="outline" onClick={restartAll}>
              <RotateCcw className="h-4 w-4" />
              Restart all
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/dashboard/decks/${id}`} />}
            >
              Back to deck
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Study screen ─────────────────────────────────────────────────────────
  if (!currentCard) return null;

  const front = currentCard.attributes.field_front as string;
  const back = currentCard.attributes.field_back as string;
  const cardResult = results.get(currentCard.id);
  const remainingCount = total - index - 1;

  return (
    <div className="flex h-dvh flex-col select-none">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 sm:px-6 h-14 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/dashboard/decks/${id}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Exit study session</span>
        </Button>

        <span className="flex-1 font-medium text-foreground truncate text-sm">{deckTitle}</span>

        {/* Running score */}
        {(correctCount > 0 || incorrectCount > 0) && (
          <div className="flex items-center gap-2.5 text-sm tabular-nums">
            <span className="flex items-center gap-1 text-green-500">
              <Check className="h-3.5 w-3.5" />
              {correctCount}
            </span>
            <span className="flex items-center gap-1 text-destructive">
              <X className="h-3.5 w-3.5" />
              {incorrectCount}
            </span>
          </div>
        )}

        {/* Shuffle remaining */}
        {remainingCount > 1 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={shuffleRemaining}
            title={`Shuffle ${remainingCount} remaining cards`}
          >
            <Shuffle className="h-4 w-4" />
            <span className="sr-only">Shuffle remaining cards</span>
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full bg-muted shrink-0">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Card area */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 sm:px-8 py-8 gap-5">
        {/* The card — click to flip */}
        <div
          role="button"
          tabIndex={0}
          onClick={flip}
          onKeyDown={(e) => {
            if (e.key === ' ') flip();
            else if (e.key === 'Enter') revealed ? record('correct') : flip();
          }}
          className="w-full max-w-2xl min-h-52 rounded-2xl border border-border bg-card p-8 flex flex-col items-center justify-center text-center gap-4 cursor-pointer transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="w-full">
            <p className="text-lg font-medium text-foreground leading-relaxed whitespace-pre-wrap">
              {front}
            </p>
          </div>

          {revealed && (
            <>
              <div className="w-full border-t border-border" />
              <div className="w-full">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-3">
                  Answer
                </p>
                <p className="text-lg text-foreground leading-relaxed whitespace-pre-wrap">
                  {back}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Numeric indicator */}
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">
            {index + 1} / {total}
          </span>
          {cardResult && (
            <span
              className={cn(
                'text-xs font-medium',
                cardResult === 'correct' ? 'text-green-500' : 'text-destructive'
              )}
            >
              {cardResult === 'correct' ? '· ✓ correct' : '· ✗ incorrect'}
            </span>
          )}
        </div>

        {/* ✓ / ✗ mark buttons — only shown after flipping */}
        {revealed && (
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={() => record('incorrect')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-destructive/30 bg-destructive/5 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <X className="h-5 w-5" />
              Got it wrong
              <kbd className="ml-1 hidden sm:inline rounded border border-destructive/30 px-1 py-0.5 font-mono text-[10px]">
                X
              </kbd>
            </button>
            <button
              onClick={() => record('correct')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-green-500/30 bg-green-500/5 py-3 text-sm font-medium text-green-500 transition-colors hover:bg-green-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              Got it right
              <Check className="h-5 w-5" />
              <kbd className="ml-1 hidden sm:inline rounded border border-green-500/30 px-1 py-0.5 font-mono text-[10px]">
                ↵
              </kbd>
            </button>
          </div>
        )}

        {/* Previous / Next — always visible */}
        <div className="flex items-center gap-6">
          <button
            onClick={goBack}
            disabled={index === 0}
            className="flex items-center gap-1 text-sm text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            onClick={goForward}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-sm text-muted-foreground/50 hidden sm:block">
          {revealed
            ? 'Space to flip · X incorrect · ↵ correct · ← → navigate'
            : 'Space/↵ to flip · ← → navigate'}
        </p>
      </div>
    </div>
  );
}
