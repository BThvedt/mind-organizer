import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/cards/[id]/audio
 *
 * Triggers TTS audio generation for a flashcard face.
 * Body: { face: 'front' | 'back' }
 * Proxies to Drupal's POST /api/study/flashcard-audio/generate.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const face = body.face === 'back' ? 'back' : 'front';

  const res = await drupalFetch('/api/study/flashcard-audio/generate', {
    method: 'POST',
    body: JSON.stringify({ card: id, face }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Audio generation failed' }));
    return NextResponse.json(err, { status: res.status });
  }

  return NextResponse.json(await res.json(), { status: 201 });
}

/**
 * DELETE /api/cards/[id]/audio?face=front|back
 *
 * Soft-deletes the audio asset for the given card face.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  const face = request.nextUrl.searchParams.get('face') ?? 'front';

  // Fetch card to get the audio UUID from the appropriate field.
  const cardRes = await drupalFetch(
    `/jsonapi/node/flashcard?filter[uuid][value]=${id}&fields[node--flashcard]=id,field_front_audio,field_back_audio`
  );

  if (!cardRes.ok) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  const cardJson = await cardRes.json();
  const card = cardJson?.data?.[0];
  if (!card) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  const fieldKey = face === 'back' ? 'field_back_audio' : 'field_front_audio';
  const audioUuid = card.attributes?.[fieldKey] as string | undefined;

  if (!audioUuid) {
    return NextResponse.json({ error: 'No audio to delete for this face' }, { status: 404 });
  }

  const delRes = await drupalFetch(`/api/study/flashcard-audio/${audioUuid}/delete`, {
    method: 'DELETE',
  });

  if (!delRes.ok) {
    const err = await delRes.json().catch(() => ({ error: 'Delete failed' }));
    return NextResponse.json(err, { status: delRes.status });
  }

  return NextResponse.json({ status: 'deleted' });
}
