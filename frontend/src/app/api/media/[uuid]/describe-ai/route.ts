import { NextRequest, NextResponse } from 'next/server';
import { drupalBaseUrl, getBearerToken } from '@/lib/drupal';

/**
 * POST /api/media/[uuid]/describe-ai
 *
 * Asks the Drupal backend to call the Anthropic vision API and return a
 * short prose description of the image. No body — Drupal pulls the file
 * from S3 itself. Vision calls can take a few seconds, so we let the
 * default Next route timeout apply rather than racing it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = await getBearerToken();
  if (!token) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await fetch(`${drupalBaseUrl()}/api/study/media/${uuid}/describe-ai`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: 'AI description failed', detail: text };
  }
  return NextResponse.json(payload, { status: res.status });
}
