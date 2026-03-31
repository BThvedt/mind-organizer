import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await drupalFetch(
    `/jsonapi/node/flashcard` +
      `?filter[field_deck.id][value]=${id}` +
      `&sort=created` +
      `&page[limit]=200`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch cards' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  if (!body.front?.trim() || !body.back?.trim()) {
    return NextResponse.json({ error: 'Front and back are required.' }, { status: 400 });
  }

  const document = {
    data: {
      type: 'node--flashcard',
      attributes: {
        title: body.front.trim().slice(0, 100),
        field_front: body.front.trim(),
        field_back: body.back.trim(),
      },
      relationships: {
        field_deck: {
          data: { type: 'node--flashcard_deck', id },
        },
      },
    },
  };

  const res = await drupalFetch('/jsonapi/node/flashcard', {
    method: 'POST',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to create card', detail: err }, { status: res.status });
  }

  return NextResponse.json(await res.json(), { status: 201 });
}
