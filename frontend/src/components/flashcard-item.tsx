'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

interface FlashcardItemProps {
  card: JsonApiResource;
  index: number;
}

export function FlashcardItem({ card, index }: FlashcardItemProps) {
  const [flipped, setFlipped] = useState(false);

  const front = card.attributes.field_front as string;
  const back = card.attributes.field_back as string;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={flipped ? 'Showing answer — click to see question' : 'Showing question — click to see answer'}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFlipped((f) => !f)}
      className="group relative cursor-pointer select-none rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Card number */}
      <span className="absolute top-3 right-4 text-xs text-muted-foreground tabular-nums">
        #{index + 1}
      </span>

      {/* Side indicator */}
      <span
        className={cn(
          'mb-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
          flipped
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {flipped ? 'Answer' : 'Question'}
      </span>

      {/* Content */}
      <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
        {flipped ? back : front}
      </p>

      {/* Flip hint */}
      <p className="mt-3 text-[11px] text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
        Click to flip
      </p>
    </div>
  );
}
