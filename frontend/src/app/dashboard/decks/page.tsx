'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { Header } from '@/components/header';
import { DeckCard } from '@/components/deck-card';
import { DeckCreateDialog } from '@/components/deck-create-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Layers, ArrowLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const [decks, setDecks] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

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
    markSignedOut();
    router.replace('/');
  }

  const uniqueAreas = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    decks.forEach((deck) => {
      const rel = deck.relationships?.field_area?.data;
      const id = rel && !Array.isArray(rel) ? rel.id : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        const name = included.find((r) => r.id === id)?.attributes.name as string | undefined;
        if (name) result.push({ id, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [decks, included]);

  const uniqueSubjectsForArea = useMemo(() => {
    if (!filterAreaId) return [];
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    decks.forEach((deck) => {
      const aRel = deck.relationships?.field_area?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      if (aId !== filterAreaId) return;
      const sRel = deck.relationships?.field_subject?.data;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (sId && !seen.has(sId)) {
        seen.add(sId);
        const name = included.find((r) => r.id === sId)?.attributes.name as string | undefined;
        if (name) result.push({ id: sId, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [decks, included, filterAreaId]);

  const visibleDecks = useMemo(() => {
    if (!filterAreaId && !filterSubjectId) return decks;
    return decks.filter((deck) => {
      const aRel = deck.relationships?.field_area?.data;
      const sRel = deck.relationships?.field_subject?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (filterAreaId && aId !== filterAreaId) return false;
      if (filterSubjectId && sId !== filterSubjectId) return false;
      return true;
    });
  }, [decks, filterAreaId, filterSubjectId]);

  const hasFilters = !!(filterAreaId || filterSubjectId);

  function clearFilters() {
    setFilterAreaId('');
    setFilterSubjectId('');
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
                {loading ? 'Loading…' : hasFilters
                  ? `${visibleDecks.length} of ${decks.length} deck${decks.length !== 1 ? 's' : ''}`
                  : `${decks.length} deck${decks.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <DeckCreateDialog onCreated={loadDecks} />
        </div>

        {/* Filter row */}
        {!loading && uniqueAreas.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Select
              value={filterAreaId || '__all__'}
              onValueChange={(v) => {
                setFilterAreaId(!v || v === '__all__' ? '' : v);
                setFilterSubjectId('');
              }}
            >
              <SelectTrigger className="h-8 w-auto min-w-32 text-sm">
                <span className={cn(!filterAreaId && 'text-muted-foreground')}>
                  {filterAreaId
                    ? (uniqueAreas.find((a) => a.id === filterAreaId)?.name ?? 'All areas')
                    : 'All areas'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All areas</SelectItem>
                {uniqueAreas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filterAreaId && (
              <Select
                value={filterSubjectId || '__all__'}
                onValueChange={(v) => setFilterSubjectId(!v || v === '__all__' ? '' : v)}
              >
                <SelectTrigger className="h-8 w-auto min-w-32 text-sm">
                  <span className={cn(!filterSubjectId && 'text-muted-foreground')}>
                    {filterSubjectId
                      ? (uniqueSubjectsForArea.find((s) => s.id === filterSubjectId)?.name ?? 'All subjects')
                      : 'All subjects'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All subjects</SelectItem>
                  {uniqueSubjectsForArea.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear filters
              </button>
            )}
          </div>
        )}

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
        ) : !loading && visibleDecks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
              <Layers className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">No decks match the selected filters</h2>
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
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
              : visibleDecks.map((deck) => (
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
