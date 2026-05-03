'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Shuffle,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SharedDeck, SharedDeckCard } from '@/app/share/_lib/fetch-share';

type Result = 'correct' | 'incorrect';

const SLIDE_MS = 257;
const FLIP_MS = 300;

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function StudyDeckClient({ deck }: { deck: SharedDeck }) {
  const allCards = useMemo<SharedDeckCard[]>(() => deck.cards, [deck.cards]);

  const [sessionCards, setSessionCards] = useState<SharedDeckCard[]>(allCards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Map<string, Result>>(new Map());
  const [done, setDone] = useState(false);

  const [outgoing, setOutgoing] = useState<{ index: number; revealed: boolean } | null>(null);
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const currentCard = sessionCards[index];
  const total = sessionCards.length;
  const correctCount = [...results.values()].filter((v) => v === 'correct').length;
  const incorrectCount = [...results.values()].filter((v) => v === 'incorrect').length;
  const progressPercent = total > 0 ? Math.round((index / total) * 100) : 0;

  const flip = useCallback(() => {
    if (slideTimerRef.current !== null) return;
    setRevealed((r) => !r);
  }, []);

  const navigateWithAnim = useCallback(
    (direction: 'forward' | 'back', newIndex: number) => {
      if (slideTimerRef.current !== null) return;
      if (stageRef.current) setLockedHeight(stageRef.current.offsetHeight);
      setOutgoing({ index, revealed });
      setSlideDir(direction);
      setIndex(newIndex);
      setRevealed(false);
      slideTimerRef.current = setTimeout(() => {
        setOutgoing(null);
        setLockedHeight(null);
        slideTimerRef.current = null;
      }, SLIDE_MS);
    },
    [index, revealed],
  );

  const goBack = useCallback(() => {
    if (index > 0) navigateWithAnim('back', index - 1);
  }, [index, navigateWithAnim]);

  const goForward = useCallback(() => {
    if (index + 1 >= total) {
      setDone(true);
    } else {
      navigateWithAnim('forward', index + 1);
    }
  }, [index, total, navigateWithAnim]);

  const record = useCallback(
    (result: Result) => {
      if (!currentCard) return;
      setResults((prev) => new Map(prev).set(currentCard.uuid, result));
      goForward();
    },
    [currentCard, goForward],
  );

  const shuffleRemaining = useCallback(() => {
    setSessionCards((prev) => {
      const visited = prev.slice(0, index + 1);
      const remaining = fisherYates(prev.slice(index + 1));
      return [...visited, ...remaining];
    });
  }, [index]);

  const resetAnimState = useCallback(() => {
    if (slideTimerRef.current) {
      clearTimeout(slideTimerRef.current);
      slideTimerRef.current = null;
    }
    setOutgoing(null);
    setLockedHeight(null);
  }, []);

  const restartAll = useCallback(() => {
    resetAnimState();
    setSessionCards(allCards);
    setIndex(0);
    setRevealed(false);
    setResults(new Map());
    setDone(false);
  }, [allCards, resetAnimState]);

  const restartMissed = useCallback(() => {
    const missed = sessionCards.filter((c) => results.get(c.uuid) !== 'correct');
    if (missed.length === 0) return;
    resetAnimState();
    setSessionCards(missed);
    setIndex(0);
    setRevealed(false);
    setResults(new Map());
    setDone(false);
  }, [sessionCards, results, resetAnimState]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (done) return;

      if (e.key === ' ') {
        e.preventDefault();
        flip();
      }
      if (e.key === 'ArrowLeft') goBack();
      if (e.key === 'ArrowRight') goForward();
      if (revealed) {
        if (e.key === 'x' || e.key === 'X') record('incorrect');
        if (e.key === 'Enter') {
          e.preventDefault();
          record('correct');
        }
      } else {
        if (e.key === 'Enter') {
          e.preventDefault();
          flip();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [revealed, done, flip, goBack, goForward, record]);

  if (allCards.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{deck.title}</h1>
        {(deck.area || deck.subject) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {deck.area && <Badge variant="secondary">{deck.area.name}</Badge>}
            {deck.subject && <Badge variant="outline">{deck.subject.name}</Badge>}
          </div>
        )}
        <p className="mt-6 text-muted-foreground">This deck has no cards yet.</p>
      </div>
    );
  }

  if (done) {
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const missedCount = sessionCards.filter((c) => results.get(c.uuid) !== 'correct').length;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 px-6">
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
        </div>
      </div>
    );
  }

  if (!currentCard) return null;

  const cardResult = results.get(currentCard.uuid);
  const remainingCount = total - index - 1;

  return (
    <div className="flex flex-col select-none">
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-screen-md flex items-center gap-2 px-4 sm:px-6 h-12">
          <span className="flex-1 font-medium text-foreground truncate text-sm">{deck.title}</span>

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
        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col items-center justify-center px-4 sm:px-8 py-10 gap-5">
        <div
          ref={stageRef}
          className="w-full max-w-2xl overflow-hidden rounded-2xl"
          style={{
            display: 'grid',
            ...(lockedHeight !== null ? { height: lockedHeight } : {}),
          }}
        >
          {outgoing !== null &&
            (() => {
              const outCard = sessionCards[outgoing.index];
              const outFront = outCard?.front ?? '';
              const outBack = outCard?.back ?? '';
              return (
                <div
                  key={`out-${outgoing.index}`}
                  style={{
                    gridRow: '1',
                    gridColumn: '1',
                    animation: `${
                      slideDir === 'forward' ? 'card-slide-out-left' : 'card-slide-out-right'
                    } ${SLIDE_MS}ms ease forwards`,
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                >
                  <div style={{ perspective: '1200px' }}>
                    <div
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: outgoing.revealed ? 'rotateY(180deg)' : 'rotateY(0deg)',
                        transition: 'none',
                        display: 'grid',
                      }}
                    >
                      <div
                        style={
                          {
                            gridRow: '1',
                            gridColumn: '1',
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                          } as React.CSSProperties
                        }
                        className="rounded-2xl border border-border bg-card p-8 flex flex-col items-center justify-center text-center min-h-52"
                      >
                        <p className="text-lg font-medium text-foreground leading-relaxed whitespace-pre-wrap">
                          {outFront}
                        </p>
                      </div>
                      <div
                        style={
                          {
                            gridRow: '1',
                            gridColumn: '1',
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                            transform: 'rotateY(180deg)',
                          } as React.CSSProperties
                        }
                        className="rounded-2xl border border-primary/30 bg-card p-8 flex flex-col items-center justify-center text-center gap-4 min-h-52"
                      >
                        <div className="w-full">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-3">
                            Answer
                          </p>
                          <p className="text-lg text-foreground leading-relaxed whitespace-pre-wrap">
                            {outBack}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

          <div
            role="button"
            tabIndex={0}
            onClick={flip}
            onKeyDown={(e) => {
              if (e.key === ' ') flip();
              else if (e.key === 'Enter') (revealed ? record('correct') : flip());
            }}
            style={{
              gridRow: '1',
              gridColumn: '1',
              animation:
                outgoing !== null
                  ? `${
                      slideDir === 'forward'
                        ? 'card-slide-in-from-right'
                        : 'card-slide-in-from-left'
                    } ${SLIDE_MS}ms ease forwards`
                  : 'none',
              zIndex: 1,
            }}
            className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl cursor-pointer"
          >
            <div style={{ perspective: '1200px' }}>
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transform: revealed ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  transition: `transform ${FLIP_MS}ms ease`,
                  display: 'grid',
                }}
              >
                <div
                  style={
                    {
                      gridRow: '1',
                      gridColumn: '1',
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                    } as React.CSSProperties
                  }
                  className="rounded-2xl border border-border bg-card p-8 flex flex-col items-center justify-center text-center min-h-52 transition-colors group-hover:border-ring/50"
                >
                  <p className="text-lg font-medium text-foreground leading-relaxed whitespace-pre-wrap">
                    {currentCard.front}
                  </p>
                  <p className="mt-6 text-xs text-muted-foreground/40 select-none">
                    click to flip
                  </p>
                </div>
                <div
                  style={
                    {
                      gridRow: '1',
                      gridColumn: '1',
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                    } as React.CSSProperties
                  }
                  className="rounded-2xl border border-primary/30 bg-card p-8 flex flex-col items-center justify-center text-center gap-4 min-h-52 transition-colors group-hover:border-primary/60"
                >
                  <div className="w-full">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-3">
                      Answer
                    </p>
                    <p className="text-lg text-foreground leading-relaxed whitespace-pre-wrap">
                      {currentCard.back}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">
            {index + 1} / {total}
          </span>
          {cardResult && (
            <span
              className={cn(
                'text-xs font-medium',
                cardResult === 'correct' ? 'text-green-500' : 'text-destructive',
              )}
            >
              {cardResult === 'correct' ? '· ✓ correct' : '· ✗ incorrect'}
            </span>
          )}
        </div>

        {revealed && (
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={() => record('incorrect')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-destructive/30 bg-destructive/5 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15"
            >
              <X className="h-5 w-5" />
              Got it wrong
            </button>
            <button
              onClick={() => record('correct')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-green-500/30 bg-green-500/5 py-3 text-sm font-medium text-green-500 transition-colors hover:bg-green-500/15"
            >
              Got it right
              <Check className="h-5 w-5" />
            </button>
          </div>
        )}

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
      </div>
    </div>
  );
}
