import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';
import type { JsonApiResource } from '@/lib/json-api';

/** Drupal JSON:API hard-caps `page[limit]` at 50 (`OffsetPage::SIZE_MAX`). */
const PAGE_LIMIT = 50;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const base =
    `/jsonapi/node/flashcard` +
    `?filter[field_deck.id][value]=${id}` +
    `&sort=created` +
    `&page[limit]=${PAGE_LIMIT}`;

  // Paginate through every page so decks larger than one page are fully loaded.
  const allCards: JsonApiResource[] = [];
  let nextPath: string | null = base;

  while (nextPath) {
    const res = await drupalFetch(nextPath);
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch cards' }, { status: res.status });
    }

    const json = await res.json() as {
      data?: JsonApiResource[];
      included?: JsonApiResource[];
      links?: { next?: { href?: string } };
    };

    allCards.push(...(json.data ?? []));

    const nextHref = json.links?.next?.href ?? null;
    if (nextHref) {
      // Strip the Drupal base URL — drupalFetch prepends it
      const DRUPAL_BASE = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL ?? '';
      nextPath = nextHref.startsWith(DRUPAL_BASE)
        ? nextHref.slice(DRUPAL_BASE.length)
        : nextHref;
    } else {
      nextPath = null;
    }
  }

  return NextResponse.json({ data: allCards });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

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
