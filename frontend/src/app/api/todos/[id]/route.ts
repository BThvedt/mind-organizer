import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

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
  const { id } = await params;
  const body = await request.json();

  const attributes: Record<string, unknown> = {};
  if (body.title !== undefined) attributes.title = body.title;

  const relationships: Record<string, unknown> = {};
  if (body.areaUuid !== undefined) {
    relationships.field_area = {
      data: body.areaUuid ? { type: 'taxonomy_term--area', id: body.areaUuid } : null,
    };
  }
  if (body.subjectUuid !== undefined) {
    relationships.field_subject = {
      data: body.subjectUuid ? { type: 'taxonomy_term--subject', id: body.subjectUuid } : null,
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
  const { id } = await params;

  const res = await drupalFetch(`/jsonapi/node/todo_list/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to delete todo list' }, { status: res.status });
  }

  return new NextResponse(null, { status: 204 });
}
