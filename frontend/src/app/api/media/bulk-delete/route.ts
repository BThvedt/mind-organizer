import { NextRequest, NextResponse } from 'next/server';
import { drupalBaseUrl, getBearerToken } from '@/lib/drupal';

/**
 * POST /api/media/bulk-delete
 *
 * Body: `{ "uuids": ["…", "…"] }`. Forwards to Drupal's bulk soft-delete
 * (PATCH internally to match the existing single-asset semantics) and
 * returns `{ deleted: [...], skipped: [...] }`.
 *
 * Used by the entity-delete confirmation flow when the user opts in to
 * removing media files exclusively used by the deleted entity. Mounted
 * as POST here for friendlier client-side semantics.
 */
export async function POST(request: NextRequest) {
  const token = await getBearerToken();
  if (!token) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const body = await request.text();

  const res = await fetch(`${drupalBaseUrl()}/api/study/media/bulk-delete`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: 'Bulk delete failed', detail: text };
  }
  return NextResponse.json(payload, { status: res.status });
}
