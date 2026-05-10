import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/media/search?q=...&type=image,audio,file
 *
 * Forwards a substring search to Drupal's media search endpoint.
 * Returns `{ data: [] }` for queries shorter than 2 chars (Drupal also
 * enforces this — sending it through keeps the contract symmetric).
 */
export async function GET(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const params = new URLSearchParams();
  const q = request.nextUrl.searchParams.get('q');
  const type = request.nextUrl.searchParams.get('type');
  if (q !== null) params.set('q', q);
  if (type !== null) params.set('type', type);

  const res = await drupalFetch(`/api/study/media/search?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Media search failed', detail: text },
      { status: res.status },
    );
  }
  return NextResponse.json(await res.json());
}
