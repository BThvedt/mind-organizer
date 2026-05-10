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
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const body = await request.json();

  // Build JSON:API document
  const attributes: Record<string, unknown> = {
    title: body.title,
  };
  if (body.description) {
    attributes.body = { value: body.description, format: 'plain_text' };
  }

  const relationships: Record<string, unknown> = {};
  if (Array.isArray(body.areaUuids) && body.areaUuids.length > 0) {
    relationships.field_area = {
      data: body.areaUuids.map((id: string) => ({
        type: 'taxonomy_term--area',
        id,
      })),
    };
  }
  if (Array.isArray(body.subjectUuids) && body.subjectUuids.length > 0) {
    relationships.field_subject = {
      data: body.subjectUuids.map((id: string) => ({
        type: 'taxonomy_term--subject',
        id,
      })),
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
