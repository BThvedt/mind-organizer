import { NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/media/broken
 *
 * Returns the soft-deleted asset uuids belonging to the current user, so
 * the frontend can mark broken `/api/media/<uuid>` references in note bodies.
 */
export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const res = await drupalFetch('/api/study/media/broken');
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Failed to fetch broken media', detail: text },
      { status: res.status }
    );
  }
  return NextResponse.json(await res.json());
}
