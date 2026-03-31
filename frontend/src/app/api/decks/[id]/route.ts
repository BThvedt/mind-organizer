import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await drupalFetch(
    `/jsonapi/node/flashcard_deck/${id}?include=field_area,field_subject`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Deck not found' }, { status: res.status });
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
  if (body.description !== undefined) {
    attributes.body = body.description
      ? { value: body.description, format: 'plain_text' }
      : null;
  }

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

  const document = {
    data: {
      type: 'node--flashcard_deck',
      id,
      attributes,
      ...(Object.keys(relationships).length ? { relationships } : {}),
    },
  };

  const res = await drupalFetch(`/jsonapi/node/flashcard_deck/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to update deck', detail: err }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
