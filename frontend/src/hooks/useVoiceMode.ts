'use client';

import { useCallback, useEffect, useState } from 'react';
import { voiceModeFromProfile } from '@/lib/voice-mode';

type VoiceModeState = { voiceMode: boolean; loaded: boolean };

const INITIAL: VoiceModeState = { voiceMode: false, loaded: false };

let cache: VoiceModeState | null = null;
let inflight: Promise<VoiceModeState> | null = null;

async function fetchVoiceMode(): Promise<VoiceModeState> {
  const res = await fetch('/api/auth/profile');
  if (!res.ok) {
    return { voiceMode: false, loaded: true };
  }
  const data = await res.json();
  return { voiceMode: voiceModeFromProfile(data), loaded: true };
}

function loadVoiceMode(force = false): Promise<VoiceModeState> {
  if (!force && cache?.loaded) {
    return Promise.resolve(cache);
  }
  if (!force && inflight) {
    return inflight;
  }
  inflight = fetchVoiceMode()
    .then((next) => {
      cache = next;
      return next;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Cached voice-mode preference from the authenticated user's Drupal profile. */
export function useVoiceMode() {
  const [state, setState] = useState<VoiceModeState>(cache ?? INITIAL);

  useEffect(() => {
    let cancelled = false;
    loadVoiceMode().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await loadVoiceMode(true);
    setState(next);
    return next;
  }, []);

  return {
    voiceMode: state.voiceMode,
    loaded: state.loaded,
    refresh,
  };
}

/** Call after saving voice mode in settings so other components pick up the change. */
export function invalidateVoiceModeCache() {
  cache = null;
}
