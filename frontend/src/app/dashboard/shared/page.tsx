'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, FileText, Layers, CheckSquare, ExternalLink, Share2, Loader2 } from 'lucide-react';

interface SharedItem {
  id: string;
  attributes: {
    title: string;
    field_share_token: string | null;
    changed?: string;
    created?: string;
  };
}

interface SharedData {
  notes: SharedItem[];
  decks: SharedItem[];
  todos: SharedItem[];
}

function SharedItemChip({
  item,
  sharePathSegment,
  editHref,
  icon,
}: {
  item: SharedItem;
  sharePathSegment: string;
  editHref: string;
  icon: React.ReactNode;
}) {
  const token = item.attributes.field_share_token;
  return (
    <span className="inline-flex items-center rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80 overflow-hidden">
      <Link
        href={editHref}
        className="inline-flex items-center gap-1.5 px-3 py-1.5"
      >
        <span className="text-muted-foreground">{icon}</span>
        {item.attributes.title}
      </Link>
      {token && (
        <Link
          href={`/share/${sharePathSegment}/${token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center px-2.5 py-1.5 border-l border-border text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Open shared link for ${item.attributes.title}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
    </span>
  );
}

function Section({
  title,
  icon,
  items,
  sharePathSegment,
  editBasePath,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  items: SharedItem[];
  sharePathSegment: string;
  editBasePath: string;
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
        {icon}
        {title}
      </h2>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <SharedItemChip
              key={item.id}
              item={item}
              sharePathSegment={sharePathSegment}
              editHref={`${editBasePath}/${item.id}`}
              icon={icon}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function SharedPage() {
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;

    fetch('/api/shared')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load shared content');
        return res.json() as Promise<SharedData>;
      })
      .then((json) => setData(json))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authenticated]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  if (!authenticated) return null;

  const totalShared = data ? data.notes.length + data.decks.length + data.todos.length : 0;

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-4xl px-6 pt-28 pb-16">
        {/* Page header */}
        <div className="mb-8 flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className="mt-1"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <div className="flex-1">
            <div className="flex items-start gap-2">
              <Share2 className="mt-1 h-7 w-7 text-primary shrink-0" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Shared</h1>
                <p className="mt-1 text-muted-foreground">
                  Content you&apos;ve enabled sharing for. Anyone with the link can view these.
                </p>
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading shared content…</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-10">
            <Section
              title="Notes"
              icon={<FileText className="h-4 w-4" />}
              items={data.notes}
              sharePathSegment="note"
              editBasePath="/dashboard/notes"
              emptyText="No shared notes yet. Open a note and enable sharing to get a link."
            />
            <Section
              title="Decks"
              icon={<Layers className="h-4 w-4" />}
              items={data.decks}
              sharePathSegment="deck"
              editBasePath="/dashboard/decks"
              emptyText="No shared decks yet. Open a deck and enable sharing to get a link."
            />
            <Section
              title="Todo Lists"
              icon={<CheckSquare className="h-4 w-4" />}
              items={data.todos}
              sharePathSegment="todo"
              editBasePath="/dashboard/todos"
              emptyText="No shared todo lists yet. Open a todo list and enable sharing to get a link."
            />
          </div>
        )}

        {!loading && data && totalShared === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-border bg-card/50 px-8 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
              <Share2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">Nothing shared yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Open a note, deck, or todo list and use the share button to generate a public link.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
