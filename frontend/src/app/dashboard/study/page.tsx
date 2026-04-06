'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, X, RotateCcw, ChevronLeft, ChevronRight, Shuffle, BookMarked } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AreaSubjectSelector } from '@/components/area-subject-selector';
import {
  loadSRSPool,
  saveSRSPool,
  enrollNewCards,
  buildSessionQueue,
  computeNextReview,
  retireCard,
  nextDueDate,
  RETIREMENT_STREAK,
} from '@/lib/srs';
import type { StudyCard, SRSPool } from '@/lib/srs';
import type { JsonApiResource, JsonApiRelData } from '@/lib/drupal';
import { logSession } from '@/lib/sessions';

type Result = 'correct' | 'incorrect';

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });
}

// ── Setup screen ──────────────────────────────────────────────────────────────

interface SetupScreenProps {
  queueSize: number;
  nextDue: string | null;
  filterAreaId: string;
  filterSubjectId: string;
  onAreaChange: (id: string) => void;
  onSubjectChange: (id: string) => void;
  onStart: () => void;
}

function SetupScreen({
  queueSize,
  nextDue,
  filterAreaId,
  filterSubjectId,
  onAreaChange,
  onSubjectChange,
  onStart,
}: SetupScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Study Now</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Cross-deck review · spaced repetition
        </p>
      </div>

      {/* Filter */}
      <div className="w-full max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Filter by area / subject
        </p>
        <AreaSubjectSelector
          areaUuid={filterAreaId}
          subjectUuid={filterSubjectId}
          onAreaChange={onAreaChange}
          onSubjectChange={onSubjectChange}
          layout="col"
        />
      </div>

      {/* Queue summary */}
      {queueSize > 0 ? (
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <span className="text-3xl font-bold text-primary">{queueSize}</span>
          </div>
          <p className="text-muted-foreground text-sm">
            {queueSize === 1 ? 'card' : 'cards'} due today
          </p>
          <Button onClick={onStart}>Start session</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-semibold text-foreground">
            {filterAreaId || filterSubjectId
              ? 'No cards due in this filter.'
              : 'Nothing due today!'}
          </p>
          {nextDue && (
            <p className="text-sm text-muted-foreground">
              Next card due {formatDate(nextDue)}
            </p>
          )}
          {(filterAreaId || filterSubjectId) && (
            <p className="text-xs text-muted-foreground">
              Try clearing the filter to see all due cards.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StudyNowPage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  // Raw card data from API
  const [allCards, setAllCards] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);

  // SRS pool (kept in sync with localStorage)
  const [pool, setPool] = useState<SRSPool>({});

  // Filters
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');

  // Session state
  const [sessionCards, setSessionCards] = useState<(StudyCard & { srs: ReturnType<typeof buildSessionQueue>[number]['srs'] })[]>([]);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Map<string, Result>>(new Map());
  const [done, setDone] = useState(false);
  const sessionStartedAt = useRef<string | null>(null);
  const sessionLogged = useRef(false);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

  // ── Load cards + enrol into SRS pool ─────────────────────────────────────

  useEffect(() => {
    if (!authenticated) return;

    fetch('/api/cards')
      .then((r) => r.json())
      .then((json: { data: JsonApiResource[]; included?: JsonApiResource[] }) => {
        const included = json.included ?? [];

        const deckMap = new Map<string, JsonApiResource>();
        for (const inc of included) {
          if (inc.type === 'node--flashcard_deck') deckMap.set(inc.id, inc);
        }

        const cards: StudyCard[] = (json.data ?? []).map((c) => {
          const deckRel = c.relationships?.field_deck?.data as JsonApiRelData | null;
          const deck = deckRel ? deckMap.get(deckRel.id) : undefined;

          const areaRel = deck?.relationships?.field_area?.data as JsonApiRelData | null | undefined;
          const subjectRel = deck?.relationships?.field_subject?.data as JsonApiRelData | null | undefined;

          return {
            id: c.id,
            front: (c.attributes.field_front as string) ?? '',
            back: (c.attributes.field_back as string) ?? '',
            deckId: deckRel?.id ?? '',
            deckAreaId: areaRel?.id ?? null,
            deckSubjectId: subjectRel?.id ?? null,
            created: (c.attributes.created as string) ?? new Date().toISOString(),
          };
        });

        const currentPool = loadSRSPool();
        const updatedPool = enrollNewCards(currentPool, cards);
        saveSRSPool(updatedPool);

        setAllCards(cards);
        setPool(updatedPool);
        setLoading(false);
      });
  }, [authenticated]);

  // ── Computed queue (re-runs when filter or pool changes) ──────────────────

  const queue = buildSessionQueue(pool, allCards, filterAreaId || undefined, filterSubjectId || undefined);

  // ── Session controls ──────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    const q = buildSessionQueue(pool, allCards, filterAreaId || undefined, filterSubjectId || undefined);
    setSessionCards(q);
    setIndex(0);
    setRevealed(false);
    setResults(new Map());
    setDone(false);
    setSessionStarted(true);
    sessionStartedAt.current = new Date().toISOString();
    sessionLogged.current = false;
  }, [pool, allCards, filterAreaId, filterSubjectId]);

  const flip = useCallback(() => setRevealed((r) => !r), []);

  const goBack = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setRevealed(false);
    }
  }, [index]);

  const goForward = useCallback(() => {
    if (index + 1 >= sessionCards.length) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
      setRevealed(false);
    }
  }, [index, sessionCards.length]);

  const record = useCallback(
    (result: Result) => {
      const card = sessionCards[index];
      if (!card) return;

      setResults((prev) => new Map(prev).set(card.id, result));

      const quality = result === 'correct' ? 4 : 1;
      const updated = computeNextReview(card.srs, quality);
      const newPool = { ...pool, [card.id]: updated };
      setPool(newPool);
      saveSRSPool(newPool);

      goForward();
    },
    [sessionCards, index, pool, goForward]
  );

  const handleRetire = useCallback(() => {
    const card = sessionCards[index];
    if (!card) return;
    const newPool = { ...pool, [card.id]: retireCard(card.srs) };
    setPool(newPool);
    saveSRSPool(newPool);
    goForward();
  }, [sessionCards, index, pool, goForward]);

  const shuffleRemaining = useCallback(() => {
    setSessionCards((prev) => {
      const visited = prev.slice(0, index + 1);
      const remaining = fisherYates(prev.slice(index + 1));
      return [...visited, ...remaining];
    });
  }, [index]);

  const logCurrentSession = useCallback(() => {
    if (sessionLogged.current || !sessionStartedAt.current || results.size === 0) return;
    sessionLogged.current = true;
    const correct = [...results.values()].filter((v) => v === 'correct').length;
    const incorrect = [...results.values()].filter((v) => v === 'incorrect').length;
    logSession({
      startedAt: sessionStartedAt.current,
      endedAt: new Date().toISOString(),
      cardsReviewed: correct + incorrect,
      correctCount: correct,
      incorrectCount: incorrect,
      type: 'srs',
    });
  }, [results]);

  useEffect(() => {
    if (done) logCurrentSession();
  }, [done, logCurrentSession]);

  const restartSession = useCallback(() => {
    logCurrentSession();
    setSessionStarted(false);
    setDone(false);
    setResults(new Map());
  }, [logCurrentSession]);

  // ── Keyboard controls ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionStarted || done) return;

    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;

      if (e.key === ' ') { e.preventDefault(); flip(); }
      if (e.key === 'ArrowLeft') goBack();
      if (e.key === 'ArrowRight') goForward();
      if (revealed) {
        if (e.key === 'x' || e.key === 'X') record('incorrect');
        if (e.key === 'Enter') { e.preventDefault(); record('correct'); }
        if (e.key === 'r' || e.key === 'R') handleRetire();
      } else {
        if (e.key === 'Enter') { e.preventDefault(); flip(); }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sessionStarted, done, revealed, flip, goBack, goForward, record, handleRetire]);

  // ── Render: loading ───────────────────────────────────────────────────────

  if (!authenticated || loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const total = sessionCards.length;
  const currentCard = sessionCards[index];
  const correctCount = [...results.values()].filter((v) => v === 'correct').length;
  const incorrectCount = [...results.values()].filter((v) => v === 'incorrect').length;
  const progressPercent = total > 0 ? Math.round((index / total) * 100) : 0;
  const remainingCount = total - index - 1;
  const cardResult = currentCard ? results.get(currentCard.id) : undefined;

  // ── Render: end screen ────────────────────────────────────────────────────

  if (sessionStarted && done) {
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    return (
      <div className="flex h-dvh flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 h-14 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <span className="font-medium text-foreground">Study Now</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
          <div>
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
            <Button onClick={restartSession}>
              <RotateCcw className="h-4 w-4" />
              Study again
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              Back to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: setup screen ──────────────────────────────────────────────────

  if (!sessionStarted) {
    return (
      <div className="flex h-dvh flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 h-14 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <span className="font-medium text-foreground">Study Now</span>
        </div>

        <SetupScreen
          queueSize={queue.length}
          nextDue={nextDueDate(pool)}
          filterAreaId={filterAreaId}
          filterSubjectId={filterSubjectId}
          onAreaChange={(id) => { setFilterAreaId(id); setFilterSubjectId(''); }}
          onSubjectChange={setFilterSubjectId}
          onStart={handleStart}
        />
      </div>
    );
  }

  // ── Render: study screen ──────────────────────────────────────────────────

  if (!currentCard) return null;

  return (
    <div className="flex h-dvh flex-col select-none">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 sm:px-6 h-14 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Exit study session</span>
        </Button>

        <span className="flex-1 font-medium text-foreground truncate text-sm">Study Now</span>

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
            <span className="sr-only">Shuffle remaining</span>
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

        {/* Deck/subject context */}
        {(currentCard.deckAreaId || currentCard.deckSubjectId) && (
          <p className="text-xs text-muted-foreground/60 uppercase tracking-wider">
            {currentCard.deckAreaId ?? currentCard.deckSubjectId}
          </p>
        )}

        {/* The card */}
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
              {currentCard.front}
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
                  {currentCard.back}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Position + SRS streak */}
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
          {currentCard.srs.repetitions > 0 && !cardResult && (
            <span className="text-xs text-muted-foreground/60">
              · streak {currentCard.srs.repetitions}/{RETIREMENT_STREAK}
            </span>
          )}
        </div>

        {/* Correct / incorrect / retire buttons */}
        {revealed && (
          <div className="flex flex-col gap-2 w-full max-w-sm">
            <div className="flex gap-3">
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

            {/* Retire */}
            <button
              onClick={handleRetire}
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-1"
            >
              <BookMarked className="h-3.5 w-3.5" />
              Retire this card
              <kbd className="ml-0.5 hidden sm:inline rounded border border-border px-1 py-0.5 font-mono text-[10px]">
                R
              </kbd>
            </button>
          </div>
        )}

        {/* Previous / Next */}
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

        <p className="text-sm text-muted-foreground/50 hidden sm:block">
          {revealed
            ? 'Space to flip · X incorrect · ↵ correct · R retire · ← → navigate'
            : 'Space/↵ to flip · ← → navigate'}
        </p>
      </div>
    </div>
  );
}
