'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { ActivityHeatmap } from '@/components/activity-heatmap';
import { CardsBarChart } from '@/components/cards-bar-chart';
import { RetentionLineChart } from '@/components/retention-line-chart';
import { CardDistributionBar } from '@/components/card-distribution-bar';
import { Flame, Clock, Trophy, TrendingUp, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  loadSessions,
  getStreak,
  getTotalMinutes,
  getRetentionRate,
  getDailyStats,
} from '@/lib/sessions';
import { loadSRSPool, countMastered } from '@/lib/srs';
import type { StudySession } from '@/lib/sessions';

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function StudyStatsPage() {
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [streak, setStreak] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [retention, setRetention] = useState<number | null>(null);
  const [mastered, setMastered] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [learningCount, setLearningCount] = useState(0);
  const [dueToday, setDueToday] = useState(0);

  useEffect(() => {
    if (!authenticated) return;

    const loadedPool = loadSRSPool();
    setSessions(loadSessions());
    setStreak(getStreak());
    setTotalMinutes(getTotalMinutes());
    setRetention(getRetentionRate(30));
    setMastered(countMastered(loadedPool));

    const entries = Object.values(loadedPool);
    setNewCount(entries.filter((e) => !e.retired && e.repetitions === 0).length);
    setLearningCount(entries.filter((e) => !e.retired && e.repetitions > 0).length);

    const today = new Date().toISOString().slice(0, 10);
    const due = entries.filter((e) => !e.retired && e.nextReviewAt <= today).length;
    setDueToday(due);
  }, [authenticated]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  if (!authenticated) return null;

  const dailyStats = getDailyStats(30);

  const stats = [
    { icon: <Flame className="h-5 w-5 text-primary" />, label: 'Day streak', value: String(streak) },
    { icon: <Clock className="h-5 w-5 text-primary" />, label: 'Time studied', value: formatTime(totalMinutes) },
    {
      icon: <TrendingUp className="h-5 w-5 text-primary" />,
      label: 'Retention (30d)',
      value: retention !== null ? `${Math.round(retention * 100)}%` : '—',
    },
    { icon: <Trophy className="h-5 w-5 text-primary" />, label: 'Cards mastered', value: String(mastered) },
  ];

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-6xl px-6 pt-28 pb-16">
        {/* Page header */}
        <div className="mb-8 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Study Stats</h1>
            <p className="mt-1 text-muted-foreground">
              Your study history and performance. See your retention rate, study history, and progress!
            </p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {stats.map(({ icon, label, value }) => (
            <div
              key={label}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                {icon}
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Activity heatmap */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-4">Study activity</h2>
          <div className="rounded-xl border border-border bg-card p-6 overflow-x-auto">
            <ActivityHeatmap sessions={sessions} />
          </div>
        </section>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          {/* Bar chart */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Cards reviewed</h2>
            <div className="rounded-xl border border-border bg-card p-6">
              <CardsBarChart data={dailyStats} />
            </div>
          </section>

          {/* Retention line chart */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Retention rate</h2>
            <div className="rounded-xl border border-border bg-card p-6">
              <RetentionLineChart data={dailyStats} />
            </div>
          </section>
        </div>

        {/* Card distribution */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-4">Card distribution</h2>
          <div className="rounded-xl border border-border bg-card p-6">
            <CardDistributionBar
              newCount={newCount}
              learningCount={learningCount}
              masteredCount={mastered}
              dueToday={dueToday}
            />
          </div>
        </section>
      </main>
    </>
  );
}
