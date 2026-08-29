import { NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/flashcard-audio
 *
 * Lists all TTS-generated audio files belonging to the current user,
 * with card and deck context for display on the Flashcard Audio page.
 * Proxies to Drupal's GET /api/study/flashcard-audio.
 */
export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch('/api/study/flashcard-audio');

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Failed to fetch flashcard audio', detail: text },
      { status: res.status },
    );
  }

  return NextResponse.json(await res.json());
}