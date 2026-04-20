'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';

type AuthValue = boolean | null;

type AuthContextType = {
  authenticated: AuthValue;
  markSignedOut: () => void;
  /** Re-read session after login / cookie change (initial fetch runs once on app load). */
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

function parseMePayload(r: Response): Promise<{ authenticated?: boolean }> {
  return r.json();
}

/**
 * Single `/api/auth/me` check for the whole app. Per-page hooks used to remount
 * on client navigations and could see transient false → `/` → `/dashboard` bounce.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<AuthValue>(null);
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const markSignedOut = useCallback(() => {
    setAuthenticated(false);
  }, []);

  const applyMeResponse = useCallback(async (r: Response) => {
    if (!r.ok) {
      setAuthenticated(true);
      return;
    }
    const data = await parseMePayload(r);
    if (data.authenticated === false) {
      setAuthenticated(false);
    } else {
      setAuthenticated(true);
    }
  }, []);

  const refreshSession = useCallback((): Promise<void> => {
    return fetch('/api/auth/me')
      .then((r) => applyMeResponse(r))
      .catch(() => {
        setAuthenticated(true);
      });
  }, [applyMeResponse]);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/me')
      .then(async (r) => {
        if (cancelled) return;
        await applyMeResponse(r);
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [applyMeResponse]);

  useEffect(() => {
    if (authenticated !== false) return;
    if (!pathname?.startsWith('/dashboard')) return;
    routerRef.current.replace('/');
  }, [authenticated, pathname]);

  const value = useMemo(
    () => ({ authenticated, markSignedOut, refreshSession }),
    [authenticated, markSignedOut, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx.authenticated;
}

export function useMarkSignedOut(): () => void {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useMarkSignedOut must be used within AuthProvider');
  }
  return ctx.markSignedOut;
}

export function useRefreshSession(): () => Promise<void> {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useRefreshSession must be used within AuthProvider');
  }
  return ctx.refreshSession;
}
