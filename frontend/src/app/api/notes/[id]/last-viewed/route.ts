import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await drupalFetch(`/jsonapi/node/study_note/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'node--study_note',
        id,
        attributes: {
          field_last_viewed: new Date().toISOString().slice(0, 19) + '+00:00',
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[last-viewed] PATCH failed', res.status, detail);
    return NextResponse.json(
      { error: 'Failed to update last viewed', detail },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true });
}
