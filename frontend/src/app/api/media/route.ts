import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/media
 *
 * Lists the current user's non-deleted media assets.
 *
 * Optional `?type=image,audio` (default) / `?type=file` query parameter
 * is forwarded to Drupal so the Media and Files pages can read from the
 * same store without seeing each other's rows.
 */
export async function GET(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get('type');
  const drupalPath =
    '/api/study/media' + (type ? `?type=${encodeURIComponent(type)}` : '');

  const res = await drupalFetch(drupalPath);
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Failed to list media', detail: text },
      { status: res.status }
    );
  }
  return NextResponse.json(await res.json());
}
