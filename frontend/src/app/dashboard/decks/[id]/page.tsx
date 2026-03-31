'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/header';
import { FlashcardItem } from '@/components/flashcard-item';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, X, Brain, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';
import { AiGenerateDialog } from '@/components/ai-generate-dialog';

interface DeckResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
}

interface CardsResponse {
  data: JsonApiResource[];
}

export default function DeckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [deck, setDeck] = useState<JsonApiResource | null>(null);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [cards, setCards] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);

  // Add card form state
  const [showForm, setShowForm] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

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
    if (authenticated) loadData();
  }, [authenticated, loadData]);

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
          <div className="flex items-start justify-between gap-4 mb-3">
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
                  <h1 className="text-3xl font-bold tracking-tight text-foreground truncate">
                    {deck.attributes.title as string}
                  </h1>
                )}

                {(areaName || subjectName) && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {areaName && <Badge variant="secondary">{areaName}</Badge>}
                    {subjectName && <Badge variant="outline">{subjectName}</Badge>}
                  </div>
                )}

                {description && (
                  <p className="mt-2 text-sm text-muted-foreground max-w-prose">{description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {cards.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/dashboard/decks/${id}/study`} />}
                >
                  <Play className="h-4 w-4" />
                  Study
                </Button>
              )}
              <AiGenerateDialog deckId={id} onSaved={loadData} />
              <Button
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
                  <FlashcardItem key={card.id} card={card} index={i} />
                ))}
          </div>
        )}
      </main>
    </>
  );
}
