'use client';

import { usePathname } from 'next/navigation';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceInputFocused } from '@/hooks/useVoiceInputFocused';
import { useVoiceModeShell } from '@/hooks/useVoiceModeShell';
import { shouldShowVoiceFab } from '@/lib/voice-mode';

/** Placeholder speaker control when voice mode is enabled (speech in a later step). */
export function VoiceModeFab() {
  const pathname = usePathname();
  const { searchDialogOpen } = useVoiceModeShell();
  const { voiceMode, loaded } = useVoiceMode();
  const inputFocused = useVoiceInputFocused(loaded && voiceMode);

  if (!loaded || !voiceMode || !shouldShowVoiceFab(pathname, searchDialogOpen)) {
    return null;
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      disabled
      className={cn(
        'fixed bottom-4 right-4 z-[60] h-11 w-11 rounded-full shadow-lg transition-colors duration-200',
        inputFocused
          ? 'border-emerald-500/50 bg-emerald-600/90 text-white shadow-[0_0_12px_3px_rgba(16,185,129,0.22)] ring-1 ring-emerald-500/45'
          : 'border-border'
      )}
      aria-label={
        inputFocused
          ? 'Voice input ready (coming soon)'
          : 'Voice input (coming soon)'
      }
      title={
        inputFocused
          ? 'Voice input ready — click a text field (coming soon)'
          : 'Voice input (coming soon)'
      }
    >
      <Volume2 className={cn('h-5 w-5', inputFocused && 'text-white')} />
    </Button>
  );
}
