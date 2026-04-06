'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DailyStat } from '@/lib/sessions';

interface RetentionLineChartProps {
  data: DailyStat[];
}

interface ChartPoint {
  date: string;
  retention: number;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-popover-foreground mb-1">{label}</p>
      <p className="text-primary">{Math.round(value)}% retention</p>
    </div>
  );
}

function formatDateTick(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RetentionLineChart({ data }: RetentionLineChartProps) {
  const points: ChartPoint[] = data
    .filter((d) => d.cardsReviewed > 0)
    .map((d) => ({
      date: formatDateTick(d.date),
      retention: (d.correctCount / d.cardsReviewed) * 100,
    }));

  if (points.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        Complete some study sessions to track your retention rate.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="retentionGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="retention"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="url(#retentionGradient)"
          dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: 'var(--primary)', strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
