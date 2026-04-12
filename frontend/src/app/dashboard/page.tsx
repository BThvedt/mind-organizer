'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { BookOpen, Brain, Flame, Clock, Trophy, FileText, CheckSquare } from 'lucide-react';
import { loadSRSPool, countMastered } from '@/lib/srs';
import { getStreak, getTotalMinutes } from '@/lib/sessions';

export default function Dashboard() {
  const router = useRouter();
  const authenticated = useAuth();
  const [mastered, setMastered] = useState(0);
  const [streak, setStreak] = useState(0);
  const [minutesStudied, setMinutesStudied] = useState(0);

  useEffect(() => {
    if (authenticated) {
      setMastered(countMastered(loadSRSPool()));
      setStreak(getStreak());
      setMinutesStudied(getTotalMinutes());
    }
  }, [authenticated]);

  useEffect(() => {
    router.prefetch('/dashboard/todos');
  }, [router]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  if (!authenticated) return null;

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-6xl px-6 pt-28 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">Welcome back — here&apos;s your study overview.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            { icon: <Flame className="h-5 w-5 text-primary" />, label: 'Day streak', value: String(streak) },
            { icon: <Clock className="h-5 w-5 text-primary" />, label: 'Minutes studied', value: String(minutesStudied) },
            { icon: <Trophy className="h-5 w-5 text-primary" />, label: 'Cards mastered', value: String(mastered) },
          ].map(({ icon, label, value }) => (
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

        {/* Quick actions */}
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: <Brain className="h-6 w-6 text-primary" />,
              title: 'Study now',
              description: 'Review cards that are due today.',
              action: 'Start session',
              href: '/dashboard/study',
            },
            {
              icon: <BookOpen className="h-6 w-6 text-primary" />,
              title: 'My decks',
              description: 'Browse and manage your flashcard decks.',
              action: 'View decks',
              href: '/dashboard/decks',
            },
            {
              icon: <FileText className="h-6 w-6 text-primary" />,
              title: 'My notes',
              description: 'Write and review your Markdown study notes.',
              action: 'View notes',
              href: '/dashboard/notes',
            },
            {
              icon: <CheckSquare className="h-6 w-6 text-primary" />,
              title: 'Todo lists',
              description: 'Track tasks and study goals with todo lists.',
              action: 'View todos',
              href: '/dashboard/todos',
            },
          ].map(({ icon, title, description, action, href }) => (
            <div
              key={title}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                {icon}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
              {href ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  nativeButton={false}
                  render={<Link href={href} />}
                >
                  {action}
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="self-start" disabled>
                  {action}
                </Button>
              )}
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
