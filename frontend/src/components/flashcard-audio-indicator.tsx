'use client';

import { useState, useRef, useCallback } from 'react';
import { Volume2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { userFacingMessageForApiError } from '@/lib/api-client-messages';

interface FlashcardAudioIndicatorProps {
  cardId: string;
  audioUuid: string | null;
  isMissing: boolean;
  face: 'front' | 'back';
  onAudioChanged?: (face: 'front' | 'back', newAudioUuid: string | null) => void;
  className?: string;
}

/**
 * Audio play / generate / delete widget for one face of a flashcard.
 */
export function FlashcardAudioIndicator({
  cardId,
  audioUuid,
  isMissing,
  face,
  onAudioChanged,
  className,
}: FlashcardAudioIndicatorProps) {
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [genError, setGenError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGenError('');
    setShowConfirm(false);
    try {
      const res = await fetch(`/api/cards/${cardId}/audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ face }),
      });
      if (res.ok) {
        const data = await res.json();
        onAudioChanged?.(face, data.uuid);
      } else {
        const data = await res.json().catch(() => ({}));
        setGenError(userFacingMessageForApiError(res, data, 'Failed to generate audio.'));
      }
    } catch {
      setGenError('Network error while generating audio.');
    } finally {
      setGenerating(false);
    }
  }, [cardId, face, onAudioChanged]);

  const handlePlay = useCallback(() => {
    if (!audioUuid) return;
    setPlaying(true);
    const audio = audioRef.current;
    if (audio) {
      audio.src = `/api/media/${audioUuid}/file`;
      audio.play().catch(() => setPlaying(false));
      audio.onended = () => setPlaying(false);
    }
  }, [audioUuid]);

  const handleDelete = useCallback(async () => {
    if (!audioUuid) return;
    try {
      const res = await fetch(`/api/cards/${cardId}/audio?face=${face}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onAudioChanged?.(face, null);
      }
    } catch {}
  }, [cardId, audioUuid, face, onAudioChanged]);

  const handleClearMissing = useCallback(() => {
    onAudioChanged?.(face, null);
  }, [face, onAudioChanged]);

  // State 3: audio exists but is missing (soft-deleted).
  if (audioUuid && isMissing) {
    return (
      <span
        title='Audio file deleted - click to clear'
        aria-label='Audio file deleted'
        onClick={(e) => { e.stopPropagation(); handleClearMissing(); }}
        className={cn(
          'inline-flex shrink-0 items-center text-destructive cursor-pointer',
          'rounded-md p-1 hover:bg-destructive/10 transition-colors',
          className,
        )}
      >
        <Volume2 className='h-3.5 w-3.5 line-through' />
      </span>
    );
  }

  return (
    <>
      <audio ref={audioRef} className='hidden' />
      {generating ? (
        <span className='inline-flex shrink-0 items-center text-muted-foreground px-1'>
          <svg className='h-3.5 w-3.5 animate-spin' viewBox='0 0 24 24' fill='none'>
            <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
            <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z' />
          </svg>
        </span>
      ) : showConfirm ? (
        <span className='inline-flex items-center gap-1 text-[11px] text-muted-foreground'>
          <button
            onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
            className='rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 transition-colors'
            aria-label='Confirm generate audio'
          >Generate?</button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowConfirm(false); setGenError(''); }}
            className='rounded px-1 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            aria-label='Cancel'
          ><X className='h-3 w-3' /></button>
        </span>
      ) : audioUuid ? (
        <span className='inline-flex items-center gap-0.5'>
          <button
            onClick={(e) => { e.stopPropagation(); handlePlay(); }}
            className={cn(
              'rounded-md p-1 transition-colors',
              playing ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            aria-label={playing ? 'Stop audio' : 'Play audio'}
            title={playing ? 'Playing...' : 'Play audio'}
          ><Volume2 className='h-3.5 w-3.5' /></button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            className='rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all'
            aria-label='Delete audio' title='Delete audio file'
          ><X className='h-3 w-3' /></button>
        </span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowConfirm(true); setGenError(''); }}
          className={cn(
            'rounded-md p-1 text-muted-foreground transition-all',
            'opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted',
            className,
          )}
          aria-label={face === 'front' ? 'Generate front audio' : 'Generate back audio'}
          title={face === 'front' ? 'Generate front audio' : 'Generate back audio'}
        ><Volume2 className='h-3.5 w-3.5' /></button>
      )}
      {genError && (
        <span className='text-[10px] text-destructive ml-1' title={genError}>!</span>
      )}
    </>
  );
}
