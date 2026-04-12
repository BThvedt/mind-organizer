import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await drupalFetch(
    `/jsonapi/node/study_note/${id}?include=field_area,field_subject,field_linked_decks,field_linked_notes`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Note not found' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const attributes: Record<string, unknown> = {};
  if (body.title !== undefined) attributes.title = body.title;
  if (body.fieldBody !== undefined) attributes.field_body = body.fieldBody;

  const relationships: Record<string, unknown> = {};
  if ('areaUuid' in body) {
    relationships.field_area = {
      data: body.areaUuid
        ? { type: 'taxonomy_term--area', id: body.areaUuid }
        : null,
    };
  }
  if ('subjectUuid' in body) {
    relationships.field_subject = {
      data: body.subjectUuid
        ? { type: 'taxonomy_term--subject', id: body.subjectUuid }
        : null,
    };
  }
  if ('linkedDeckUuids' in body) {
    relationships.field_linked_decks = {
      data: Array.isArray(body.linkedDeckUuids)
        ? body.linkedDeckUuids.map((id: string) => ({ type: 'node--flashcard_deck', id }))
        : [],
    };
  }
  if ('linkedNoteUuids' in body) {
    relationships.field_linked_notes = {
      data: Array.isArray(body.linkedNoteUuids)
        ? body.linkedNoteUuids.map((id: string) => ({ type: 'node--study_note', id }))
        : [],
    };
  }

  const document = {
    data: {
      type: 'node--study_note',
      id,
      attributes,
      ...(Object.keys(relationships).length ? { relationships } : {}),
    },
  };

  const res = await drupalFetch(`/jsonapi/node/study_note/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: 'Failed to update note', detail: err },
      { status: res.status }
    );
  }

  return NextResponse.json(await res.json());
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await drupalFetch(`/jsonapi/node/study_note/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to delete note' }, { status: res.status });
  }

  return new NextResponse(null, { status: 204 });
}
