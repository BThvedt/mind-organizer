import { NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/media
 *
 * Lists the current user's non-deleted media assets.
 */
export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch('/api/study/media');
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Failed to list media', detail: text },
      { status: res.status }
    );
  }
  return NextResponse.json(await res.json());
}
