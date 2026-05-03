'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SharedTodoItem, SharedTodoList } from '@/app/share/_lib/fetch-share';

const PRIORITY_LABELS: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-red-500 text-white border-red-500' },
  med: { label: 'Med', className: 'bg-yellow-500 text-white border-yellow-500' },
  low: { label: 'Low', className: 'bg-blue-500 text-white border-blue-500' },
};

interface Props {
  token: string;
  list: SharedTodoList;
}

export function SharedTodoListClient({ token, list }: Props) {
  const [items, setItems] = useState<SharedTodoItem[]>(list.items);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(list.items);
  }, [list.items]);

  const completedCount = items.filter((i) => i.completed).length;

  async function toggle(item: SharedTodoItem) {
    const next = !item.completed;
    setItems((prev) => prev.map((i) => (i.uuid === item.uuid ? { ...i, completed: next } : i)));
    setPending((prev) => new Set(prev).add(item.uuid));
    setError('');
    try {
      const res = await fetch(
        `/api/public/share/todo/${encodeURIComponent(token)}/items/${encodeURIComponent(item.uuid)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: next }),
        },
      );
      if (!res.ok) {
        setItems((prev) => prev.map((i) => (i.uuid === item.uuid ? { ...i, completed: !next } : i)));
        setError('Could not save your change. Please try again.');
      }
    } catch {
      setItems((prev) => prev.map((i) => (i.uuid === item.uuid ? { ...i, completed: !next } : i)));
      setError('Network error. Please try again.');
    } finally {
      setPending((prev) => {
        const n = new Set(prev);
        n.delete(item.uuid);
        return n;
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          {list.title}
        </h1>
        {(list.area || list.subject) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {list.area && <Badge variant="secondary">{list.area.name}</Badge>}
            {list.subject && <Badge variant="outline">{list.subject.name}</Badge>}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Shared list · check items off as you complete them.
        </p>
      </header>

      {items.length > 0 && (
        <div className="mb-6 space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                completedCount === items.length ? 'bg-green-500' : 'bg-primary',
              )}
              style={{ width: `${Math.round((completedCount / items.length) * 100)}%` }}
            />
          </div>
          <p
            className={cn(
              'text-xs transition-colors duration-300',
              completedCount === items.length
                ? 'text-green-500 font-medium flex items-center gap-1'
                : 'text-muted-foreground',
            )}
          >
            {completedCount === items.length && <Check className="h-3 w-3" />}
            {completedCount} of {items.length} completed
          </p>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">This list is empty.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const isPending = pending.has(item.uuid);
            const priority = item.priority && PRIORITY_LABELS[item.priority];
            return (
              <li
                key={item.uuid}
                className="rounded-lg border border-transparent hover:border-border hover:bg-muted/40 transition-colors"
              >
                <label className="flex items-start gap-3 px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => toggle(item)}
                    disabled={isPending}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-sm leading-snug',
                          item.completed && 'line-through text-muted-foreground',
                        )}
                      >
                        {item.text}
                      </span>
                      {priority && (
                        <span
                          className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide',
                            priority.className,
                          )}
                        >
                          {priority.label}
                        </span>
                      )}
                    </div>
                    {item.notes && (
                      <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap">
                        {item.notes}
                      </p>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
