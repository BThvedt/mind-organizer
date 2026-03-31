import { NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/cards
 * Returns all flashcards owned by the current user.
 * Lightweight — only fetches id + field_deck relationship for counting.
 */
export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch(
    `/jsonapi/node/flashcard` +
      `?filter[uid.id][value]=${userUuid}` +
      `&fields[node--flashcard]=id,field_deck` +
      `&page[limit]=500`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch cards' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
