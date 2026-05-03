import Link from 'next/link';
import { Brain } from 'lucide-react';

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-screen-xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-foreground hover:text-foreground/80"
          >
            <Brain className="h-5 w-5 text-primary" />
            <span>Mind Organizer</span>
          </Link>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Shared link
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-screen-xl px-4 sm:px-6 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p>This page was shared from Mind Organizer.</p>
          <Link href="/" className="hover:text-foreground">
            Create your own account →
          </Link>
        </div>
      </footer>
    </div>
  );
}
