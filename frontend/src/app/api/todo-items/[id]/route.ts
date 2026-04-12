import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const attributes: Record<string, unknown> = {};
  if (body.text !== undefined) attributes.field_item_text = body.text;
  if (body.completed !== undefined) attributes.field_completed = body.completed;
  if (body.priority !== undefined) attributes.field_priority = body.priority;
  if (body.notes !== undefined) attributes.field_notes = body.notes;

  const res = await drupalFetch(`/jsonapi/paragraph/todo_item/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'paragraph--todo_item',
        id,
        attributes,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to update todo item', detail: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

// Delete an item: remove it from the parent node's field_items, then delete the paragraph.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const listId: string | undefined = body.listId;

  if (listId) {
    // Fetch the current node to get the full field_items list
    const nodeRes = await drupalFetch(
      `/jsonapi/node/todo_list/${listId}?fields[node--todo_list]=field_items`
    );
    if (nodeRes.ok) {
      const nodeData = await nodeRes.json();
      const items: { type: string; id: string; meta: { target_revision_id: number } }[] =
        nodeData.data?.relationships?.field_items?.data ?? [];

      const filtered = items.filter((item) => item.id !== id);

      await drupalFetch(`/jsonapi/node/todo_list/${listId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          data: {
            type: 'node--todo_list',
            id: listId,
            relationships: {
              field_items: { data: filtered },
            },
          },
        }),
      });
    }
  }

  const res = await drupalFetch(`/jsonapi/paragraph/todo_item/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to delete todo item' }, { status: res.status });
  }

  return new NextResponse(null, { status: 204 });
}
