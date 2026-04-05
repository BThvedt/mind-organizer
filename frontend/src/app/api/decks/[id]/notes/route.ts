import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/decks/[id]/notes
 * Returns all study_notes that have this deck in their field_linked_decks.
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
    `/jsonapi/node/study_note` +
      `?filter[field_linked_decks.id][value]=${id}` +
      `&filter[uid.id][value]=${userUuid}` +
      `&include=field_area,field_subject` +
      `&sort=-changed` +
      `&page[limit]=50`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch linked notes' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}

/**
 * POST /api/decks/[id]/notes
 * Body: { add?: string[], remove?: string[] }  (note UUIDs)
 *
 * Uses the JSON:API relationship endpoint on study_note to add or remove
 * this deck from each note's field_linked_decks without touching other links.
 *   POST   /jsonapi/node/study_note/{noteId}/relationships/field_linked_decks  → adds
 *   DELETE /jsonapi/node/study_note/{noteId}/relationships/field_linked_decks  → removes specific
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: deckId } = await params;
  const body = await request.json();
  const add: string[] = Array.isArray(body.add) ? body.add : [];
  const remove: string[] = Array.isArray(body.remove) ? body.remove : [];

  const deckRef = [{ type: 'node--flashcard_deck', id: deckId }];

  const addCalls = add.map((noteId) =>
    drupalFetch(
      `/jsonapi/node/study_note/${noteId}/relationships/field_linked_decks`,
      { method: 'POST', body: JSON.stringify({ data: deckRef }) }
    )
  );

  const removeCalls = remove.map((noteId) =>
    drupalFetch(
      `/jsonapi/node/study_note/${noteId}/relationships/field_linked_decks`,
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
