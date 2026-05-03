import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * PATCH /api/todos/[id]/links
 * Body: { linkedDeckUuids?: string[], linkedNoteUuids?: string[], linkedTodoUuids?: string[] }
 *
 * Replaces whichever relationship fields are present in the body. Omitted
 * fields are left untouched. Intended for use by the combined Link dialog on
 * the todos page — the todo_list owns all three linked_* fields directly.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const relationships: Record<string, unknown> = {};

  if ('linkedDeckUuids' in body) {
    relationships.field_linked_decks = {
      data: Array.isArray(body.linkedDeckUuids)
        ? body.linkedDeckUuids.map((uid: string) => ({ type: 'node--flashcard_deck', id: uid }))
        : [],
    };
  }
  if ('linkedNoteUuids' in body) {
    relationships.field_linked_notes = {
      data: Array.isArray(body.linkedNoteUuids)
        ? body.linkedNoteUuids.map((uid: string) => ({ type: 'node--study_note', id: uid }))
        : [],
    };
  }
  if ('linkedTodoUuids' in body) {
    relationships.field_linked_todos = {
      data: Array.isArray(body.linkedTodoUuids)
        ? body.linkedTodoUuids.map((uid: string) => ({ type: 'node--todo_list', id: uid }))
        : [],
    };
  }

  if (Object.keys(relationships).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const res = await drupalFetch(`/jsonapi/node/todo_list/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'node--todo_list',
        id,
        relationships,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: 'Failed to update todo links', detail: err },
      { status: res.status },
    );
  }

  return NextResponse.json(await res.json());
}
