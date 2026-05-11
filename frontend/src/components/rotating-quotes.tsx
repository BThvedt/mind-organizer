'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const ROTATION_INTERVAL_MS = 6000;
const TRANSITION_MS = 600;

type Quote = {
  id: string;
  text: string;
  author: string | null;
};

type QuotesResponse = {
  quotes: Quote[];
};

export function RotatingQuotes() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [previousIdx, setPreviousIdx] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    async function load() {
      try {
        const res = await fetch('/api/quotes/featured', { signal: ac.signal });
        if (!res.ok) {
          setQuotes([]);
          return;
        }
        const json = (await res.json()) as QuotesResponse;
        setQuotes(json.quotes ?? []);
      } catch {
        setQuotes([]);
      }
    }
    load();
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!quotes || quotes.length < 2 || paused) return;
    const tick = setInterval(() => {
      setPreviousIdx(currentIdx);
      setCurrentIdx((idx) => (idx + 1) % quotes.length);
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [quotes, currentIdx, paused]);

  useEffect(() => {
    if (previousIdx === null) return;
    const t = setTimeout(() => setPreviousIdx(null), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [previousIdx]);

  if (!quotes || quotes.length === 0) return null;

  return (
    <div
      className="relative mx-auto w-full max-w-2xl min-h-[6rem]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {previousIdx !== null && (
        <QuoteLayer
          key={`out-${previousIdx}`}
          quote={quotes[previousIdx]}
          phase="exit"
        />
      )}
      <QuoteLayer
        key={`in-${currentIdx}`}
        quote={quotes[currentIdx]}
        phase="enter"
      />
    </div>
  );
}

function QuoteLayer({ quote, phase }: { quote: Quote; phase: 'enter' | 'exit' }) {
  const [settled, setSettled] = useState(phase === 'exit');

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setSettled(phase === 'enter');
    });
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const offRight = 'translate-x-16 scale-90 opacity-0';
  const offLeft = '-translate-x-16 scale-90 opacity-0';
  const settledClasses = 'translate-x-0 scale-100 opacity-100';
  const target = settled ? settledClasses : phase === 'enter' ? offRight : offLeft;

  return (
    <figure
      aria-hidden={phase === 'exit'}
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center',
        'transition-all duration-500 ease-out',
        'motion-reduce:transition-opacity motion-reduce:transform-none',
        target
      )}
    >
      <blockquote className="max-w-xl text-base sm:text-lg italic text-muted-foreground leading-relaxed">
        {quote.author ? <>&ldquo;{quote.text}&rdquo;</> : quote.text}
      </blockquote>
      {quote.author && (
        <figcaption className="text-xs text-muted-foreground/70">
          &mdash; {quote.author}
        </figcaption>
      )}
    </figure>
  );
}
