'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Layers, Brain, FileText, CheckSquare } from 'lucide-react';

/** Accounts newer than this after registration are greeted with "Welcome" (not "Welcome back"). */
const NEW_ACCOUNT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

type GreetingState =
  | { status: 'loading' }
  | { status: 'ready'; variant: 'new' | 'returning'; displayName: string };

export default function Dashboard() {
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const [greeting, setGreeting] = useState<GreetingState>({ status: 'loading' });

  useEffect(() => {
    if (!authenticated) return;
    fetch('/api/auth/profile')
      .then((r) => {
        if (!r.ok) throw new Error('profile');
        return r.json();
      })
      .then((data: { name?: string; created?: string | null }) => {
        const displayName = data.name?.trim() || 'there';
        let variant: 'new' | 'returning' = 'returning';
        if (data.created) {
          const createdMs = Date.parse(data.created);
          if (!Number.isNaN(createdMs) && Date.now() - createdMs < NEW_ACCOUNT_MAX_AGE_MS) {
            variant = 'new';
          }
        }
        setGreeting({ status: 'ready', variant, displayName });
      })
      .catch(() => {
        setGreeting({ status: 'ready', variant: 'returning', displayName: 'there' });
      });
  }, [authenticated]);

  useEffect(() => {
    router.prefetch('/dashboard/todos');
    // `useRouter()` identity can change between renders; listing it re-runs prefetch endlessly in dev.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
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
          {greeting.status === 'loading' ? (
            <div className="space-y-2">
              <div className="h-9 max-w-md rounded-md bg-muted animate-pulse" aria-hidden />
              <div className="h-5 max-w-xs rounded-md bg-muted/80 animate-pulse" aria-hidden />
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {greeting.variant === 'new'
                  ? `Welcome, ${greeting.displayName}!`
                  : `Welcome back, ${greeting.displayName}!`}
              </h1>
              <p className="mt-1 text-muted-foreground">Let&apos;s organize!</p>
            </>
          )}
        </div>

        <h2 className="text-lg font-semibold text-foreground mb-4">Your Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: <CheckSquare className="h-6 w-6 text-primary" />,
              title: 'Todo lists',
              description: 'Track tasks and study goals with todo lists.',
              action: 'View todos',
              href: '/dashboard/todos',
            },
            {
              icon: <FileText className="h-6 w-6 text-primary" />,
              title: 'My notes',
              description: 'Write and review your Markdown study notes.',
              action: 'View notes',
              href: '/dashboard/notes',
            },
            {
              icon: <Layers className="h-6 w-6 text-primary" />,
              title: 'My decks',
              description: 'Browse and manage your flashcard decks.',
              action: 'View decks',
              href: '/dashboard/decks',
            },
            {
              icon: <Brain className="h-6 w-6 text-primary" />,
              title: 'Study now',
              description: 'Review cards that are due today.',
              action: 'Start session',
              href: '/dashboard/study',
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
