import { NextRequest, NextResponse } from 'next/server';
import { drupalBaseUrl, getBearerToken } from './drupal';

/**
 * Streams a media asset from Drupal back to the browser, attaching the
 * current session's bearer token (if any) and forwarding an optional
 * ?share_token=... query for public share-page access.
 *
 * Used by both `/api/media/[uuid]` and `/api/media/[uuid]/[filename]` —
 * the trailing filename is purely cosmetic (helps the markdown renderer
 * detect audio via extension and gives DevTools a meaningful name).
 */
export async function streamMediaFromDrupal(
  request: NextRequest,
  uuid: string
): Promise<NextResponse> {
  const url = new URL(request.url);
  const shareToken = url.searchParams.get('share_token');
  const token = await getBearerToken();

  const drupalUrl = new URL(`${drupalBaseUrl()}/api/study/media/${uuid}/file`);
  if (shareToken) {
    drupalUrl.searchParams.set('share_token', shareToken);
  }

  const res = await fetch(drupalUrl.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok || res.body === null) {
    const text = await res.text().catch(() => '');
    return NextResponse.json(
      { error: 'Failed to load media', detail: text },
      { status: res.status }
    );
  }

  const headers = new Headers();
  const contentType = res.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  const contentLength = res.headers.get('Content-Length');
  if (contentLength) headers.set('Content-Length', contentLength);
  headers.set(
    'Cache-Control',
    res.headers.get('Cache-Control') ?? 'private, max-age=86400'
  );

  return new NextResponse(res.body, { status: 200, headers });
}
