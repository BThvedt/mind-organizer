import { NextRequest, NextResponse } from 'next/server';
import { drupalBaseUrl, getBearerToken } from '@/lib/drupal';
import { streamMediaFromDrupal } from '@/lib/media-proxy';

/**
 * GET /api/media/[uuid]
 *
 * Streams the media file from Drupal. Backwards-compatible with notes
 * that were saved before we started appending a `/<filename>` suffix —
 * the canonical URL today is `/api/media/[uuid]/[filename]`.
 *
 * Supports an optional ?share_token=... for public share-page access;
 * Drupal handles authorization.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  return streamMediaFromDrupal(request, uuid);
}

/**
 * DELETE /api/media/[uuid]
 *
 * Soft-deletes the asset (sets deleted=1 in Drupal, removes the S3 object).
 * Drupal's actual route is PATCH /api/study/media/{uuid}/delete; we expose
 * it as DELETE on the proxy for friendlier client-side semantics.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const token = await getBearerToken();
  if (!token) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await fetch(`${drupalBaseUrl()}/api/study/media/${uuid}/delete`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: 'Delete failed', detail: text };
  }
  return NextResponse.json(body, { status: res.status });
}
