import { Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ShareIndicatorProps {
  /** Whether the entity has an active public share link. Renders nothing if false. */
  shared: boolean;
  /** Extra classes for the wrapping span. */
  className?: string;
}

/**
 * Small green share icon shown beside titles of notes / decks / todo lists
 * that currently have a public share link enabled. Mirrors the visual
 * pattern of `MissingMediaIndicator`.
 *
 * Source of truth: the `field_is_shared` boolean on each shareable bundle,
 * managed by the `study_share` module.
 */
export function ShareIndicator({ shared, className }: ShareIndicatorProps) {
  if (!shared) return null;
  return (
    <span
      title="Shared via public link"
      aria-label="Shared via public link"
      className={cn(
        'inline-flex shrink-0 items-center text-emerald-600 dark:text-emerald-500',
        className,
      )}
    >
      <Share2 className="h-3.5 w-3.5" />
    </span>
  );
}
