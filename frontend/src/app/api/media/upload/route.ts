import { NextRequest, NextResponse } from 'next/server';
import { drupalBaseUrl, getBearerToken } from '@/lib/drupal';

/**
 * POST /api/media/upload
 *
 * Thin proxy: forwards the multipart body to Drupal's
 * /api/study/media/upload with the user's bearer token attached.
 * fetch() infers the multipart Content-Type (with boundary) automatically
 * when the body is a FormData instance.
 */
export async function POST(request: NextRequest) {
  const token = await getBearerToken();
  if (!token) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body.' }, { status: 400 });
  }

  const res = await fetch(`${drupalBaseUrl()}/api/study/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const text = await res.text();
  // Drupal returns JSON; pass it through with the same status.
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: 'Upload failed', detail: text };
  }
  return NextResponse.json(body, { status: res.status });
}
