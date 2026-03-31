'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { DeckCard } from '@/components/deck-card';
import { DeckCreateDialog } from '@/components/deck-create-dialog';
import { Button } from '@/components/ui/button';
import { Layers, ArrowLeft } from 'lucide-react';
import type { JsonApiResource } from '@/lib/drupal';
import Link from 'next/link';

interface DeckListResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}

interface CardsResponse {
  data: JsonApiResource[];
}

export default function DecksPage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [decks, setDecks] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

  const loadDecks = useCallback(async () => {
    setLoading(true);
    try {
      const [decksRes, cardsRes] = await Promise.all([
        fetch('/api/decks'),
        fetch('/api/cards'),
      ]);

      if (decksRes.ok) {
        const data: DeckListResponse = await decksRes.json();
        setDecks(data.data ?? []);
        setIncluded(data.included ?? []);
      }

      if (cardsRes.ok) {
        const cardsData: CardsResponse = await cardsRes.json();
        const counts: Record<string, number> = {};
        for (const card of cardsData.data ?? []) {
          const deckRel = card.relationships?.field_deck?.data;
          const deckId =
            deckRel && !Array.isArray(deckRel) ? (deckRel as { id: string }).id : null;
          if (deckId) counts[deckId] = (counts[deckId] ?? 0) + 1;
        }
        setCardCounts(counts);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadDecks();
  }, [authenticated, loadDecks]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  if (!authenticated) return null;

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <main className="mx-auto max-w-6xl px-6 pt-28 pb-16">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/dashboard" />}>
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to dashboard</span>
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">My Decks</h1>
              <p className="mt-1 text-muted-foreground">
                {loading ? 'Loading…' : `${decks.length} deck${decks.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <DeckCreateDialog onCreated={loadDecks} />
        </div>

        {!loading && decks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
              <Layers className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">No decks yet</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              Create your first deck to start organising your flashcards.
            </p>
            <div className="mt-6">
              <DeckCreateDialog onCreated={loadDecks} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-32 animate-pulse rounded-xl border border-border bg-card"
                  />
                ))
              : decks.map((deck) => (
                  <DeckCard
                    key={deck.id}
                    deck={deck}
                    included={included}
                    cardCount={cardCounts[deck.id] ?? 0}
                  />
                ))}
          </div>
        )}
      </main>
    </>
  );
}
