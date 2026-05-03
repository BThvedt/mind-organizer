'use client';

import { useEffect, useLayoutEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { FlashcardItem } from '@/components/flashcard-item';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, X, Brain, Play, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  MUTATION_QUEUED_MESSAGE,
  OFFLINE_ACTION_MESSAGE,
  messageWhenNetworkRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';
import { AiGenerateDialog } from '@/components/ai-generate-dialog';
import { LinkNotesDialog } from '@/components/link-notes-dialog';
import { LinkRelatedDecksDialog } from '@/components/link-related-decks-dialog';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { ShareButton } from '@/components/share/share-button';

const ADD_CARD_BOTH_REQUIRED_MSG = 'Both front and back are required.';

interface DeckResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
}

interface CardsResponse {
  data: JsonApiResource[];
}

interface LinkedNotesResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}

export default function DeckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [deck, setDeck] = useState<JsonApiResource | null>(null);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [cards, setCards] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkedNoteIds, setLinkedNoteIds] = useState<string[]>([]);
  const [linkedDeckIds, setLinkedDeckIds] = useState<string[]>([]);

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Add card form state
  const [showForm, setShowForm] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  /** Which add-card textarea is focused — used to hide validation while typing in an empty field. */
  const [addCardFocusedField, setAddCardFocusedField] = useState<
    'front' | 'back' | null
  >(null);

  const [dirtyEditCardIds, setDirtyEditCardIds] = useState<Set<string>>(new Set());

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const { isOnline } = useOnlineStatus();

  const reportCardEditDirty = useCallback((cardId: string, dirty: boolean) => {
    setDirtyEditCardIds((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  }, []);

  const loadLinkedNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/decks/${id}/notes`);
      if (res.ok) {
        const d: LinkedNotesResponse = await res.json();
        setLinkedNoteIds((d.data ?? []).map((n: JsonApiResource) => n.id as string));
      }
    } catch {
      // non-critical
    }
  }, [id]);

  const loadLinkedDecks = useCallback(async () => {
    try {
      const res = await fetch(`/api/decks/${id}/linked-decks`);
      if (res.ok) {
        const d = await res.json();
        setLinkedDeckIds((d.data ?? []).map((deck: JsonApiResource) => deck.id as string));
      }
    } catch {
      // non-critical
    }
  }, [id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [deckRes, cardsRes] = await Promise.all([
        fetch(`/api/decks/${id}`),
        fetch(`/api/decks/${id}/cards`),
      ]);

      if (deckRes.ok) {
        const d: DeckResponse = await deckRes.json();
        setDeck(d.data);
        setIncluded(d.included ?? []);
      }
      if (cardsRes.ok) {
        const c: CardsResponse = await cardsRes.json();
        setCards(c.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authenticated) {
      loadData();
      loadLinkedNotes();
      loadLinkedDecks();
    }
  }, [authenticated, loadData, loadLinkedNotes, loadLinkedDecks]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim() || !back.trim()) {
      setFormError(ADD_CARD_BOTH_REQUIRED_MSG);
      return;
    }
    setSaving(true);
    setFormError('');

    try {
      const res = await fetch(`/api/decks/${id}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: front.trim(), back: back.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(
          userFacingMessageForApiError(res, data, 'Failed to save card.')
        );
        return;
      }

      const created = await res.json();
      setCards((prev) => [created.data, ...prev]);
      setFront('');
      setBack('');
      setAddCardFocusedField(null);
      setShowForm(false);
    } catch {
      setFormError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  function handleCancelForm() {
    setShowForm(false);
    setFront('');
    setBack('');
    setFormError('');
    setAddCardFocusedField(null);
  }

  function handleAddCardFieldBlur() {
    if (!front.trim() || !back.trim()) {
      setFormError(ADD_CARD_BOTH_REQUIRED_MSG);
    } else {
      setFormError((prev) =>
        prev === ADD_CARD_BOTH_REQUIRED_MSG ? '' : prev
      );
    }
  }

  function handleAddCardFrontBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const next = e.relatedTarget as HTMLElement | null;
    if (next?.id === 'card-back') {
      setAddCardFocusedField('back');
      return;
    }
    setAddCardFocusedField(null);
    handleAddCardFieldBlur();
  }

  function handleAddCardBackBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const next = e.relatedTarget as HTMLElement | null;
    if (next?.id === 'card-front') {
      setAddCardFocusedField('front');
      return;
    }
    setAddCardFocusedField(null);
    handleAddCardFieldBlur();
  }

  useLayoutEffect(() => {
    if (
      formError === ADD_CARD_BOTH_REQUIRED_MSG &&
      front.trim() &&
      back.trim()
    ) {
      setFormError('');
    }
  }, [front, back, formError]);

  async function handleDelete() {
    setDeleteError('');
    if (!isOnline) {
      setDeleteError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/decks/${id}`, { method: 'DELETE' });
      if (res.status === 202) {
        const data = await res.json().catch(() => ({}));
        if ((data as { queued?: boolean }).queued) {
          setDeleteError(MUTATION_QUEUED_MESSAGE);
          return;
        }
        setDeleteError('Unexpected response. Please try again.');
        return;
      }
      if (res.status === 204) {
        setDeleteConfirm(false);
        setDeleteError('');
        router.push('/dashboard/decks');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setDeleteError(
        userFacingMessageForApiError(res, data, 'Failed to delete deck.')
      );
    } catch {
      setDeleteError(messageWhenNetworkRequestThrows());
    } finally {
      setDeleting(false);
    }
  }

  if (!authenticated) return null;

  const addCardFormDirty =
    showForm && (front.trim() !== '' || back.trim() !== '');
  const isDirty = addCardFormDirty || dirtyEditCardIds.size > 0;

  /**
   * Show add-card form error line. Validation message is hidden while focus is in a field OR
   * when both sides are non-empty (avoids one-frame flash before formError state clears).
   */
  const showAddCardFormError =
    Boolean(formError) &&
    (formError !== ADD_CARD_BOTH_REQUIRED_MSG ||
      Boolean(
        (!front.trim() || !back.trim()) && addCardFocusedField === null
      ));

  // Resolve area / subject names from included
  const areaRel = deck?.relationships?.field_area?.data;
  const subjectRel = deck?.relationships?.field_subject?.data;
  const areaId = areaRel && !Array.isArray(areaRel) ? areaRel.id : null;
  const subjectId = subjectRel && !Array.isArray(subjectRel) ? subjectRel.id : null;
  const areaName = areaId
    ? (included.find((r) => r.id === areaId)?.attributes.name as string | undefined)
    : undefined;
  const subjectName = subjectId
    ? (included.find((r) => r.id === subjectId)?.attributes.name as string | undefined)
    : undefined;
  const description =
    (deck?.attributes.body as { value?: string } | null)?.value ?? '';

  return (
    <>
      <UnsavedChangesGuard isDirty={isDirty} />
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <main className="mx-auto max-w-4xl px-6 pt-28 pb-16">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
            {/* Left: back + title + meta */}
            <div className="flex items-start gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                render={<Link href="/dashboard/decks" />}
                className="mt-0.5 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to decks</span>
              </Button>

              <div className="min-w-0">
                {loading || !deck ? (
                  <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground truncate">
                      {deck.attributes.title as string}
                    </h1>
                    {(areaName || subjectName) && (
                      <div className="flex flex-wrap items-center gap-1.5 sm:ml-3">
                        {areaName && <Badge variant="secondary">{areaName}</Badge>}
                        {subjectName && <Badge variant="outline">{subjectName}</Badge>}
                      </div>
                    )}
                  </div>
                )}

                {description && (
                  <p className="mt-2 text-sm text-muted-foreground max-w-prose">{description}</p>
                )}
              </div>
            </div>

            {/* Right: button rows */}
            <div className="shrink-0 pl-9 sm:pl-0">
              {deleteConfirm ? (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground hidden sm:inline">
                      Delete this deck?
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting…' : 'Confirm'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteConfirm(false);
                        setDeleteError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {deleteError && (
                    <p className="text-sm text-destructive text-right max-w-xs">
                      {deleteError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-start sm:items-end gap-2">
                  {/* Row 1: primary actions */}
                  <div className="flex items-center gap-2">
                    {!loading && cards.length > 0 && (
                      <Button
                        nativeButton={false}
                        render={<Link href={`/dashboard/decks/${id}/study`} />}
                        size="sm"
                      >
                        <Play className="h-4 w-4" />
                        Study this deck
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowForm((s) => !s)}
                    >
                      {showForm ? (
                        <>
                          <X className="h-4 w-4" />
                          Cancel
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Add card
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Row 2: tools + management */}
                  <div className="flex items-center gap-2">
                    <AiGenerateDialog
                      deckId={id}
                      onSaved={loadData}
                      existingCards={cards.map((c) => ({
                        front: (c.attributes.field_front as string) ?? '',
                        back: (c.attributes.field_back as string) ?? '',
                      }))}
                    />
                    <LinkNotesDialog
                      deckId={id}
                      deckAreaUuid={areaId ?? ''}
                      deckSubjectUuid={subjectId ?? ''}
                      onLinksChanged={loadLinkedNotes}
                      initialLinkedNoteIds={linkedNoteIds}
                    />
                    <LinkRelatedDecksDialog
                      deckId={id}
                      deckAreaUuid={areaId ?? ''}
                      deckSubjectUuid={subjectId ?? ''}
                      onLinksChanged={loadLinkedDecks}
                      initialLinkedDeckIds={linkedDeckIds}
                    />
                    {deck && (
                      <ShareButton
                        type="flashcard_deck"
                        nodeUuid={id}
                        isShared={Boolean(deck.attributes.field_is_shared)}
                        shareToken={(deck.attributes.field_share_token as string | null) ?? null}
                        onChange={({ isShared, shareToken }) =>
                          setDeck((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  attributes: {
                                    ...prev.attributes,
                                    field_is_shared: isShared,
                                    field_share_token: shareToken,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/dashboard/decks/${id}/edit`} />}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setDeleteError('');
                        setDeleteConfirm(true);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete deck</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inline add card form */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-200',
            showForm ? 'max-h-96 opacity-100 mb-8' : 'max-h-0 opacity-0'
          )}
        >
          <form
            onSubmit={handleAddCard}
            className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4"
          >
            <h2 className="font-semibold text-foreground">New card</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="card-front">Front (question)</Label>
                <Textarea
                  id="card-front"
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  onFocus={() => setAddCardFocusedField('front')}
                  onBlur={handleAddCardFrontBlur}
                  placeholder="What is…?"
                  rows={4}
                  className="resize-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="card-back">Back (answer)</Label>
                <Textarea
                  id="card-back"
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  onFocus={() => setAddCardFocusedField('back')}
                  onBlur={handleAddCardBackBlur}
                  placeholder="It is…"
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>

            {showAddCardFormError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={saving || !front.trim() || !back.trim()}
              >
                {saving ? 'Saving…' : 'Save card'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelForm}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>

        {/* Cards section */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {loading
              ? 'Cards'
              : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`}
          </h2>
        </div>

        {!loading && cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground">No cards yet</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              Add your first card using the button above.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-36 animate-pulse rounded-xl border border-border bg-card"
                  />
                ))
              : cards.map((card, i) => (
                  <FlashcardItem
                    key={card.id}
                    card={card}
                    index={i}
                    onEditDirtyChange={reportCardEditDirty}
                    onUpdated={(updated) =>
                      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                    }
                    onDeleted={(cardId) => {
                      setCards((prev) => prev.filter((c) => c.id !== cardId));
                      setDirtyEditCardIds((prev) => {
                        if (!prev.has(cardId)) return prev;
                        const next = new Set(prev);
                        next.delete(cardId);
                        return next;
                      });
                    }}
                  />
                ))}
          </div>
        )}

      </main>
    </>
  );
}
