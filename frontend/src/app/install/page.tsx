'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { AuthModals } from '@/components/auth-modals';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Check,
  Download,
  ExternalLink,
  MoreVertical,
  Plus,
  Share,
} from 'lucide-react';
import { useAuth, useMarkSignedOut, useRefreshSession } from '@/hooks/useAuth';
import { useInstallPrompt } from '@/components/install-prompt-provider';
import { detectBrowser, type BrowserInfo } from '@/lib/detect-browser';

type AuthModal = 'signin' | 'signup' | null;

interface RelatedApplication {
  platform?: string;
  url?: string;
  id?: string;
}

interface NavigatorWithRelated extends Navigator {
  getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
}

export default function InstallPage() {
  const router = useRouter();
  const auth = useAuth();
  const markSignedOut = useMarkSignedOut();
  const refreshSession = useRefreshSession();
  const { canInstall, installed: providerInstalled, install } = useInstallPrompt();

  const [modal, setModal] = useState<AuthModal>(null);
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [relatedInstalled, setRelatedInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<
    'accepted' | 'dismissed' | 'unavailable' | null
  >(null);

  useEffect(() => {
    setBrowser(detectBrowser());

    const nav = navigator as NavigatorWithRelated;
    if (typeof nav.getInstalledRelatedApps === 'function') {
      nav
        .getInstalledRelatedApps()
        .then((apps) => {
          if (apps.length > 0) setRelatedInstalled(true);
        })
        .catch(() => {});
    }
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
  }

  async function handleAuthSuccess() {
    await refreshSession();
    router.replace('/dashboard');
  }

  async function handleInstall() {
    setInstalling(true);
    const outcome = await install();
    setInstalling(false);
    setInstallResult(outcome);
  }

  const installed = providerInstalled || relatedInstalled;

  const heading = useMemo(() => {
    if (!browser) return 'Install Mind Organizer';
    if (browser.kind === 'other') return 'Install Mind Organizer';
    return `You're on ${browser.label}`;
  }, [browser]);

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

      <main className="flex flex-col items-center px-6 pt-28 pb-16 sm:pt-36">
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Download className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Install Mind Organizer
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Mind Organizer is a Progressive Web App. Install it to launch from
              your home screen, get an app icon, and use it offline.
            </p>
          </div>

          {installed ? (
            <InstalledCard onOpen={() => router.push('/dashboard')} />
          ) : (
            <Card className="p-2">
              <CardHeader>
                <CardTitle className="text-lg">{heading}</CardTitle>
                {browser && browser.kind !== 'other' && (
                  <CardDescription>
                    Follow the steps below to add Mind Organizer to your device.
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {browser && (
                  <BrowserInstructions
                    browser={browser}
                    canInstall={canInstall}
                    installing={installing}
                    installResult={installResult}
                    onInstall={handleInstall}
                  />
                )}
              </CardContent>
            </Card>
          )}

          <div className="mt-6 text-center text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground underline-offset-4 hover:underline">
              Back to home
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function InstalledCard({ onOpen }: { onOpen: () => void }) {
  return (
    <Card className="p-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Check className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Looks like it&apos;s already installed</CardTitle>
            <CardDescription>
              Mind Organizer appears to be installed on this device.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button onClick={onOpen} className="w-full sm:w-auto">
          Open the app
        </Button>
      </CardContent>
    </Card>
  );
}

interface BrowserInstructionsProps {
  browser: BrowserInfo;
  canInstall: boolean;
  installing: boolean;
  installResult: 'accepted' | 'dismissed' | 'unavailable' | null;
  onInstall: () => void;
}

function BrowserInstructions({
  browser,
  canInstall,
  installing,
  installResult,
  onInstall,
}: BrowserInstructionsProps) {
  const showInstallButton =
    canInstall &&
    (browser.kind === 'chromeAndroid' ||
      browser.kind === 'chromeDesktop' ||
      browser.kind === 'edgeDesktop' ||
      browser.kind === 'samsung');

  return (
    <>
      {showInstallButton && (
        <div className="flex flex-col gap-2">
          <Button onClick={onInstall} disabled={installing} size="lg" className="gap-2">
            <Download className="h-4 w-4" />
            {installing ? 'Installing…' : 'Install app'}
          </Button>
          {installResult === 'dismissed' && (
            <p className="text-xs text-muted-foreground">
              Install was dismissed. You can run it again or follow the manual
              steps below.
            </p>
          )}
          {installResult === 'unavailable' && (
            <p className="text-xs text-muted-foreground">
              The browser&apos;s install prompt isn&apos;t available right now.
              Try the manual steps below.
            </p>
          )}
        </div>
      )}

      {(() => {
        switch (browser.kind) {
          case 'chromeAndroid':
            return (
              <Steps
                heading="Or install manually"
                steps={[
                  { icon: <MoreVertical className="h-4 w-4" />, text: 'Tap the menu in Chrome (three dots, top right).' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Choose Install app or Add to Home screen.' },
                  { icon: <Check className="h-4 w-4" />, text: 'Confirm — Mind Organizer will appear on your home screen.' },
                ]}
              />
            );
          case 'chromeDesktop':
            return (
              <Steps
                heading="Or install manually"
                steps={[
                  { icon: <Download className="h-4 w-4" />, text: 'Look for the install icon at the right end of Chrome\u2019s address bar, or open the menu (three dots).' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Choose Install Mind Organizer.' },
                  { icon: <Check className="h-4 w-4" />, text: 'The app will open in its own window with a desktop shortcut.' },
                ]}
              />
            );
          case 'edgeDesktop':
            return (
              <Steps
                heading="Or install manually"
                steps={[
                  { icon: <MoreVertical className="h-4 w-4" />, text: 'Open the Edge menu (three dots, top right).' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Choose Apps -> Install this site as an app.' },
                  { icon: <Check className="h-4 w-4" />, text: 'Confirm — the app will install and open in its own window.' },
                ]}
              />
            );
          case 'samsung':
            return (
              <Steps
                heading="Install on Samsung Internet"
                steps={[
                  { icon: <MoreVertical className="h-4 w-4" />, text: 'Open the menu (three lines, bottom right).' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Tap Add page to -> Home screen.' },
                  { icon: <Check className="h-4 w-4" />, text: 'Confirm to add Mind Organizer to your home screen.' },
                ]}
              />
            );
          case 'safariIOS':
            return (
              <Steps
                steps={[
                  { icon: <Share className="h-4 w-4" />, text: 'Tap the Share button at the bottom of Safari (square with an arrow pointing up).' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Scroll down and tap Add to Home Screen.' },
                  { icon: <Check className="h-4 w-4" />, text: 'Tap Add — Mind Organizer will appear on your home screen.' },
                ]}
                note="Mind Organizer must be opened in Safari (not Chrome / Firefox on iOS) to be installed."
              />
            );
          case 'safariMacOS':
            return (
              <Steps
                steps={[
                  { icon: <Share className="h-4 w-4" />, text: 'Open the File menu in Safari\u2019s menu bar.' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Choose Add to Dock\u2026' },
                  { icon: <Check className="h-4 w-4" />, text: 'Confirm — Mind Organizer will appear in your Dock and Launchpad.' },
                ]}
                note="Requires Safari 17 or later (macOS Sonoma)."
              />
            );
          case 'firefoxAndroid':
            return (
              <Steps
                steps={[
                  { icon: <MoreVertical className="h-4 w-4" />, text: 'Open the Firefox menu (three dots).' },
                  { icon: <Plus className="h-4 w-4" />, text: 'Tap Install or Add to Home screen.' },
                  { icon: <Check className="h-4 w-4" />, text: 'Confirm to add Mind Organizer to your home screen.' },
                ]}
              />
            );
          case 'firefoxDesktop':
            return (
              <p className="text-sm text-muted-foreground">
                Firefox on desktop doesn&apos;t currently support installing
                Progressive Web Apps. Open this page in{' '}
                <a
                  href="https://www.google.com/chrome/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                >
                  Chrome <ExternalLink className="h-3 w-3" />
                </a>{' '}
                or Edge to install Mind Organizer as an app.
              </p>
            );
          case 'other':
          default:
            return (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t identify your browser. Most modern Chromium
                browsers (Chrome, Edge, Brave) let you install Mind Organizer
                from their menu — look for an option called Install or Add to
                Home screen.
              </p>
            );
        }
      })()}
    </>
  );
}

interface Step {
  icon: React.ReactNode;
  text: string;
}

function Steps({
  steps,
  heading,
  note,
}: {
  steps: Step[];
  heading?: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {heading && (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {heading}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {steps.map((step, idx) => (
          <li key={idx} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
              {step.icon}
            </span>
            <span className="text-sm leading-relaxed pt-1">{step.text}</span>
          </li>
        ))}
      </ol>
      {note && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          {note}
        </p>
      )}
    </div>
  );
}
