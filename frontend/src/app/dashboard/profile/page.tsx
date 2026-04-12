'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserCircle, KeyRound, CheckCircle, AlertCircle, Loader2, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

interface ProfileData {
  uuid: string;
  name: string;
  mail: string;
}

type Status = { type: 'idle' } | { type: 'loading' } | { type: 'success'; message: string } | { type: 'error'; message: string };

function StatusMessage({ status }: { status: Status }) {
  if (status.type === 'idle' || status.type === 'loading') return null;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
        status.type === 'success'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-destructive/10 text-destructive'
      )}
    >
      {status.type === 'success' ? (
        <CheckCircle className="h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0" />
      )}
      {status.message}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const { isOnline } = useOnlineStatus();

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<Status>({ type: 'idle' });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<Status>({ type: 'idle' });

  const authenticated = useAuth();

  useEffect(() => {
    if (!authenticated) return;
    fetch('/api/auth/profile')
      .then((r) => r.json())
      .then((data: ProfileData) => {
        setProfile(data);
        setUsername(data.name);
        setProfileFailed(false);
      })
      .catch(() => {
        setProfileFailed(true);
      });
  }, [authenticated]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  async function handleUsernameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setUsernameStatus({ type: 'loading' });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: username.trim() }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();
      if (res.ok) {
        setProfile((p) => p ? { ...p, name: data.name } : p);
        setUsernameStatus({ type: 'success', message: 'Username updated successfully.' });
      } else {
        setUsernameStatus({ type: 'error', message: data.error ?? 'Failed to update username.' });
      }
    } catch {
      setUsernameStatus({ type: 'error', message: 'You appear to be offline. Please try again when you have a connection.' });
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) return;

    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 5) {
      setPasswordStatus({ type: 'error', message: 'New password must be at least 5 characters.' });
      return;
    }

    setPasswordStatus({ type: 'loading' });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();
      if (res.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordStatus({ type: 'success', message: 'Password updated successfully.' });
      } else {
        setPasswordStatus({ type: 'error', message: data.error ?? 'Failed to update password.' });
      }
    } catch {
      setPasswordStatus({ type: 'error', message: 'You appear to be offline. Please try again when you have a connection.' });
    }
  }

  if (!authenticated) return null;

  if (!profile) {
    if (profileFailed) {
      return (
        <>
          <Header
            authenticated
            onSignIn={() => {}}
            onSignUp={() => {}}
            onLogout={handleLogout}
          />
          <main className="mx-auto max-w-2xl px-6 pt-28 pb-16">
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <WifiOff className="h-12 w-12 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-foreground">
                Profile not available offline
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Your profile data hasn&apos;t been cached yet. It will load
                automatically when you reconnect.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => history.back()}>
                  Go back
                </Button>
                <Button onClick={() => location.reload()}>
                  Retry
                </Button>
              </div>
            </div>
          </main>
        </>
      );
    }
    return null;
  }

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-2xl px-6 pt-28 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Profile</h1>
          <p className="mt-1 text-muted-foreground">Manage your account details.</p>
        </div>

        <div className="flex flex-col gap-6">
          {/* Username */}
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <UserCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Username</h2>
                <p className="text-sm text-muted-foreground">Change your login name.</p>
              </div>
            </div>

            <form onSubmit={handleUsernameSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <StatusMessage status={usernameStatus} />

              <div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={usernameStatus.type === 'loading' || username.trim() === profile.name}
                >
                  {usernameStatus.type === 'loading' && (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  )}
                  Save username
                </Button>
              </div>
            </form>
          </section>

          {/* Password */}
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Password</h2>
                <p className="text-sm text-muted-foreground">Keep your account secure with a strong password.</p>
              </div>
            </div>

            <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              <StatusMessage status={passwordStatus} />

              <div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={passwordStatus.type === 'loading' || !currentPassword || !newPassword || !confirmPassword}
                >
                  {passwordStatus.type === 'loading' && (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  )}
                  Update password
                </Button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
