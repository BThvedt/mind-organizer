'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotebookPen, Search, Layers, FileText, CheckSquare, User, BarChart2, LogOut, Settings, WifiOff, BookOpen, HelpCircle, Share2 } from 'lucide-react';
import { SearchDialog } from '@/components/search-dialog';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
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
  const { isOnline } = useOnlineStatus();

  // Open search with "/" key (unless focus is on an input/textarea)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '/' && !searchOpen && isOnline) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setSearchOpen(true);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [searchOpen, isOnline]);

  const logoContent = (
    <>
      <NotebookPen className="h-5 w-5 text-primary shrink-0" aria-hidden />
      <span className="hidden sm:inline">Mind Organizer</span>
      <span className="sm:hidden">MO</span>
    </>
  );

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="w-full px-6 h-16 flex items-center justify-between">
          {authenticated ? (
            <Link
              href="/dashboard"
              aria-label="Mind Organizer home"
              className="flex items-center gap-2 text-foreground font-semibold text-lg tracking-tight hover:text-foreground/80 transition-colors"
            >
              {logoContent}
            </Link>
          ) : (
            <div
              className="flex items-center gap-2 text-foreground font-semibold text-lg tracking-tight"
              aria-label="Mind Organizer"
            >
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
                <Link
                  href="/dashboard/todos"
                  className={cn(
                    'flex items-center gap-1.5 h-8 rounded-lg px-3 text-sm font-medium transition-colors',
                    pathname.startsWith('/dashboard/todos')
                      ? 'text-foreground bg-muted'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Todos</span>
                </Link>
                <button
                  onClick={() => isOnline && setSearchOpen(true)}
                  disabled={!isOnline}
                  className={cn(
                    "flex items-center gap-2 h-8 rounded-lg border border-border bg-muted/50 px-3 text-sm transition-colors",
                    isOnline
                      ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                      : "opacity-50 cursor-not-allowed"
                  )}
                  aria-label={isOnline ? "Search" : "Search unavailable offline"}
                  title={isOnline ? undefined : "Search requires an internet connection"}
                >
                  {isOnline ? <Search className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">Search</span>
                  {isOnline && (
                    <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-background px-1.5 text-[10px] font-mono">
                      /
                    </kbd>
                  )}
                </button>
              </>
            )}

            {authenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex items-center justify-center h-8 w-8 rounded-full border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="User menu"
                >
                  <User className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 pt-2">
                  <DropdownMenuItem>
                    <Link href="/dashboard/stats" className="flex items-center gap-2 w-full">
                      <BarChart2 className="h-4 w-4" />
                      Study Stats
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/dashboard/areas" className="flex items-center gap-2 w-full">
                      <BookOpen className="h-4 w-4" />
                      Areas
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/dashboard/shared" className="flex items-center gap-2 w-full">
                      <Share2 className="h-4 w-4" />
                      Shared
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/dashboard/profile" className="flex items-center gap-2 w-full">
                      <Settings className="h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/dashboard/help" className="flex items-center gap-2 w-full">
                      <HelpCircle className="h-4 w-4" />
                      Help
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onLogout}
                    className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
