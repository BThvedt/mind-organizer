'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { FolderMinus, ArrowLeft, Layers, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

interface ListResponse { data: JsonApiResource[] }

type ContentFilter = 'all' | 'decks' | 'notes';

function hasArea(resource: JsonApiResource): boolean {
  const rel = resource.relationships?.field_area?.data;
  return !!rel && !Array.isArray(rel) && !!(rel as { id: string }).id;
}

export default function UncategorizedPage() {
  const [decks, setDecks] = useState<JsonApiResource[]>([]);
  const [notes, setNotes] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  useEffect(() => {
    if (!authenticated) return;
    async function load() {
      setLoading(true);
      try {
        const [decksRes, notesRes] = await Promise.all([
          fetch('/api/decks'),
          fetch('/api/notes'),
        ]);
        if (decksRes.ok) {
          const data: ListResponse = await decksRes.json();
          setDecks((data.data ?? []).filter((d) => !hasArea(d)));
        }
        if (notesRes.ok) {
          const data: ListResponse = await notesRes.json();
          setNotes((data.data ?? []).filter((n) => !hasArea(n)));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authenticated]);

  const visibleDecks = contentFilter !== 'notes' ? decks : [];
  const visibleNotes = contentFilter !== 'decks' ? notes : [];
  const totalVisible = visibleDecks.length + visibleNotes.length;

  if (authenticated === null) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        authenticated={!!authenticated}
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={markSignedOut}
      />

      <main className="mx-auto max-w-3xl px-6 pt-24 pb-16 space-y-4">
        <Link
          href="/dashboard/areas"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Areas
        </Link>

        {loading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2.5 text-xl font-semibold">
                  <FolderMinus className="h-6 w-6 text-muted-foreground shrink-0" />
                  Uncategorized Content
                </span>
                <div className="flex items-center gap-1">
                  {(['all', 'decks', 'notes'] as ContentFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setContentFilter(f)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize',
                        contentFilter === f
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-2 pb-2">
              {totalVisible === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No {contentFilter === 'all' ? 'uncategorized content' : `uncategorized ${contentFilter}`} found.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {visibleDecks.map((deck) => (
                    <Link
                      key={deck.id}
                      href={`/dashboard/decks/${deck.id}`}
                      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50 transition-colors group"
                    >
                      <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{deck.attributes?.title as string}</span>
                      <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">Deck</span>
                    </Link>
                  ))}
                  {visibleNotes.map((note) => (
                    <Link
                      key={note.id}
                      href={`/dashboard/notes?id=${note.id}`}
                      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50 transition-colors group"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{note.attributes?.title as string}</span>
                      <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">Note</span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
