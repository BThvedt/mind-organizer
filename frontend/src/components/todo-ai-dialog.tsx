'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sparkles, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface TodoAiDialogProps {
  todoId: string;
  /** Current value of the todo_lists field_include_in_rag attribute. */
  includeInRag: boolean;
  /** Called after the new value is successfully persisted. */
  onIncludeInRagChange: (next: boolean) => void;
}

/**
 * AI dialog for todo lists.
 *
 * Today this dialog only exposes the include-in-RAG toggle — todo lists
 * dont yet have any AI actions of their own. Wrapping the single setting
 * in a dedicated dialog mirrors the AI button pattern used on notes and
 * decks and gives us a single home for future AI-powered todo features.
 */
export function TodoAiDialog({
  todoId,
  includeInRag,
  onIncludeInRagChange,
}: TodoAiDialogProps) {
  const { isOnline } = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleToggle(next: boolean) {
    // Optimistic update — flip parent state immediately, revert on failure.
    onIncludeInRagChange(next);
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeInRag: next }),
      });
      if (!res.ok) {
        onIncludeInRagChange(!next);
        setError('Could not save AI Q&A preference. Please try again.');
      }
    } catch {
      onIncludeInRagChange(!next);
      setError('Could not save AI Q&A preference. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError('');
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            title={
              isOnline
                ? undefined
                : 'You can open AI Actions, but running them needs a connection and a signed-in session.'
            }
          >
            {isOnline ? <Sparkles className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            AI
          </Button>
        }
      />

      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Actions
            </DialogTitle>
          </DialogHeader>

          {/* The body of this modal is intentionally just the include-in-RAG
              toggle for now — todo lists dont have any AI actions yet.
              When we add more, this becomes the action menu and the toggle
              graduates to the footer (matching notes/decks). */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="todo-include-in-rag"
              checked={includeInRag}
              onCheckedChange={(v) => handleToggle(v === true)}
              disabled={saving}
            />
            <Label
              htmlFor="todo-include-in-rag"
              className="text-sm cursor-pointer select-none"
              title={error || undefined}
            >
              Include in AI Q&A
            </Label>
            {error && (
              <span className="text-xs text-destructive">{error}</span>
            )}
          </div>

          <DialogFooter showCloseButton />
        </div>
      </DialogContent>
    </Dialog>
  );
}
