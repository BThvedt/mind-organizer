import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch(
    `/jsonapi/node/study_note` +
      `?filter[uid.id][value]=${userUuid}` +
      `&include=field_area,field_subject,field_linked_decks,field_linked_notes,field_linked_todos` +
      `&sort=-changed` +
      `&page[limit]=50`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const body = await request.json();

  const attributes: Record<string, unknown> = {
    title: body.title,
  };
  if (body.fieldBody !== undefined) {
    attributes.field_body = body.fieldBody;
  }

  const relationships: Record<string, unknown> = {};
  if (body.areaUuid) {
    relationships.field_area = {
      data: { type: 'taxonomy_term--area', id: body.areaUuid },
    };
  }
  if (body.subjectUuid) {
    relationships.field_subject = {
      data: { type: 'taxonomy_term--subject', id: body.subjectUuid },
    };
  }
  if (Array.isArray(body.linkedDeckUuids) && body.linkedDeckUuids.length > 0) {
    relationships.field_linked_decks = {
      data: body.linkedDeckUuids.map((id: string) => ({
        type: 'node--flashcard_deck',
        id,
      })),
    };
  }
  if (Array.isArray(body.linkedNoteUuids) && body.linkedNoteUuids.length > 0) {
    relationships.field_linked_notes = {
      data: body.linkedNoteUuids.map((id: string) => ({
        type: 'node--study_note',
        id,
      })),
    };
  }
  if (Array.isArray(body.linkedTodoUuids) && body.linkedTodoUuids.length > 0) {
    relationships.field_linked_todos = {
      data: body.linkedTodoUuids.map((id: string) => ({
        type: 'node--todo_list',
        id,
      })),
    };
  }

  const document = {
    data: {
      type: 'node--study_note',
      attributes,
      ...(Object.keys(relationships).length ? { relationships } : {}),
    },
  };

  const res = await drupalFetch('/jsonapi/node/study_note', {
    method: 'POST',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to create note', detail: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data, { status: 201 });
}
