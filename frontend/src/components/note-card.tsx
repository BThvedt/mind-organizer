import Link from 'next/link';
import { FileText, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { JsonApiResource } from '@/lib/drupal';

interface NoteCardProps {
  note: JsonApiResource;
  included?: JsonApiResource[];
}

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

export function NoteCard({ note, included = [] }: NoteCardProps) {
  const title = note.attributes.title as string;
  const rawBody = (note.attributes.field_body as string | null) ?? '';
  const preview = stripMarkdown(rawBody).slice(0, 120);

  const areaRel = note.relationships?.field_area?.data;
  const subjectRel = note.relationships?.field_subject?.data;
  const linkedDecksRel = note.relationships?.field_linked_decks?.data;

  const areaId = areaRel && !Array.isArray(areaRel) ? areaRel.id : null;
  const subjectId = subjectRel && !Array.isArray(subjectRel) ? subjectRel.id : null;
  const linkedDeckCount = Array.isArray(linkedDecksRel) ? linkedDecksRel.length : 0;

  const areaName = areaId
    ? (included.find((r) => r.id === areaId)?.attributes.name as string | undefined)
    : undefined;
  const subjectName = subjectId
    ? (included.find((r) => r.id === subjectId)?.attributes.name as string | undefined)
    : undefined;

  return (
    <Link
      href={`/dashboard/notes/${note.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/50 hover:bg-card/80"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-foreground group-hover:text-primary transition-colors">
            {title}
          </h3>
          {preview && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{preview}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {areaName && (
          <Badge variant="secondary" className="text-xs">
            {areaName}
          </Badge>
        )}
        {subjectName && (
          <Badge variant="outline" className="text-xs">
            {subjectName}
          </Badge>
        )}
        {linkedDeckCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Layers className="h-3 w-3" />
            {linkedDeckCount} {linkedDeckCount === 1 ? 'deck' : 'decks'}
          </span>
        )}
      </div>
    </Link>
  );
}
