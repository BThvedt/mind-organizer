import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/notes/[id]/position
 *
 * Thin authenticated proxy to the Drupal `study_search` module's
 * `/api/study/notes/{uuid}/position` endpoint. Used by the notes sidebar
 * to "jump to" a note opened from Search/Ask AI that isn't in the
 * currently loaded window — see `NotePositionController` on the backend
 * for the full contract.
 *
 * Forwards `sort` / `area` / `subject` query params unchanged and relays
 * the backend's status code (404 for both "not found" and
 * "excluded_by_filter" — the response body's `error` field distinguishes
 * the two).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = request.nextUrl;

  const forwarded = new URLSearchParams();
  const sort = searchParams.get('sort');
  const area = searchParams.get('area');
  const subject = searchParams.get('subject');
  if (sort) forwarded.set('sort', sort);
  if (area) forwarded.set('area', area);
  if (subject) forwarded.set('subject', subject);

  const qs = forwarded.toString();
  const res = await drupalFetch(
    `/api/study/notes/${id}/position${qs ? `?${qs}` : ''}`
  );

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
