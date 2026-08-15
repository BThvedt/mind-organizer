'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Pencil, Layers, FileText, CheckSquare } from 'lucide-react';
import type { JsonApiResource } from '@/lib/json-api';
import { toRelArray, toRelIds } from '@/lib/json-api';

interface NoteResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
}

/**
 * Read-only, full-screen view of a single note — the authenticated
 * counterpart to `/share/note/[token]`, reached via the "expand" icon on
 * the notes list. Permission is enforced by `/api/notes/[id]`, which
 * requires auth and returns Drupal's 403/404 as-is when the note isn't the
 * signed-in user's own.
 */
export default function NoteFullScreenViewPage({
  params,
}: {
  params: Promise<{ noteid: string }>;
}) {
  const { noteid } = use(params);
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState<JsonApiResource | null>(null);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/notes/${noteid}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 403) {
          setNotFound(true);
          return;
        }
        if (res.ok) {
          const data: NoteResponse = await res.json();
          setNote(data.data);
          setIncluded(data.included ?? []);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [authenticated, noteid]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  if (!authenticated) return null;

  if (!loading && (notFound || !note)) {
    return (
      <>
        <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />
        <main className="mx-auto max-w-4xl px-6 pt-28 pb-16 text-center">
          <p className="text-lg font-semibold text-foreground">Note not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted or you don&apos;t have permission to view it.
          </p>
          <Button
            className="mt-6"
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/notes" />}
          >
            Back to notes
          </Button>
        </main>
      </>
    );
  }

  const areaIds = note ? toRelIds(note.relationships?.field_area?.data) : [];
  const subjectIds = note ? toRelIds(note.relationships?.field_subject?.data) : [];
  const areaTags = areaIds
    .map((id) => ({
      id,
      name: included.find((r) => r.id === id)?.attributes.name as string | undefined,
    }))
    .filter((x): x is { id: string; name: string } => !!x.name);
  const subjectTags = subjectIds
    .map((id) => ({
      id,
      name: included.find((r) => r.id === id)?.attributes.name as string | undefined,
    }))
    .filter((x): x is { id: string; name: string } => !!x.name);

  const linkedDecks = (toRelArray(note?.relationships?.field_linked_decks?.data)
    .map((rel) => included.find((r) => r.id === rel.id))
    .filter(Boolean) as JsonApiResource[]);
  const linkedNotes = (toRelArray(note?.relationships?.field_linked_notes?.data)
    .map((rel) => included.find((r) => r.id === rel.id))
    .filter(Boolean) as JsonApiResource[]);
  const linkedTodos = (toRelArray(note?.relationships?.field_linked_todos?.data)
    .map((rel) => included.find((r) => r.id === rel.id))
    .filter(Boolean) as JsonApiResource[]);

  const noteBody = (note?.attributes.field_body as string | null) ?? '';

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <div
        className="flex flex-col"
        style={{ height: 'calc(100dvh - 64px)', marginTop: 64 }}
      >
        <div className="border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
          <div className="mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={<Link href={`/dashboard/notes?id=${noteid}`} />}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to notes</span>
            </Button>

            {loading ? (
              <div className="flex-1 h-5 animate-pulse rounded bg-muted" />
            ) : (
              <h1 className="flex-1 truncate text-base font-medium text-foreground">
                {note?.attributes.title as string}
              </h1>
            )}

            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/dashboard/notes/${noteid}`} />}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-8">
            {loading ? (
              <div className="space-y-3">
                <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
              </div>
            ) : (
              <>
                <header className="mb-6">
                  <h2 className="text-2xl font-bold tracking-tight text-foreground leading-tight">
                    {note?.attributes.title as string}
                  </h2>
                  {(areaTags.length > 0 || subjectTags.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {areaTags.map((a) => (
                        <Badge key={a.id} variant="secondary">{a.name}</Badge>
                      ))}
                      {subjectTags.map((s) => (
                        <Badge key={s.id} variant="outline">{s.name}</Badge>
                      ))}
                    </div>
                  )}
                </header>

                {noteBody.trim() ? (
                  <article className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
                    <MarkdownRenderer>{noteBody}</MarkdownRenderer>
                  </article>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No content yet.</p>
                )}


                {linkedDecks.length > 0 && (
                  <section className="mt-12 pt-8 border-t border-border">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <Layers className="h-4 w-4" />
                      Linked decks
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {linkedDecks.map((deck) => (
                        <Link
                          key={deck.id}
                          href={`/dashboard/decks/${deck.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                        >
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          {deck.attributes.title as string}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {linkedNotes.length > 0 && (
                  <section className={`pt-8 border-t border-border ${linkedDecks.length > 0 ? 'mt-6' : 'mt-12'}`}>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <FileText className="h-4 w-4" />
                      Linked notes
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {linkedNotes.map((n) => (
                        <Link
                          key={n.id}
                          href={`/dashboard/notes/${n.id}/view`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                        >
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          {n.attributes.title as string}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}


                {linkedTodos.length > 0 && (
                  <section className={`pt-8 border-t border-border ${(linkedDecks.length > 0 || linkedNotes.length > 0) ? 'mt-6' : 'mt-12'}`}>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <CheckSquare className="h-4 w-4" />
                      Linked todos
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {linkedTodos.map((todo) => (
                        <Link
                          key={todo.id}
                          href={`/dashboard/todos?id=${todo.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                        >
                          <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          {todo.attributes.title as string}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}


