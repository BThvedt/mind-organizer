'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';

const DISMISS_KEY = 'dashboard_quote_dismissed';

type Quote = {
  id: string;
  text: string;
  author: string | null;
  isTip: boolean;
};

export function DashboardQuote() {
  const [hidden, setHidden] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

    setHidden(false);

    const ac = new AbortController();
    fetch('/api/quotes/random', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { quote: null }))
      .then((data: { quote: Quote | null }) => {
        if (data.quote) setQuote(data.quote);
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setHidden(true);
  }

  if (hidden || !quote) return null;

  return (
    <figure className="relative mb-8 rounded-xl border border-border bg-muted/30 px-16 py-4 text-left">
      {quote.isTip && (
        <Lightbulb
          aria-label="Tip"
          className="absolute top-[1.125rem] left-[2.125rem] h-5 w-5 fill-amber-300 text-amber-500"
        />
      )}
      <blockquote className="text-sm sm:text-base italic text-muted-foreground leading-relaxed">
        {quote.isTip
          ? quote.text
          : quote.author
            ? <>&ldquo;{quote.text}&rdquo;</>
            : quote.text}
      </blockquote>
      {quote.author && (
        <figcaption className="mt-1 text-xs text-muted-foreground/70">
          &mdash; {quote.author}
        </figcaption>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss quote for this session"
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </figure>
  );
}
