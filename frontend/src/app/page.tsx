'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { AuthModals } from '@/components/auth-modals';
import { Button } from '@/components/ui/button';
import { BookOpen, Brain, BarChart3, Zap } from 'lucide-react';

type AuthModal = 'signin' | 'signup' | null;

export default function Home() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [modal, setModal] = useState<AuthModal>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          router.replace('/dashboard');
        } else {
          setAuthenticated(false);
        }
      });
  }, [router]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthenticated(false);
  }

  function handleAuthSuccess() {
    router.replace('/dashboard');
  }

  return (
    <>
      <Header
        authenticated={!!authenticated}
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
            Smarter studying starts here
          </div>

          <h1 className="max-w-2xl text-5xl font-bold tracking-tight leading-tight">
            Learn faster with
            <span className="text-primary"> adaptive </span>
            study tools
          </h1>

          <p className="max-w-md text-muted-foreground text-lg leading-relaxed">
            Build lasting knowledge with spaced repetition, progress tracking, and
            AI-powered quizzes — all in one place.
          </p>

          {authenticated === null ? null : authenticated ? (
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
              icon: <Brain className="h-6 w-6 text-primary" />,
              title: 'Spaced repetition',
              description:
                'Our algorithm surfaces cards at the exact moment you need to review them.',
            },
            {
              icon: <BarChart3 className="h-6 w-6 text-primary" />,
              title: 'Progress tracking',
              description:
                'Visualise your learning streaks, retention rate, and time invested.',
            },
            {
              icon: <BookOpen className="h-6 w-6 text-primary" />,
              title: 'Rich flashcards',
              description:
                'Create cards with markdown, images, and code blocks to study any subject.',
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
