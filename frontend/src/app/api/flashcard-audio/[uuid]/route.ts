import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

type Params = { params: Promise<{ uuid: string }> };

/**
 * DELETE /api/flashcard-audio/[uuid]
 *
 * Soft-deletes a flashcard audio asset by its media UUID.
 * Proxies directly to Drupal's DELETE /api/study/flashcard-audio/{uuid}/delete.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { uuid } = await params;

  const delRes = await drupalFetch(`/api/study/flashcard-audio/${uuid}/delete`, {
    method: 'DELETE',
  });

  if (!delRes.ok) {
    const err = await delRes.json().catch(() => ({ error: 'Delete failed' }));
    return NextResponse.json(err, { status: delRes.status });
  }

  return NextResponse.json({ status: 'deleted' });
}