import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

// Add a new todo item to a list.
// Because field_items uses entity_reference_revisions, adding an item requires:
// 1. GET the current node to read existing field_items revision data
// 2. POST a new paragraph entity
// 3. PATCH the node with the full updated field_items relationship array
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  // Step 1: fetch existing items on the node
  const nodeRes = await drupalFetch(`/jsonapi/node/todo_list/${id}?fields[node--todo_list]=field_items`);
  if (!nodeRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch todo list' }, { status: nodeRes.status });
  }
  const nodeData = await nodeRes.json();
  const existingItems: { type: string; id: string; meta: { target_revision_id: number } }[] =
    nodeData.data?.relationships?.field_items?.data ?? [];

  // Step 2: create the new paragraph
  const paraRes = await drupalFetch('/jsonapi/paragraph/todo_item', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'paragraph--todo_item',
        attributes: {
          field_item_text: body.text,
          field_completed: false,
          field_priority: body.priority ?? null,
          field_notes: body.notes ?? null,
        },
      },
    }),
  });

  if (!paraRes.ok) {
    const err = await paraRes.text();
    return NextResponse.json({ error: 'Failed to create todo item', detail: err }, { status: paraRes.status });
  }

  const paraData = await paraRes.json();
  const newItem = {
    type: 'paragraph--todo_item',
    id: paraData.data.id,
    meta: { target_revision_id: paraData.data.attributes.drupal_internal__revision_id },
  };

  // Step 3: patch the node with the updated field_items list
  const patchRes = await drupalFetch(`/jsonapi/node/todo_list/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'node--todo_list',
        id,
        relationships: {
          field_items: {
            data: [...existingItems, newItem],
          },
        },
      },
    }),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text();
    return NextResponse.json({ error: 'Failed to add item to list', detail: err }, { status: patchRes.status });
  }

  return NextResponse.json(paraData, { status: 201 });
}
