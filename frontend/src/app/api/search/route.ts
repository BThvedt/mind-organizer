import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/search?q=...&type=all|note|deck|todo&area=<uuid>&subject=<uuid>
 * Proxies to the custom Drupal search endpoint.
 */
export async function GET(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const type = searchParams.get('type') ?? 'all';
  const area = searchParams.get('area') ?? '';
  const subject = searchParams.get('subject') ?? '';

  const params = new URLSearchParams({ q, type });
  if (area) params.set('area', area);
  if (subject) params.set('subject', subject);

  const res = await drupalFetch(`/api/study/search?${params.toString()}`);

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Search failed', detail: text },
      { status: res.status },
    );
  }

  return NextResponse.json(await res.json());
}
