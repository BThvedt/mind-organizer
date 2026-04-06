'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DailyStat } from '@/lib/sessions';

interface CardsBarChartProps {
  data: DailyStat[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const correct = payload.find((p) => p.dataKey === 'correctCount')?.value ?? 0;
  const incorrect = payload.find((p) => p.dataKey === 'incorrectCount')?.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-popover-foreground mb-1">{label}</p>
      <p className="text-green-500">Correct: {correct}</p>
      <p className="text-destructive">Incorrect: {incorrect}</p>
    </div>
  );
}

function formatDateTick(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CardsBarChart({ data }: CardsBarChartProps) {
  const hasData = data.some((d) => d.cardsReviewed > 0);

  if (!hasData) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No study sessions yet. Start studying to see your activity!
      </div>
    );
  }

  const tickInterval = data.length <= 14 ? 1 : Math.floor(data.length / 7);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateTick}
          interval={tickInterval}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ className: 'fill-muted/50' }} />
        <Bar
          dataKey="correctCount"
          stackId="cards"
          fill="oklch(0.723 0.191 149.579)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="incorrectCount"
          stackId="cards"
          fill="var(--destructive)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
