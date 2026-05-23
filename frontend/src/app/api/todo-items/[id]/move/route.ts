import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

// Move a todo item from one list to another using copy-then-delete:
// 1. Fetch source item attributes
// 2. Create a new paragraph in the target list
// 3. Remove the old paragraph from the source list
// 4. Delete the old paragraph
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { sourceListId, targetListId } = body as { sourceListId: string; targetListId: string };

  if (!sourceListId || !targetListId) {
    return NextResponse.json({ error: 'sourceListId and targetListId are required' }, { status: 400 });
  }

  if (sourceListId === targetListId) {
    return NextResponse.json({ error: 'Source and target lists are the same' }, { status: 400 });
  }

  // Step 1: fetch source item's attributes
  const itemRes = await drupalFetch(`/jsonapi/paragraph/todo_item/${id}`);
  if (!itemRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch todo item' }, { status: itemRes.status });
  }
  const itemData = await itemRes.json();
  const attrs = itemData.data?.attributes ?? {};

  // Step 2: fetch target list's existing field_items
  const targetNodeRes = await drupalFetch(
    `/jsonapi/node/todo_list/${targetListId}?fields[node--todo_list]=field_items`
  );
  if (!targetNodeRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch target list' }, { status: targetNodeRes.status });
  }
  const targetNodeData = await targetNodeRes.json();
  const existingTargetItems: { type: string; id: string; meta: { target_revision_id: number } }[] =
    targetNodeData.data?.relationships?.field_items?.data ?? [];

  // Step 3: create new paragraph with same attributes
  const paraRes = await drupalFetch('/jsonapi/paragraph/todo_item', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'paragraph--todo_item',
        attributes: {
          field_item_text: attrs.field_item_text ?? null,
          field_completed: attrs.field_completed ?? false,
          field_priority: attrs.field_priority ?? null,
          field_notes: attrs.field_notes ?? null,
        },
      },
    }),
  });
  if (!paraRes.ok) {
    const err = await paraRes.text();
    return NextResponse.json({ error: 'Failed to create todo item in target list', detail: err }, { status: paraRes.status });
  }
  const paraData = await paraRes.json();
  const newItem = {
    type: 'paragraph--todo_item',
    id: paraData.data.id,
    meta: { target_revision_id: paraData.data.attributes.drupal_internal__revision_id },
  };

  // Step 4: patch target list to append new item
  const patchTargetRes = await drupalFetch(`/jsonapi/node/todo_list/${targetListId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'node--todo_list',
        id: targetListId,
        relationships: {
          field_items: { data: [...existingTargetItems, newItem] },
        },
      },
    }),
  });
  if (!patchTargetRes.ok) {
    const err = await patchTargetRes.text();
    return NextResponse.json({ error: 'Failed to add item to target list', detail: err }, { status: patchTargetRes.status });
  }

  // Step 5: fetch source list's existing field_items
  const sourceNodeRes = await drupalFetch(
    `/jsonapi/node/todo_list/${sourceListId}?fields[node--todo_list]=field_items`
  );
  if (!sourceNodeRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch source list' }, { status: sourceNodeRes.status });
  }
  const sourceNodeData = await sourceNodeRes.json();
  const sourceItems: { type: string; id: string; meta: { target_revision_id: number } }[] =
    sourceNodeData.data?.relationships?.field_items?.data ?? [];

  // Step 6: patch source list to remove old item
  const filteredSourceItems = sourceItems.filter((item) => item.id !== id);
  const patchSourceRes = await drupalFetch(`/jsonapi/node/todo_list/${sourceListId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'node--todo_list',
        id: sourceListId,
        relationships: {
          field_items: { data: filteredSourceItems },
        },
      },
    }),
  });
  if (!patchSourceRes.ok) {
    const err = await patchSourceRes.text();
    return NextResponse.json({ error: 'Failed to remove item from source list', detail: err }, { status: patchSourceRes.status });
  }

  // Step 7: delete old paragraph
  const deleteRes = await drupalFetch(`/jsonapi/paragraph/todo_item/${id}`, {
    method: 'DELETE',
  });
  if (!deleteRes.ok) {
    // Item was already moved; log but don't fail the request
    console.error(`Failed to delete old paragraph ${id} after move`);
  }

  return NextResponse.json({ data: paraData.data }, { status: 201 });
}
