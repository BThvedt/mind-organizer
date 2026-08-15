import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * Drupal JSON:API hard-caps `page[limit]` at 50
 * (`OffsetPage::SIZE_MAX`), so requesting more is silently clamped.
 */
const MAX_PAGE_LIMIT = 50;

/** Default keeps pre-pagination callers (link dialog, area pages) unchanged. */
const DEFAULT_PAGE_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the value only when it is a well-formed UUID, else null. */
function safeUuid(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

/** Parses a non-negative integer query param, falling back on bad input. */
function parseInteger(value: string | null, fallback: number, max?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return max !== undefined ? Math.min(n, max) : n;
}

/**
 * GET /api/notes
 *
 * Query params (all optional):
 *   sort     — `-created` (default) | `-changed` | `-field_last_viewed`
 *   limit    — page size, 1…50 (default 50)
 *   offset   — starting offset for pagination (default 0)
 *   area     — area term UUID; filters to notes tagged with it
 *   subject  — subject term UUID; filters to notes tagged with it
 *
 * Returns the JSON:API `data` / `included` shape unchanged, plus a `meta`
 * block describing the window so the client can drive infinite scroll.
 * `hasMore` comes from JSON:API's `links.next` — Drupal does not report a
 * total count for collections by default.
 */
export async function GET(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;

  const sortParam = searchParams.get('sort') ?? '-created';
  const allowedSorts = ['-created', '-changed', '-field_last_viewed'];
  const sort = allowedSorts.includes(sortParam) ? sortParam : '-created';

  const limit = Math.max(
    1,
    parseInteger(searchParams.get('limit'), DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
  );
  const offset = parseInteger(searchParams.get('offset'), 0);

  const areaUuid = safeUuid(searchParams.get('area'));
  const subjectUuid = safeUuid(searchParams.get('subject'));

  const filters =
    (areaUuid ? `&filter[field_area.id][value]=${areaUuid}` : '') +
    (subjectUuid ? `&filter[field_subject.id][value]=${subjectUuid}` : '');

  const res = await drupalFetch(
    `/jsonapi/node/study_note` +
      `?filter[uid.id][value]=${userUuid}` +
      `&include=field_area,field_subject,field_linked_decks,field_linked_notes,field_linked_todos` +
      `&sort=${sort}` +
      filters +
      `&page[offset]=${offset}` +
      `&page[limit]=${limit}`
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: res.status });
  }

  const data = await res.json() as {
    data?: unknown[];
    included?: unknown[];
    links?: { next?: { href?: string } };
  };

  return NextResponse.json({
    ...data,
    meta: {
      ...(typeof (data as { meta?: object }).meta === 'object'
        ? (data as { meta?: object }).meta
        : {}),
      offset,
      limit,
      hasMore: Boolean(data.links?.next?.href),
    },
  });
}

export async function POST(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const body = await request.json();

  const attributes: Record<string, unknown> = {
    title: body.title,
  };
  if (body.fieldBody !== undefined) {
    attributes.field_body = body.fieldBody;
  }

  const relationships: Record<string, unknown> = {};
  if (Array.isArray(body.areaUuids) && body.areaUuids.length > 0) {
    relationships.field_area = {
      data: body.areaUuids.map((id: string) => ({
        type: 'taxonomy_term--area',
        id,
      })),
    };
  }
  if (Array.isArray(body.subjectUuids) && body.subjectUuids.length > 0) {
    relationships.field_subject = {
      data: body.subjectUuids.map((id: string) => ({
        type: 'taxonomy_term--subject',
        id,
      })),
    };
  }
  if (Array.isArray(body.linkedDeckUuids) && body.linkedDeckUuids.length > 0) {
    relationships.field_linked_decks = {
      data: body.linkedDeckUuids.map((id: string) => ({
        type: 'node--flashcard_deck',
        id,
      })),
    };
  }
  if (Array.isArray(body.linkedNoteUuids) && body.linkedNoteUuids.length > 0) {
    relationships.field_linked_notes = {
      data: body.linkedNoteUuids.map((id: string) => ({
        type: 'node--study_note',
        id,
      })),
    };
  }
  if (Array.isArray(body.linkedTodoUuids) && body.linkedTodoUuids.length > 0) {
    relationships.field_linked_todos = {
      data: body.linkedTodoUuids.map((id: string) => ({
        type: 'node--todo_list',
        id,
      })),
    };
  }

  const document = {
    data: {
      type: 'node--study_note',
      attributes,
      ...(Object.keys(relationships).length ? { relationships } : {}),
    },
  };

  const res = await drupalFetch('/jsonapi/node/study_note', {
    method: 'POST',
    body: JSON.stringify(document),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: 'Failed to create note', detail: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data, { status: 201 });
}
