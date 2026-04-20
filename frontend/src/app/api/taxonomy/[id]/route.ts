import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/taxonomy/[id]?type=area|subject
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = request.nextUrl.searchParams.get('type');

  if (type !== 'area' && type !== 'subject') {
    return NextResponse.json({ error: 'type must be "area" or "subject"' }, { status: 400 });
  }

  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch(`/jsonapi/taxonomy_term/${type}/${id}`);
  if (!res.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}

/**
 * PATCH /api/taxonomy/[id]?type=area|subject
 * Body: { name: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = request.nextUrl.searchParams.get('type');

  if (type !== 'area' && type !== 'subject') {
    return NextResponse.json({ error: 'type must be "area" or "subject"' }, { status: 400 });
  }

  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { name } = await request.json() as { name: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const document = {
    data: {
      type: `taxonomy_term--${type}`,
      id,
      attributes: { name: name.trim() },
    },
  };

  const res = await drupalFetch(`/jsonapi/taxonomy_term/${type}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: 'Failed to update', detail }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}

/**
 * DELETE /api/taxonomy/[id]?type=area|subject
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = request.nextUrl.searchParams.get('type');

  if (type !== 'area' && type !== 'subject') {
    return NextResponse.json({ error: 'type must be "area" or "subject"' }, { status: 400 });
  }

  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const res = await drupalFetch(`/jsonapi/taxonomy_term/${type}/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok && res.status !== 204) {
    const detail = await res.text();
    return NextResponse.json({ error: 'Failed to delete', detail }, { status: res.status });
  }

  return new NextResponse(null, { status: 204 });
}
