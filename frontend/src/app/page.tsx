'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { AuthModals } from '@/components/auth-modals';
import { Button } from '@/components/ui/button';
import { BookOpen, ListTodo, Sparkles, Zap } from 'lucide-react';
import { useAuth, useMarkSignedOut, useRefreshSession } from '@/hooks/useAuth';

type AuthModal = 'signin' | 'signup' | null;

export default function Home() {
  const router = useRouter();
  const auth = useAuth();
  const markSignedOut = useMarkSignedOut();
  const refreshSession = useRefreshSession();
  const [modal, setModal] = useState<AuthModal>(null);

  useEffect(() => {
    if (auth === true) {
      router.replace('/dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
  }

  async function handleAuthSuccess() {
    await refreshSession();
    router.replace('/dashboard');
  }

  return (
    <>
      <Header
        authenticated={auth === true}
        onSignIn={() => setModal('signin')}
        onSignUp={() => setModal('signup')}
        onLogout={handleLogout}
      />

      <AuthModals
        open={modal}
        onOpenChange={setModal}
        onAuthSuccess={handleAuthSuccess}
      />

      <main className="flex flex-col min-h-screen">
        {/* Hero */}
        <section className="flex flex-col items-center justify-center text-center gap-6 px-6 pt-40 pb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" />
            Memory and Focus start Here.
          </div>

          <h1 className="max-w-2xl text-5xl font-bold tracking-tight leading-snug">
            Organize Your Mind and{' '}
            <span className="text-primary">Unlock Your Ability.</span>
          </h1>

          <p className="max-w-md text-muted-foreground text-lg leading-relaxed">
            Never lose track or forget important information with simple, basic, yet powerful tools - all in
            one place, and enhanced with latest tech.
          </p>

          {auth === null ? null : auth ? (
            <div className="flex items-center gap-3">
              <p className="text-muted-foreground text-sm">Welcome back!</p>
              <Button size="lg" onClick={() => router.push('/dashboard')}>Go to dashboard</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button size="lg" onClick={() => setModal('signup')}>
                Get started free
              </Button>
              <Button size="lg" variant="outline" onClick={() => setModal('signin')}>
                Sign in
              </Button>
            </div>
          )}
        </section>

        {/* Features */}
        <section className="mx-auto max-w-5xl px-6 pb-24 grid grid-cols-1 sm:grid-cols-3 gap-6 w-full">
          {[
            {
              icon: <BookOpen className="h-6 w-6 text-primary" />,
              title: 'Rich Flashcards',
              description:
                'Create rich cards with markdown, and review with a spaced repetition algorithm to study any subject',
            },
            {
              icon: <ListTodo className="h-6 w-6 text-primary" />,
              title: 'Notes and Todos',
              description:
                'Rich organized searchable notes with markdown. Todo lists to help organize and remember',
            },
            {
              icon: <Sparkles className="h-6 w-6 text-primary" />,
              title: 'AI Integration',
              description:
                'AI assisted formatting and flashcard creation, pull in info you might have missed, all now easier than ever!',
            },
          ].map(({ icon, title, description }) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                {icon}
              </div>
              <h3 className="font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
