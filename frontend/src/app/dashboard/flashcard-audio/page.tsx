'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Volume2, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioCardContext {
  cardUuid: string;
  cardTitle: string;
  face: 'front' | 'back';
  deckUuid: string;
  deckTitle: string;
}

interface AudioAsset {
  uuid: string;
  originalFilename: string;
  description: string;
  fileSize: number;
  created: number;
  card: AudioCardContext | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function FlashcardAudioPage() {
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  const [assets, setAssets] = useState<AudioAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/flashcard-audio')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load audio (HTTP ' + res.status + ')');
        return (await res.json()) as { data: AudioAsset[] };
      })
      .then((body) => {
        if (cancelled) return;
        setAssets(body.data ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [authenticated]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  async function handleDelete(asset: AudioAsset) {
    setDeleteError(null);
    try {
      const res = await fetch('/api/flashcard-audio/' + asset.uuid, {
        method: 'DELETE',
      });
      if (res.ok) {
        setAssets((prev) => (prev ? prev.filter((a) => a.uuid !== asset.uuid) : prev));
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data?.error || 'Failed to delete audio file.');
      }
    } catch {
      setDeleteError('Network error while deleting.');
    }
  }

  function handlePlay(uuid: string) {
    if (playing === uuid) {
      setPlaying(null);
      return;
    }
    setPlaying(uuid);
    const audio = new Audio('/api/media/' + uuid + '/file');
    audio.addEventListener('ended', () => setPlaying(null));
    audio.play().catch(() => setPlaying(null));
  }

  if (!authenticated) return null;

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />
      <main className='mx-auto max-w-5xl px-6 pt-28 pb-16'>
        <div className='mb-6 flex items-start gap-3'>
          <Button variant='ghost' size='icon-sm' nativeButton={false}
            render={<Link href='/dashboard' />} className='mt-1'>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='text-3xl font-bold tracking-tight text-foreground'>Flashcard Audio</h1>
            <p className='text-sm text-muted-foreground mt-1'>TTS-generated audio files for your flashcard faces.</p>
          </div>
        </div>

        {deleteError && (
          <p className="text-sm text-destructive mb-4">{deleteError}</p>
        )}

        {loading ? (
          <div className='flex items-center justify-center py-16'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : error ? (
          <p className='text-sm text-destructive'>{error}</p>
        ) : !assets || assets.length === 0 ? (
          <p className='text-sm text-muted-foreground py-8'>
            No audio files yet. Generate audio from a flashcard&apos;s sound icon.
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b border-border text-left text-muted-foreground'>
                  <th className='py-3 pr-4 font-medium'>Audio</th>
                  <th className='py-3 pr-4 font-medium'>Deck</th>
                  <th className='py-3 pr-4 font-medium'>Card</th>
                  <th className='py-3 pr-4 font-medium'>Face</th>
                  <th className='py-3 pr-4 font-medium'>Size</th>
                  <th className='py-3 pr-4 font-medium'>Created</th>
                  <th className='py-3 pr-2 font-medium text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.uuid} className='border-b border-border/50 hover:bg-muted/30 transition-colors'>
                    <td className='py-3 pr-4'>
                      <button onClick={() => handlePlay(asset.uuid)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
                          playing === asset.uuid ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                        )}
                        aria-label={playing === asset.uuid ? 'Stop' : 'Play'}>
                        <Volume2 className={cn('h-4 w-4', playing === asset.uuid && 'animate-pulse')} />
                        <span className='text-xs truncate max-w-[180px]'>{asset.originalFilename}</span>
                      </button>
                    </td>
                    <td className='py-3 pr-4 text-muted-foreground'>
                      {asset.card?.deckTitle ? (
                        <Link href={'/dashboard/decks/' + asset.card.deckUuid} className='hover:text-foreground transition-colors'>{asset.card.deckTitle}</Link>
                      ) : (<span className='italic'>--</span>)}
                    </td>
                    <td className='py-3 pr-4 text-muted-foreground'>
                      {asset.card ? (
                        <Link href={'/dashboard/decks/' + asset.card.deckUuid} className='hover:text-foreground transition-colors'>{asset.card.cardTitle}</Link>
                      ) : (<span className='italic'>--</span>)}
                    </td>
                    <td className='py-3 pr-4'>
                      <span className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        asset.card?.face === 'front' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                      )}>{asset.card?.face === 'front' ? 'Question' : 'Answer'}</span>
                    </td>
                    <td className='py-3 pr-4 text-muted-foreground tabular-nums'>{formatBytes(asset.fileSize)}</td>
                    <td className='py-3 pr-4 text-muted-foreground tabular-nums'>{formatDate(asset.created)}</td>
                    <td className='py-3 pr-2'>
                      <div className='flex justify-end'>
                        <button onClick={() => handleDelete(asset)}
                          className='rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
                          aria-label='Delete audio file' title='Delete this audio file'>
                          <Trash2 className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
