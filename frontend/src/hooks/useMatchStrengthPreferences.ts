'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  MATCH_STRENGTH_DEFAULT,
  preferencesFromProfile,
  type MatchStrengthPreferences,
} from '@/lib/match-strength';

type PreferencesState = MatchStrengthPreferences & { loaded: boolean };

const INITIAL: PreferencesState = {
  linkMatchStrength: MATCH_STRENGTH_DEFAULT,
  askMatchStrength: MATCH_STRENGTH_DEFAULT,
  loaded: false,
};

let cache: PreferencesState | null = null;
let inflight: Promise<PreferencesState> | null = null;

async function fetchPreferences(): Promise<PreferencesState> {
  const res = await fetch('/api/auth/profile');
  if (!res.ok) {
    return { ...INITIAL, loaded: true };
  }
  const data = await res.json();
  const prefs = preferencesFromProfile(data);
  return { ...prefs, loaded: true };
}

function loadPreferences(force = false): Promise<PreferencesState> {
  if (!force && cache?.loaded) {
    return Promise.resolve(cache);
  }
  if (!force && inflight) {
    return inflight;
  }
  inflight = fetchPreferences()
    .then((next) => {
      cache = next;
      return next;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Cached match-strength defaults from the authenticated user's Drupal profile. */
export function useMatchStrengthPreferences() {
  const [prefs, setPrefs] = useState<PreferencesState>(cache ?? INITIAL);

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((next) => {
      if (!cancelled) setPrefs(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await loadPreferences(true);
    setPrefs(next);
    return next;
  }, []);

  return {
    linkDefault: prefs.linkMatchStrength,
    askDefault: prefs.askMatchStrength,
    loaded: prefs.loaded,
    refresh,
  };
}

/** Call after saving preferences so other components pick up the new defaults. */
export function invalidateMatchStrengthPreferencesCache() {
  cache = null;
}
