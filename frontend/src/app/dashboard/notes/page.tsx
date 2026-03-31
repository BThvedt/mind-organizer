'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/header';
import { NoteCard } from '@/components/note-card';
import { Button } from '@/components/ui/button';
import { FileText, ArrowLeft, Plus } from 'lucide-react';
import type { JsonApiResource } from '@/lib/drupal';

interface NoteListResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}

export default function NotesPage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data: NoteListResponse = await res.json();
        setNotes(data.data ?? []);
        setIncluded(data.included ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadNotes();
  }, [authenticated, loadNotes]);

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
              <h1 className="text-3xl font-bold tracking-tight text-foreground">My Notes</h1>
              <p className="mt-1 text-muted-foreground">
                {loading ? 'Loading…' : `${notes.length} note${notes.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <Button size="sm" nativeButton={false} render={<Link href="/dashboard/notes/new" />}>
            <Plus className="h-4 w-4" />
            New note
          </Button>
        </div>

        {!loading && notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">No notes yet</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              Write your first study note in Markdown to get started.
            </p>
            <Button className="mt-6" size="sm" nativeButton={false} render={<Link href="/dashboard/notes/new" />}>
              <Plus className="h-4 w-4" />
              New note
            </Button>
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
              : notes.map((note) => (
                  <NoteCard key={note.id} note={note} included={included} />
                ))}
          </div>
        )}
      </main>
    </>
  );
}
