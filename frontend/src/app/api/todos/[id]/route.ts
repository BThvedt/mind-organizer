import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await drupalFetch(
    `/jsonapi/node/todo_list/${id}?include=field_items,field_area,field_subject`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch todo list' }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const attributes: Record<string, unknown> = {};
  if (body.title !== undefined) attributes.title = body.title;
  if (body.isShared !== undefined) attributes.field_is_shared = !!body.isShared;

  const relationships: Record<string, unknown> = {};
  if ('areaUuids' in body) {
    relationships.field_area = {
      data: Array.isArray(body.areaUuids)
        ? body.areaUuids.map((id: string) => ({ type: 'taxonomy_term--area', id }))
        : [],
    };
  }
  if ('subjectUuids' in body) {
    relationships.field_subject = {
      data: Array.isArray(body.subjectUuids)
        ? body.subjectUuids.map((id: string) => ({ type: 'taxonomy_term--subject', id }))
        : [],
    };
  }
  // Reorder items: client sends the full ordered relationship array including revision IDs
  if (Array.isArray(body.itemOrder)) {
    relationships.field_items = { data: body.itemOrder };
  }

  const document = {
    data: {
      type: 'node--todo_list',
      id,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      ...(Object.keys(relationships).length ? { relationships } : {}),
    },
  };

  const res = await drupalFetch(`/jsonapi/node/todo_list/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to update todo list', detail: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;

  const res = await drupalFetch(`/jsonapi/node/todo_list/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to delete todo list' }, { status: res.status });
  }

  return new NextResponse(null, { status: 204 });
}
