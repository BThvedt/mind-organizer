'use client';

import { useEffect, useState } from 'react';
import { VOICE_INPUT_SELECTOR } from '@/lib/voice-mode';

function isVoiceInputFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.closest(VOICE_INPUT_SELECTOR) !== null;
}

/** True when a `[data-voice-input]` field currently has focus. */
export function useVoiceInputFocused(active: boolean) {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!active) {
      setFocused(false);
      return;
    }

    function onFocusIn(e: FocusEvent) {
      const target = e.target;
      if (target instanceof HTMLElement && target.closest(VOICE_INPUT_SELECTOR)) {
        setFocused(true);
      }
    }

    function onFocusOut() {
      requestAnimationFrame(() => {
        setFocused(isVoiceInputFocused());
      });
    }

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
    };
  }, [active]);

  return focused;
}
