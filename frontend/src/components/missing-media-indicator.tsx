import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MissingMediaIndicatorProps {
  /** Number of broken media references on the entity. Renders nothing if 0. */
  count: number;
  /** Tailwind size classes for the icon (defaults to h-3.5 w-3.5). */
  className?: string;
}

/**
 * Shows a small "broken image" icon when an entity references one or more
 * soft-deleted media assets. Hover/focus reveals a tooltip with the count.
 *
 * Source of truth: the `field_missing_media` multi-value string field on
 * each tracked node bundle (notes, flashcards, decks, todo lists), which
 * the Drupal media_functionality module recomputes on every save.
 */
export function MissingMediaIndicator({
  count,
  className,
}: MissingMediaIndicatorProps) {
  if (count <= 0) return null;
  const label =
    count === 1
      ? 'References 1 missing media file'
      : `References ${count} missing media files`;
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center text-destructive',
        className,
      )}
    >
      <ImageOff className="h-3.5 w-3.5" />
    </span>
  );
}
