'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  MUTATION_QUEUED_MESSAGE,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import type { JsonApiResource } from '@/lib/json-api';
import { toStringArray } from '@/lib/json-api';
import { MissingMediaIndicator } from '@/components/missing-media-indicator';

interface FlashcardItemProps {
  card: JsonApiResource;
  index: number;
  onUpdated?: (card: JsonApiResource) => void;
  onDeleted?: (cardId: string) => void;
  /** Fired while inline edit mode is open when text differs from saved values. */
  onEditDirtyChange?: (cardId: string, dirty: boolean) => void;
}

export function FlashcardItem({
  card,
  index,
  onUpdated,
  onDeleted,
  onEditDirtyChange,
}: FlashcardItemProps) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [mutationError, setMutationError] = useState('');
  const frontRef = useRef<HTMLTextAreaElement>(null);

  const front = card.attributes.field_front as string;
  const back = card.attributes.field_back as string;
  const missingMediaCount = toStringArray(card.attributes.field_missing_media).length;

  const draftRef = useRef({
    editFront: '',
    editBack: '',
    front: '',
    back: '',
    editing: false,
    saving: false,
  });
  draftRef.current = {
    editFront,
    editBack,
    front: front ?? '',
    back: back ?? '',
    editing,
    saving,
  };

  const persistEdit = useCallback(
    async (opts: { closeAfter: boolean; requireDirty: boolean }) => {
      const d = draftRef.current;
      if (!d.editing || d.saving) return;

      const tFront = d.editFront.trim();
      const tBack = d.editBack.trim();
      if (!tFront || !tBack) return;

      const dirty =
        tFront !== (d.front ?? '').trim() || tBack !== (d.back ?? '').trim();
      if (opts.requireDirty && !dirty) return;

      setSaving(true);
      setMutationError('');
      try {
        const res = await fetch(`/api/cards/${card.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: tFront, back: tBack }),
        });
        if (res.ok) {
          const data = await res.json();
          onUpdated?.(data.data);
          if (opts.closeAfter) setEditing(false);
        } else {
          const data = await res.json().catch(() => ({}));
          setMutationError(
            userFacingMessageForApiError(res, data, 'Failed to save card.')
          );
        }
      } finally {
        setSaving(false);
      }
    },
    [card.id, onUpdated],
  );

  const persistEditRef = useRef(persistEdit);
  persistEditRef.current = persistEdit;

  useEffect(() => {
    if (!editing) return;
    const id = window.setInterval(() => {
      void persistEditRef.current({ closeAfter: false, requireDirty: true });
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [editing]);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setEditFront(front);
    setEditBack(back);
    setEditing(true);
    setDeleteConfirm(false);
    setMutationError('');
  }

  function cancelEditing() {
    setEditing(false);
    setMutationError('');
  }

  useEffect(() => {
    if (editing) frontRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!onEditDirtyChange) return;
    const id = card.id as string;
    if (!editing) {
      onEditDirtyChange(id, false);
      return;
    }
    const dirty =
      editFront.trim() !== (front ?? '').trim() ||
      editBack.trim() !== (back ?? '').trim();
    onEditDirtyChange(id, dirty);
  }, [editing, editFront, editBack, front, back, card.id, onEditDirtyChange]);

  function saveEdit(e: React.MouseEvent | React.FormEvent) {
    e.stopPropagation();
    e.preventDefault();
    void persistEdit({ closeAfter: true, requireDirty: false });
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleting(true);
    setMutationError('');
    try {
      const res = await fetch(`/api/cards/${card.id}`, { method: 'DELETE' });
      if (res.status === 202) {
        const data = await res.json().catch(() => ({}));
        if ((data as { queued?: boolean }).queued) {
          setMutationError(MUTATION_QUEUED_MESSAGE);
        } else {
          setMutationError('Unexpected response. Please try again.');
        }
      } else if (res.status === 204) {
        onDeleted?.(card.id);
      } else {
        const data = await res.json().catch(() => ({}));
        setMutationError(
          userFacingMessageForApiError(res, data, 'Failed to delete card.')
        );
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  function cancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteConfirm(false);
  }

  if (editing) {
    const cardDirty =
      editFront.trim() !== (front ?? '').trim() ||
      editBack.trim() !== (back ?? '').trim();

    return (
      <div className="rounded-xl border border-ring bg-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Editing card #{index + 1}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Front</label>
          <textarea
            ref={frontRef}
            value={editFront}
            onChange={(e) => setEditFront(e.target.value)}
            rows={3}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Back</label>
          <textarea
            value={editBack}
            onChange={(e) => setEditBack(e.target.value)}
            rows={3}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {(!editFront.trim() || !editBack.trim()) && (
          <p className="text-sm text-destructive">Both front and back are required.</p>
        )}

        {mutationError && (
          <p className="text-xs text-destructive">{mutationError}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={saveEdit}
            disabled={
              saving || !editFront.trim() || !editBack.trim() || !cardDirty
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Check className="h-3 w-3" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={cancelEditing}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={flipped ? 'Showing answer — click to see question' : 'Showing question — click to see answer'}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFlipped((f) => !f)}
      className="group relative cursor-pointer select-none rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Action buttons — top-right */}
      <div className="absolute top-3 right-4 flex items-center gap-1">
        {deleteConfirm ? (
          <>
            <span className="text-[11px] text-destructive mr-1">Delete?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md p-1 text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Confirm delete"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={cancelDelete}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Cancel delete"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <MissingMediaIndicator count={missingMediaCount} className="mr-0.5" />
            <span className="text-xs text-muted-foreground tabular-nums mr-1">
              #{index + 1}
            </span>
            <button
              onClick={startEditing}
              className="rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all"
              aria-label="Edit card"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMutationError('');
                setDeleteConfirm(true);
              }}
              className="rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
              aria-label="Delete card"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

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
      <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap pr-16">
        {flipped ? back : front}
      </p>

      {/* Flip hint */}
      <p className="mt-3 text-[11px] text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
        Click to flip
      </p>

      {mutationError && (
        <p className="mt-2 text-xs text-destructive pr-16">{mutationError}</p>
      )}
    </div>
  );
}
