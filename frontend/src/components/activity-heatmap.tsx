'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { StudySession } from '@/lib/sessions';

interface ActivityHeatmapProps {
  sessions: StudySession[];
  weeks?: number;
}

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function intensityLevel(count: number): number {
  if (count === 0) return 0;
  if (count <= 5) return 1;
  if (count <= 10) return 2;
  if (count <= 20) return 3;
  if (count <= 35) return 4;
  return 5;
}

const INTENSITY_CLASSES = [
  'bg-muted',
  'bg-primary/15',
  'bg-primary/30',
  'bg-primary/50',
  'bg-primary/70',
  'bg-primary/90',
] as const;

export function ActivityHeatmap({ sessions, weeks = 26 }: ActivityHeatmapProps) {
  const [tooltip, setTooltip] = useState<{ date: string; count: number; x: number; y: number } | null>(null);

  const { grid, months } = useMemo(() => {
    const countByDate = new Map<string, number>();
    for (const s of sessions) {
      countByDate.set(s.date, (countByDate.get(s.date) ?? 0) + s.cardsReviewed);
    }

    const today = new Date();
    const todayDay = today.getDay(); // 0=Sun
    const totalDays = weeks * 7;

    // Walk back to the start of the grid (nearest Sunday before or on the start date)
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - totalDays + 1 - todayDay);

    const cells: { date: string; count: number; col: number; row: number }[] = [];
    const monthLabels: { label: string; col: number }[] = [];
    let lastMonth = -1;

    const d = new Date(startDate);
    for (let i = 0; i < totalDays + todayDay + 1; i++) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getDay(); // row
      const col = Math.floor(i / 7);

      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth();
        monthLabels.push({
          label: d.toLocaleDateString(undefined, { month: 'short' }),
          col,
        });
      }

      if (d <= today) {
        cells.push({ date: dateStr, count: countByDate.get(dateStr) ?? 0, col, row: dayOfWeek });
      }

      d.setDate(d.getDate() + 1);
    }

    return { grid: cells, months: monthLabels };
  }, [sessions, weeks]);

  const totalCols = Math.max(...grid.map((c) => c.col)) + 1;

  return (
    <div className="relative">
      {/* Month labels */}
      <div className="flex ml-8 mb-1 text-xs text-muted-foreground">
        {months.map((m, i) => (
          <span
            key={i}
            className="absolute text-[10px]"
            style={{ left: `calc(${(m.col / totalCols) * 100}% + 2rem)` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-1 mt-5">
        {/* Day labels */}
        <div className="flex flex-col gap-[3px] pr-1">
          {DAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="h-[13px] text-[10px] leading-[13px] text-muted-foreground text-right w-6"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${totalCols}, 13px)`,
            gridTemplateRows: 'repeat(7, 13px)',
          }}
        >
          {grid.map((cell) => (
            <div
              key={cell.date}
              className={cn(
                'rounded-[3px] transition-colors',
                INTENSITY_CLASSES[intensityLevel(cell.count)]
              )}
              style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setTooltip({
                  date: cell.date,
                  count: cell.count,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-3 ml-8 text-[10px] text-muted-foreground">
        <span>Less</span>
        {INTENSITY_CLASSES.map((cls, i) => (
          <div key={i} className={cn('h-[11px] w-[11px] rounded-[2px]', cls)} />
        ))}
        <span>More</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md border border-border pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y - 36,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="font-medium">{tooltip.count} cards</span>{' '}
          <span className="text-muted-foreground">
            on {new Date(tooltip.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}
    </div>
  );
}
