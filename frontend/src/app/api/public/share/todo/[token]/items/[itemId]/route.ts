import { NextRequest, NextResponse } from 'next/server';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

/**
 * Public PATCH proxy for toggling a single todo_item on a shared list.
 * Anonymous viewers send `{ completed: bool }`. The Drupal endpoint enforces
 * that the paragraph belongs to the list identified by the token and refuses
 * any other field modifications.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; itemId: string }> },
) {
  const { token, itemId } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('completed' in (payload as Record<string, unknown>))
  ) {
    return NextResponse.json(
      { error: 'Field "completed" (bool) is required.' },
      { status: 400 },
    );
  }

  const body = JSON.stringify({
    completed: Boolean((payload as { completed: unknown }).completed),
  });

  try {
    const res = await fetch(
      `${DRUPAL_BASE_URL}/api/share/todo/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        cache: 'no-store',
      },
    );

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Upstream request failed.' }, { status: 502 });
  }
}
