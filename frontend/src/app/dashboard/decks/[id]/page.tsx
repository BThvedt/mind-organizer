'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
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
import { AiGenerateDialog } from '@/components/ai-generate-dialog';
import { LinkNotesDialog } from '@/components/link-notes-dialog';

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

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Add card form state
  const [showForm, setShowForm] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const authenticated = useAuth();

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
    }
  }, [authenticated, loadData, loadLinkedNotes]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim() || !back.trim()) {
      setFormError('Both front and back are required.');
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
        const data = await res.json();
        setFormError(data.error ?? 'Failed to save card.');
        return;
      }

      const created = await res.json();
      setCards((prev) => [created.data, ...prev]);
      setFront('');
      setBack('');
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
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/decks/${id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        router.push('/dashboard/decks');
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  if (!authenticated) return null;

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
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden sm:inline">Delete this deck?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Confirm'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                    Cancel
                  </Button>
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
                    <AiGenerateDialog deckId={id} onSaved={loadData} />
                    <LinkNotesDialog
                      deckId={id}
                      deckAreaUuid={areaId ?? ''}
                      deckSubjectUuid={subjectId ?? ''}
                      onLinksChanged={loadLinkedNotes}
                      initialLinkedNoteIds={linkedNoteIds}
                    />
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
                      onClick={() => setDeleteConfirm(true)}
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
                  placeholder="It is…"
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={saving}>
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
                    onUpdated={(updated) =>
                      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                    }
                    onDeleted={(cardId) =>
                      setCards((prev) => prev.filter((c) => c.id !== cardId))
                    }
                  />
                ))}
          </div>
        )}

      </main>
    </>
  );
}
