import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/decks/[id]/linked-decks
 * Returns all flashcard_decks linked from this deck's field_linked_decks.
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
    `/jsonapi/node/flashcard_deck/${id}?include=field_linked_decks,field_linked_decks.field_area,field_linked_decks.field_subject`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch deck' }, { status: res.status });
  }

  const data = await res.json();
  const linkedRel = data.data?.relationships?.field_linked_decks?.data ?? [];
  const linkedIds: string[] = Array.isArray(linkedRel) ? linkedRel.map((r: { id: string }) => r.id) : [];
  const included: unknown[] = data.included ?? [];
  const linkedDecks = included
    ? (included as Array<{ type: string; id: string }>).filter(
        (r) => r.type === 'node--flashcard_deck' && linkedIds.includes(r.id)
      )
    : [];

  return NextResponse.json({ data: linkedDecks, included: included ?? [] });
}

/**
 * POST /api/decks/[id]/linked-decks
 * Body: { add?: string[], remove?: string[] }  (deck UUIDs)
 *
 * Uses the JSON:API relationship endpoint on flashcard_deck to add or remove
 * decks from this deck's field_linked_decks without replacing all other links.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: deckId } = await params;
  const body = await request.json();
  const add: string[] = Array.isArray(body.add) ? body.add : [];
  const remove: string[] = Array.isArray(body.remove) ? body.remove : [];

  const toRef = (relatedId: string) => [{ type: 'node--flashcard_deck', id: relatedId }];

  const addCalls = add.map((relatedId) =>
    drupalFetch(
      `/jsonapi/node/flashcard_deck/${deckId}/relationships/field_linked_decks`,
      { method: 'POST', body: JSON.stringify({ data: toRef(relatedId) }) }
    )
  );

  const removeCalls = remove.map((relatedId) =>
    drupalFetch(
      `/jsonapi/node/flashcard_deck/${deckId}/relationships/field_linked_decks`,
      { method: 'DELETE', body: JSON.stringify({ data: toRef(relatedId) }) }
    )
  );

  const results = await Promise.all([...addCalls, ...removeCalls]);
  const failed = results.filter((r) => !r.ok && r.status !== 204 && r.status !== 200);

  if (failed.length > 0) {
    return NextResponse.json({ error: 'Some link updates failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
