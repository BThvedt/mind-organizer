'use client';

import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Strikethrough,
  TextQuote,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MarkdownEditorActions } from '@/hooks/use-markdown-editor';

interface MarkdownToolbarProps {
  actions: MarkdownEditorActions;
  /**
   * If provided, the Insert button opens the media/math picker dialog.
   * When omitted (e.g. on the new-note page where MediaInsertDialog
   * isn't mounted), the button renders disabled with a hint.
   */
  onOpenInsert?: () => void;
  disabled?: boolean;
  className?: string;
}

interface ToolButtonProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}

function ToolButton({ icon: Icon, label, shortcut, onClick, disabled }: ToolButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />;
}

/**
 * Formatting toolbar that sits above the markdown <textarea>. All
 * actions route through `useMarkdownEditor`'s shared edit helpers, so
 * a click here lands in the same undo step as the equivalent typed
 * shortcut (Ctrl/Cmd+B/I/K/E).
 *
 * The Insert button bridges to the existing `MediaInsertDialog` via
 * the `onOpenInsert` callback — when that's absent (the new-note page)
 * the button is rendered disabled with an explanatory title.
 */
export function MarkdownToolbar({
  actions,
  onOpenInsert,
  disabled = false,
  className,
}: MarkdownToolbarProps) {
  // Use platform-appropriate shortcut hints in the title attribute.
  const mod =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl';

  return (
    <div
      role="toolbar"
      aria-label="Markdown formatting"
      className={cn(
        'flex items-center gap-0.5 overflow-x-auto border-b border-border bg-background px-2 py-1.5',
        '[scrollbar-width:thin]',
        className,
      )}
    >
      <ToolButton
        icon={Bold}
        label="Bold"
        shortcut={`${mod}+B`}
        onClick={actions.toggleBold}
        disabled={disabled}
      />
      <ToolButton
        icon={Italic}
        label="Italic"
        shortcut={`${mod}+I`}
        onClick={actions.toggleItalic}
        disabled={disabled}
      />
      <ToolButton
        icon={Strikethrough}
        label="Strikethrough"
        onClick={actions.toggleStrikethrough}
        disabled={disabled}
      />
      <ToolButton
        icon={Code}
        label="Inline code"
        shortcut={`${mod}+E`}
        onClick={actions.toggleInlineCode}
        disabled={disabled}
      />

      <Sep />

      <ToolButton
        icon={Heading1}
        label="Heading 1"
        onClick={() => actions.setHeading(1)}
        disabled={disabled}
      />
      <ToolButton
        icon={Heading2}
        label="Heading 2"
        onClick={() => actions.setHeading(2)}
        disabled={disabled}
      />
      <ToolButton
        icon={Heading3}
        label="Heading 3"
        onClick={() => actions.setHeading(3)}
        disabled={disabled}
      />

      <Sep />

      <ToolButton
        icon={List}
        label="Bulleted list"
        onClick={actions.toggleBulletedList}
        disabled={disabled}
      />
      <ToolButton
        icon={ListOrdered}
        label="Numbered list"
        onClick={actions.toggleNumberedList}
        disabled={disabled}
      />
      <ToolButton
        icon={ListChecks}
        label="Task list"
        onClick={actions.toggleTaskList}
        disabled={disabled}
      />

      <Sep />

      <ToolButton
        icon={TextQuote}
        label="Blockquote"
        onClick={actions.toggleBlockquote}
        disabled={disabled}
      />
      <ToolButton
        icon={Code2}
        label="Code block"
        onClick={actions.insertCodeBlock}
        disabled={disabled}
      />
      <ToolButton
        icon={LinkIcon}
        label="Link"
        shortcut={`${mod}+K`}
        onClick={actions.insertLink}
        disabled={disabled}
      />
      <ToolButton
        icon={Minus}
        label="Horizontal rule"
        onClick={actions.insertHorizontalRule}
        disabled={disabled}
      />

      <Sep />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onOpenInsert}
        disabled={disabled || !onOpenInsert}
        aria-label="Insert media or math"
        title={
          onOpenInsert
            ? 'Insert image, audio, file, or math equation'
            : 'Save the note first to insert from your media library'
        }
      >
        <ImagePlus className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}
