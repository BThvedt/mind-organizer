import { NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

export async function GET() {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const ownerFilter = `filter[uid.id][value]=${userUuid}&filter[field_is_shared][value]=1`;

  const [notesRes, decksRes, todosRes] = await Promise.all([
    drupalFetch(
      `/jsonapi/node/study_note?${ownerFilter}` +
        `&fields[node--study_note]=title,field_share_token,changed` +
        `&sort=-changed&page[limit]=50`
    ),
    drupalFetch(
      `/jsonapi/node/flashcard_deck?${ownerFilter}` +
        `&fields[node--flashcard_deck]=title,field_share_token,created` +
        `&sort=-created&page[limit]=50`
    ),
    drupalFetch(
      `/jsonapi/node/todo_list?${ownerFilter}` +
        `&fields[node--todo_list]=title,field_share_token,changed` +
        `&sort=-changed&page[limit]=50`
    ),
  ]);

  const [notesData, decksData, todosData] = await Promise.all([
    notesRes.ok ? notesRes.json() : { data: [] },
    decksRes.ok ? decksRes.json() : { data: [] },
    todosRes.ok ? todosRes.json() : { data: [] },
  ]);

  return NextResponse.json({
    notes: notesData.data ?? [],
    decks: decksData.data ?? [],
    todos: todosData.data ?? [],
  });
}
