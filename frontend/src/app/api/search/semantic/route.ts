import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * POST /api/search/semantic
 *
 * Body: { query: string, types?: string[], limit?: number }
 *
 * Forwards to the custom Drupal endpoint /api/search/semantic. Returns the
 * same JSON shape as /api/search (keyword) with an extra `score` field on
 * each result so the search dialog can render provenance / similarity %.
 */
export async function POST(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const res = await drupalFetch('/api/search/semantic', {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return NextResponse.json(
      { error: 'Semantic search failed', detail },
      { status: res.status },
    );
  }

  return NextResponse.json(await res.json());
}
