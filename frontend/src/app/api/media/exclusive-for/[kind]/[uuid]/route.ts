import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

const ALLOWED_KINDS = new Set(['note', 'deck', 'todo_list']);

/**
 * GET /api/media/exclusive-for/[kind]/[uuid]
 *
 * Returns the live media assets that would become orphaned if the given
 * entity were deleted right now (i.e. only this entity references them).
 *
 * `kind` is one of `note`, `deck`, `todo_list`. For decks the backend also
 * walks every flashcard in the deck, since those get cascade-deleted.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ kind: string; uuid: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { kind, uuid } = await params;
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  }

  const res = await drupalFetch(`/api/study/media/exclusive-for/${kind}/${uuid}`);
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Failed to fetch exclusive media', detail: text },
      { status: res.status }
    );
  }
  return NextResponse.json(await res.json());
}
