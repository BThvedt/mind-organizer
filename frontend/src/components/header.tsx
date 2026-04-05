'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { BookOpen, Search, Layers, FileText } from 'lucide-react';
import { SearchDialog } from '@/components/search-dialog';
import { cn } from '@/lib/utils';

interface HeaderProps {
  authenticated: boolean;
  onSignIn: () => void;
  onSignUp: () => void;
  onLogout: () => void;
}

export function Header({ authenticated, onSignIn, onSignUp, onLogout }: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  // Open search with "/" key (unless focus is on an input/textarea)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '/' && !searchOpen) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setSearchOpen(true);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [searchOpen]);

  const logoContent = (
    <>
      <BookOpen className="h-5 w-5 text-primary" />
      <span>StudyApp</span>
    </>
  );

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          {authenticated ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-foreground font-semibold text-lg tracking-tight hover:text-foreground/80 transition-colors"
            >
              {logoContent}
            </Link>
          ) : (
            <div className="flex items-center gap-2 text-foreground font-semibold text-lg tracking-tight">
              {logoContent}
            </div>
          )}

          <nav className="flex items-center gap-2">
            {authenticated && (
              <>
                <Link
                  href="/dashboard/decks"
                  className={cn(
                    'flex items-center gap-1.5 h-8 rounded-lg px-3 text-sm font-medium transition-colors',
                    pathname.startsWith('/dashboard/decks')
                      ? 'text-foreground bg-muted'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Decks</span>
                </Link>
                <Link
                  href="/dashboard/notes"
                  className={cn(
                    'flex items-center gap-1.5 h-8 rounded-lg px-3 text-sm font-medium transition-colors',
                    pathname.startsWith('/dashboard/notes')
                      ? 'text-foreground bg-muted'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Notes</span>
                </Link>
                <button
                  onClick={() => setSearchOpen(true)}
                  className="flex items-center gap-2 h-8 rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Search"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Search</span>
                  <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-background px-1.5 text-[10px] font-mono">
                    /
                  </kbd>
                </button>
              </>
            )}

            {authenticated ? (
              <Button variant="outline" size="sm" onClick={onLogout}>
                Log out
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={onSignIn}>
                  Sign in
                </Button>
                <Button size="sm" onClick={onSignUp}>
                  Sign up
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
