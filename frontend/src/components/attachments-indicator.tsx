import { Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttachmentsIndicatorProps {
  /** Whether the entity references at least one file-class attachment. */
  hasAttachments: boolean;
  /** Extra classes for the wrapping span. */
  className?: string;
}

/**
 * Small paperclip icon shown beside titles of notes / decks / todo lists
 * that have at least one file-class attachment (PDF, spreadsheet, etc.)
 * referenced from their body. Mirrors the visual pattern of
 * `ShareIndicator` and `MissingMediaIndicator` but in the default
 * foreground color so it reads as informational rather than warning or
 * status-positive.
 *
 * Source of truth: the `field_has_attachments` boolean maintained by the
 * `media_functionality` module's presave hook.
 */
export function AttachmentsIndicator({
  hasAttachments,
  className,
}: AttachmentsIndicatorProps) {
  if (!hasAttachments) return null;
  return (
    <span
      title="Has file attachments"
      aria-label="Has file attachments"
      className={cn(
        'inline-flex shrink-0 items-center text-foreground/80',
        className,
      )}
    >
      <Paperclip className="h-3.5 w-3.5" />
    </span>
  );
}
