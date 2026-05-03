import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/decks/[id]/todos
 * Returns all todo_list nodes that have this deck in their field_linked_decks.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch(
    `/jsonapi/node/todo_list` +
      `?filter[field_linked_decks.id][value]=${id}` +
      `&filter[uid.id][value]=${userUuid}` +
      `&include=field_area,field_subject` +
      `&sort=-changed` +
      `&page[limit]=50`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch linked todos' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}

/**
 * POST /api/decks/[id]/todos
 * Body: { add?: string[], remove?: string[] }  (todo UUIDs)
 *
 * Uses the JSON:API relationship endpoint on todo_list to add/remove this
 * deck from each todo's field_linked_decks without touching other links.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id: deckId } = await params;
  const body = await request.json();
  const add: string[] = Array.isArray(body.add) ? body.add : [];
  const remove: string[] = Array.isArray(body.remove) ? body.remove : [];

  const deckRef = [{ type: 'node--flashcard_deck', id: deckId }];

  const addCalls = add.map((todoId) =>
    drupalFetch(
      `/jsonapi/node/todo_list/${todoId}/relationships/field_linked_decks`,
      { method: 'POST', body: JSON.stringify({ data: deckRef }) }
    )
  );

  const removeCalls = remove.map((todoId) =>
    drupalFetch(
      `/jsonapi/node/todo_list/${todoId}/relationships/field_linked_decks`,
      { method: 'DELETE', body: JSON.stringify({ data: deckRef }) }
    )
  );

  const results = await Promise.all([...addCalls, ...removeCalls]);
  const failed = results.filter((r) => !r.ok && r.status !== 204 && r.status !== 200);

  if (failed.length > 0) {
    return NextResponse.json({ error: 'Some link updates failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
