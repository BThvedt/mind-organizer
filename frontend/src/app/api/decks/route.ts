import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch(
    `/jsonapi/node/flashcard_deck` +
      `?filter[uid.id][value]=${userUuid}` +
      `&include=field_area,field_subject` +
      `&sort=-created` +
      `&page[limit]=50`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch decks' }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Build JSON:API document
  const attributes: Record<string, unknown> = {
    title: body.title,
  };
  if (body.description) {
    attributes.body = { value: body.description, format: 'plain_text' };
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

  const document = {
    data: {
      type: 'node--flashcard_deck',
      attributes,
      ...(Object.keys(relationships).length ? { relationships } : {}),
    },
  };

  const res = await drupalFetch('/jsonapi/node/flashcard_deck', {
    method: 'POST',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to create deck', detail: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data, { status: 201 });
}
