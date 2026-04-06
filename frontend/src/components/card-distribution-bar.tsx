'use client';

import { cn } from '@/lib/utils';

interface CardDistributionBarProps {
  newCount: number;
  learningCount: number;
  masteredCount: number;
  dueToday: number;
}

interface Segment {
  label: string;
  count: number;
  colorClass: string;
  bgClass: string;
}

export function CardDistributionBar({
  newCount,
  learningCount,
  masteredCount,
  dueToday,
}: CardDistributionBarProps) {
  const total = newCount + learningCount + masteredCount;

  const segments: Segment[] = [
    { label: 'New', count: newCount, colorClass: 'text-blue-500', bgClass: 'bg-blue-500' },
    { label: 'Learning', count: learningCount, colorClass: 'text-amber-500', bgClass: 'bg-amber-500' },
    { label: 'Mastered', count: masteredCount, colorClass: 'text-green-500', bgClass: 'bg-green-500' },
  ];

  return (
    <div className="space-y-4">
      {/* Stacked bar */}
      {total > 0 ? (
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
          {segments.map(
            (seg) =>
              seg.count > 0 && (
                <div
                  key={seg.label}
                  className={cn('h-full transition-all duration-500', seg.bgClass)}
                  style={{ width: `${(seg.count / total) * 100}%` }}
                />
              )
          )}
        </div>
      ) : (
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" />
      )}

      {/* Legend + counts */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <div className={cn('h-3 w-3 rounded-full', seg.bgClass)} />
            <span className="text-sm text-muted-foreground">{seg.label}</span>
            <span className={cn('text-sm font-semibold', seg.colorClass)}>{seg.count}</span>
          </div>
        ))}
      </div>

      {/* Due today callout */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2.5">
        <span className="text-sm text-muted-foreground">Due today</span>
        <span className="text-sm font-bold text-foreground">{dueToday}</span>
      </div>
    </div>
  );
}
