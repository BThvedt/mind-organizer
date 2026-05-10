import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/media/[uuid]/usage
 *
 * Returns the entities (notes, flashcards) that reference this asset.
 * Owner-only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const { uuid } = await params;
  const res = await drupalFetch(`/api/study/media/${uuid}/usage`);
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Failed to fetch usage', detail: text },
      { status: res.status }
    );
  }
  return NextResponse.json(await res.json());
}
