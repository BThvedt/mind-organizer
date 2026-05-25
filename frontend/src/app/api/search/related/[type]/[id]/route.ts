import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/search/related/[type]/[id]?limit=<n>
 *
 * Pass-through to Drupal's `GET /api/search/related/{type}/{uuid}`.
 *
 * `type` is one of "note" | "deck" | "todo" — the regex on the Drupal
 * route rejects anything else with a 404, so we forward without an extra
 * client-side check. Same for the UUID format.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { type, id } = await params;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const thresholdParam = request.nextUrl.searchParams.get('score_threshold');
  const qs = new URLSearchParams();
  if (limitParam) qs.set('limit', limitParam);
  if (thresholdParam) qs.set('score_threshold', thresholdParam);
  const query = qs.toString() ? `?${qs.toString()}` : '';

  const res = await drupalFetch(
    `/api/search/related/${encodeURIComponent(type)}/${encodeURIComponent(id)}${query}`,
  );

  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return NextResponse.json(
      { error: 'Related lookup failed', detail },
      { status: res.status },
    );
  }

  return NextResponse.json(await res.json());
}
