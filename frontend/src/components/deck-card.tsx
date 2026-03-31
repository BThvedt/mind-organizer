import Link from 'next/link';
import { Layers, BookOpen, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { JsonApiResource } from '@/lib/drupal';

interface DeckCardProps {
  deck: JsonApiResource;
  included?: JsonApiResource[];
  cardCount?: number;
}

export function DeckCard({ deck, included = [], cardCount = 0 }: DeckCardProps) {
  const title = deck.attributes.title as string;
  const description = (deck.attributes.body as { value?: string } | null)?.value ?? '';

  const areaRel = deck.relationships?.field_area?.data;
  const subjectRel = deck.relationships?.field_subject?.data;

  const areaId = areaRel && !Array.isArray(areaRel) ? areaRel.id : null;
  const subjectId = subjectRel && !Array.isArray(subjectRel) ? subjectRel.id : null;

  const areaName = areaId
    ? (included.find((r) => r.id === areaId)?.attributes.name as string | undefined)
    : undefined;
  const subjectName = subjectId
    ? (included.find((r) => r.id === subjectId)?.attributes.name as string | undefined)
    : undefined;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/50">
      {/* Header — clicking the title/icon area navigates to deck detail */}
      <Link href={`/dashboard/decks/${deck.id}`} className="group flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Layers className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-foreground group-hover:text-primary transition-colors">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </Link>

      {/* Taxonomy badges */}
      {(areaName || subjectName) && (
        <div className="flex flex-wrap gap-1.5">
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
        </div>
      )}

      {/* Footer — card count + actions */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="text-xs text-muted-foreground">
          {cardCount} {cardCount === 1 ? 'card' : 'cards'}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={`/dashboard/decks/${deck.id}/edit`} />}
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
          {cardCount > 0 && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={`/dashboard/decks/${deck.id}/study`} />}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <BookOpen className="h-3 w-3" />
              Study
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
