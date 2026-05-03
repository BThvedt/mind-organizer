import { ExternalLink, FileText, Layers, ListChecks } from 'lucide-react';
import type { SharedLink } from '@/app/share/_lib/fetch-share';

const TYPE_META: Record<
  SharedLink['type'],
  { segment: string; icon: typeof FileText; label: string }
> = {
  note: { segment: 'note', icon: FileText, label: 'Note' },
  deck: { segment: 'deck', icon: Layers, label: 'Deck' },
  todo: { segment: 'todo', icon: ListChecks, label: 'Todo list' },
};

interface LinkedItemsProps {
  links: SharedLink[];
  className?: string;
}

export function LinkedItems({ links, className }: LinkedItemsProps) {
  if (!links || links.length === 0) return null;

  return (
    <section
      aria-label="Linked items"
      className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Linked items
      </p>
      <ul className="flex flex-wrap items-center gap-1.5">
        {links.map((link) => {
          const meta = TYPE_META[link.type];
          const Icon = meta.icon;
          return (
            <li key={`${link.type}-${link.token}`}>
              <a
                href={`/share/${meta.segment}/${link.token}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${meta.label.toLowerCase()} in a new tab`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground hover:border-foreground/40 hover:bg-muted transition-colors"
              >
                <Icon className="h-3 w-3 text-muted-foreground" aria-hidden />
                <span className="truncate max-w-[16rem]">{link.title}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
