'use client';

import { useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'signin' | 'signup';

interface AuthModalsProps {
  open: Mode | null;
  onOpenChange: (open: Mode | null) => void;
  onAuthSuccess: () => void;
}

export function AuthModals({ open, onOpenChange, onAuthSuccess }: AuthModalsProps) {
  return (
    <>
      <SignInModal
        open={open === 'signin'}
        onOpenChange={(v) => onOpenChange(v ? 'signin' : null)}
        onSwitchToSignUp={() => onOpenChange('signup')}
        onAuthSuccess={onAuthSuccess}
      />
      <SignUpModal
        open={open === 'signup'}
        onOpenChange={(v) => onOpenChange(v ? 'signup' : null)}
        onSwitchToSignIn={() => onOpenChange('signin')}
        onAuthSuccess={onAuthSuccess}
      />
    </>
  );
}

function SignInModal({
  open,
  onOpenChange,
  onSwitchToSignUp,
  onAuthSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignUp: () => void;
  onAuthSuccess: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!turnstileToken) {
      setError('Please complete the security check.');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, turnstileToken }),
    });

    setLoading(false);

    if (res.ok) {
      onOpenChange(false);
      onAuthSuccess();
    } else {
      setError('Invalid username or password.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl">Sign in</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signin-username">Username</Label>
            <Input
              id="signin-username"
              type="text"
              placeholder="your_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signin-password">Password</Label>
            <Input
              id="signin-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Turnstile
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
          <Button type="submit" className="w-full" disabled={loading || !turnstileToken}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToSignUp}
              className="underline underline-offset-4 text-foreground hover:text-primary transition-colors"
            >
              Sign up
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignUpModal({
  open,
  onOpenChange,
  onSwitchToSignIn,
  onAuthSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignIn: () => void;
  onAuthSuccess: () => void;
}) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    if (!turnstileToken) {
      setError('Please complete the security check.');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, turnstileToken }),
    });

    setLoading(false);

    if (res.ok) {
      onOpenChange(false);
      onAuthSuccess();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Registration failed. Please try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl">Create an account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-username">Username</Label>
            <Input
              id="signup-username"
              type="text"
              placeholder="your_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-confirm">Confirm password</Label>
            <Input
              id="signup-confirm"
              type="password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <Turnstile
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
          <Button type="submit" className="w-full" disabled={loading || !turnstileToken}>
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToSignIn}
              className="underline underline-offset-4 text-foreground hover:text-primary transition-colors"
            >
              Sign in
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
