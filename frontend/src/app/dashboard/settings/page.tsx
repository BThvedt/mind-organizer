'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowLeft,
  UserCircle,
  KeyRound,
  CheckCircle,
  AlertCircle,
  Loader2,
  WifiOff,
  Settings,
  Sparkles,
  Link2,
} from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';
import {
  OFFLINE_ACTION_MESSAGE,
  messageWhenNetworkRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';
import {
  MATCH_STRENGTH_MAX,
  MATCH_STRENGTH_MIN,
  MATCH_STRENGTH_STEP,
} from '@/lib/match-strength';
import { invalidateMatchStrengthPreferencesCache } from '@/hooks/useMatchStrengthPreferences';

interface ProfileData {
  uuid: string;
  name: string;
  mail: string;
  /** ISO 8601 from Drupal; optional for older clients */
  created?: string | null;
  linkMatchStrength: number;
  askMatchStrength: number;
}

type Status =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

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

function ProfileTab({
  profile,
  username,
  setUsername,
  usernameStatus,
  handleUsernameSubmit,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordStatus,
  handlePasswordSubmit,
}: {
  profile: ProfileData;
  username: string;
  setUsername: (value: string) => void;
  usernameStatus: Status;
  handleUsernameSubmit: (e: React.FormEvent) => void;
  currentPassword: string;
  setCurrentPassword: (value: string) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  passwordStatus: Status;
  handlePasswordSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-6 pt-6">
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

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Password</h2>
            <p className="text-sm text-muted-foreground">
              Keep your account secure with a strong password.
            </p>
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
              disabled={
                passwordStatus.type === 'loading' ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
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
  );
}

function MatchStrengthField({
  id,
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <span className="font-mono text-xs text-foreground tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={MATCH_STRENGTH_MIN}
        max={MATCH_STRENGTH_MAX}
        step={MATCH_STRENGTH_STEP}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary disabled:opacity-60"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function PreferencesTab({
  profile,
  isOnline,
  onPreferencesSaved,
}: {
  profile: ProfileData;
  isOnline: boolean;
  onPreferencesSaved: (linkMatchStrength: number, askMatchStrength: number) => void;
}) {
  const [linkMatchStrength, setLinkMatchStrength] = useState(profile.linkMatchStrength);
  const [askMatchStrength, setAskMatchStrength] = useState(profile.askMatchStrength);
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  useEffect(() => {
    setLinkMatchStrength(profile.linkMatchStrength);
    setAskMatchStrength(profile.askMatchStrength);
  }, [profile.linkMatchStrength, profile.askMatchStrength]);

  const unchanged =
    linkMatchStrength === profile.linkMatchStrength &&
    askMatchStrength === profile.askMatchStrength;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged) return;
    if (!isOnline) {
      setStatus({ type: 'error', message: OFFLINE_ACTION_MESSAGE });
      return;
    }
    setStatus({ type: 'loading' });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkMatchStrength, askMatchStrength }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const nextLink =
          typeof (data as { linkMatchStrength?: unknown }).linkMatchStrength === 'number'
            ? (data as { linkMatchStrength: number }).linkMatchStrength
            : linkMatchStrength;
        const nextAsk =
          typeof (data as { askMatchStrength?: unknown }).askMatchStrength === 'number'
            ? (data as { askMatchStrength: number }).askMatchStrength
            : askMatchStrength;
        onPreferencesSaved(nextLink, nextAsk);
        invalidateMatchStrengthPreferencesCache();
        setStatus({ type: 'success', message: 'Preferences saved.' });
      } else {
        setStatus({
          type: 'error',
          message: userFacingMessageForApiError(res, data, 'Failed to save preferences.'),
        });
      }
    } catch {
      setStatus({
        type: 'error',
        message: messageWhenNetworkRequestThrows(),
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-6 pt-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Default match-strength values for semantic search features. You can still adjust the
        slider on each screen for a one-off query.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Link suggestions</h2>
              <p className="text-sm text-muted-foreground">
                Default for the AI tab in the link-items dialog.
              </p>
            </div>
          </div>
          <MatchStrengthField
            id="pref-link-match-strength"
            label="Match strength"
            description="Too many results? Raise the threshold. Too few? Lower it."
            value={linkMatchStrength}
            onChange={setLinkMatchStrength}
            disabled={status.type === 'loading'}
          />
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Ask AI</h2>
              <p className="text-sm text-muted-foreground">
                Default for the match-strength filter on the Ask AI page.
              </p>
            </div>
          </div>
          <MatchStrengthField
            id="pref-ask-match-strength"
            label="Match strength"
            description="Lower values include weaker matches as context; higher values demand stronger overlap."
            value={askMatchStrength}
            onChange={setAskMatchStrength}
            disabled={status.type === 'loading'}
          />
        </section>

        <StatusMessage status={status} />

        <div>
          <Button type="submit" size="sm" disabled={status.type === 'loading' || unchanged}>
            {status.type === 'loading' && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Save preferences
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function SettingsPage() {
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
  const markSignedOut = useMarkSignedOut();

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
    markSignedOut();
    router.replace('/');
  }

  async function handleUsernameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    if (!isOnline) {
      setUsernameStatus({ type: 'error', message: OFFLINE_ACTION_MESSAGE });
      return;
    }
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

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const name =
          typeof (data as { name?: unknown }).name === 'string'
            ? (data as { name: string }).name
            : username.trim();
        setProfile((p) => (p ? { ...p, name } : p));
        setUsernameStatus({ type: 'success', message: 'Username updated successfully.' });
      } else {
        setUsernameStatus({
          type: 'error',
          message: userFacingMessageForApiError(res, data, 'Failed to update username.'),
        });
      }
    } catch {
      setUsernameStatus({
        type: 'error',
        message: messageWhenNetworkRequestThrows(),
      });
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
    if (!isOnline) {
      setPasswordStatus({ type: 'error', message: OFFLINE_ACTION_MESSAGE });
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

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordStatus({ type: 'success', message: 'Password updated successfully.' });
      } else {
        setPasswordStatus({
          type: 'error',
          message: userFacingMessageForApiError(res, data, 'Failed to update password.'),
        });
      }
    } catch {
      setPasswordStatus({
        type: 'error',
        message: messageWhenNetworkRequestThrows(),
      });
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
          <main className="mx-auto max-w-4xl px-6 pt-28 pb-16">
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <WifiOff className="h-12 w-12 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-foreground">
                Profile not available offline
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Your profile data hasn&apos;t been cached yet. It will load automatically when you
                reconnect.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => history.back()}>
                  Go back
                </Button>
                <Button onClick={() => location.reload()}>Retry</Button>
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

      <main className="mx-auto max-w-4xl px-6 pt-28 pb-16">
        <div className="mb-8 flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className="mt-1"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <div className="flex-1">
            <div className="flex items-start gap-2">
              <Settings className="mt-1 h-7 w-7 text-primary shrink-0" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
                <p className="mt-1 text-muted-foreground">
                  Manage your account and preferences.
                </p>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab
              profile={profile}
              username={username}
              setUsername={setUsername}
              usernameStatus={usernameStatus}
              handleUsernameSubmit={handleUsernameSubmit}
              currentPassword={currentPassword}
              setCurrentPassword={setCurrentPassword}
              newPassword={newPassword}
              setNewPassword={setNewPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              passwordStatus={passwordStatus}
              handlePasswordSubmit={handlePasswordSubmit}
            />
          </TabsContent>

          <TabsContent value="preferences">
            <PreferencesTab
              profile={profile}
              isOnline={isOnline}
              onPreferencesSaved={(linkMatchStrength, askMatchStrength) =>
                setProfile((p) => (p ? { ...p, linkMatchStrength, askMatchStrength } : p))
              }
            />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
