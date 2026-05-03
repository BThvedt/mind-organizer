import { notFound } from 'next/navigation';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { fetchSharedNote } from '@/app/share/_lib/fetch-share';
import { LinkedItems } from '@/app/share/_components/linked-items';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const note = await fetchSharedNote(token);
  return {
    title: note?.title ?? 'Shared note',
  };
}

export default async function SharedNotePage({ params }: PageProps) {
  const { token } = await params;
  const note = await fetchSharedNote(token);
  if (!note) notFound();

  const body = note.body.trim();

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          {note.title}
        </h1>
        {(note.area || note.subject) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {note.area && <Badge variant="secondary">{note.area.name}</Badge>}
            {note.subject && <Badge variant="outline">{note.subject.name}</Badge>}
          </div>
        )}
        <LinkedItems links={note.links} className="mt-3" />
        <p className="mt-2 text-xs text-muted-foreground">Read-only shared view</p>
      </header>

      {body ? (
        <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
          <MarkdownRenderer>{body}</MarkdownRenderer>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">This note is empty.</p>
      )}
    </article>
  );
}
