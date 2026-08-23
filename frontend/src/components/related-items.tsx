'use client';

import Link from 'next/link';
import { FileText, Layers, CheckSquare, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LinkedItem {
  uuid: string;
  title: string;
  /** Bundle string: 'study_note' | 'flashcard_deck' | 'todo_list' */
  type: string;
}

interface RelatedItemsProps {
  /** Optional className for the outer wrapper. */
  className?: string;
  /**
   * Explicitly linked items to show. The component returns null when this
   * array is empty.
   */
  linkedItems?: LinkedItem[];
  /**
   * When provided, a pencil icon appears in the header that calls this
   * callback — typically used to open the Link dialog.
   */
  onEditLinks?: () => void;
  /**
   * When provided, each linked item gets an X button that calls this
   * callback with the item to remove.
   */
  onRemoveLinkedItem?: (item: LinkedItem) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bundleHref(item: LinkedItem): string {
  switch (item.type) {
    case 'study_note':
      return `/dashboard/notes/${item.uuid}`;
    case 'flashcard_deck':
      return `/dashboard/decks/${item.uuid}`;
    case 'todo_list':
      // The todos page renders its lists inline. There is no per-list URL
      // convention today, so we route to the index.
      return '/dashboard/todos';
    default:
      return '/dashboard';
  }
}

function bundleIcon(bundle: string) {
  switch (bundle) {
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

function bundleLabel(bundle: string): string {
  switch (bundle) {
    case 'study_note':
      return 'Note';
    case 'flashcard_deck':
      return 'Deck';
    case 'todo_list':
      return 'Todo';
    default:
      return '';
  }
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * "Linked items" panel.
 *
 * Renders the entities explicitly linked to the host entity (notes, decks,
 * todo lists) as a compact list. Deliberately performs no network requests —
 * AI suggestions live behind the Link dialog's AI tab instead, so browsing a
 * page never triggers background semantic-search traffic.
 */
export function RelatedItems({
  className,
  linkedItems,
  onEditLinks,
  onRemoveLinkedItem,
}: RelatedItemsProps) {
  const items = linkedItems ?? [];

  // Hide entirely when there's nothing to show.
  if (items.length === 0) return null;

  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Linked
        </h2>
        {onEditLinks && (
          <button
            onClick={onEditLinks}
            className={cn(
              'ml-auto flex h-5 w-5 items-center justify-center rounded transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
            aria-label="Edit linked items"
            type="button"
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
        )}
      </header>

      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.uuid} className="group flex items-center">
            <Link
              href={bundleHref(item)}
              className="flex min-w-0 flex-1 items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
            >
              <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                {bundleIcon(item.type)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{item.title}</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground">
                  {bundleLabel(item.type)}
                </span>
              </span>
            </Link>
            {onRemoveLinkedItem && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveLinkedItem(item); }}
                className="mr-3 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label={`Remove link to ${item.title}`}
                type="button"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
