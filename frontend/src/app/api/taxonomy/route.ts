import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

/**
 * GET /api/taxonomy?type=areas
 * GET /api/taxonomy?type=subjects&area=<uuid>
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ownerFilter = `&filter[field_owner.id][value]=${userUuid}`;

  if (type === 'areas') {
    const res = await drupalFetch(
      `/jsonapi/taxonomy_term/area?sort=name&page[limit]=100${ownerFilter}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch areas' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  }

  if (type === 'subjects') {
    const area = searchParams.get('area');
    const areaFilter = area ? `&filter[field_area.id][value]=${area}` : '';
    const res = await drupalFetch(
      `/jsonapi/taxonomy_term/subject?sort=name&page[limit]=100${ownerFilter}${areaFilter}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch subjects' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  }

  return NextResponse.json({ error: 'type must be "areas" or "subjects"' }, { status: 400 });
}

/**
 * POST /api/taxonomy
 * Body: { type: 'area', name: string }
 *       { type: 'subject', name: string, areaUuid: string }
 *
 * field_owner is set server-side by the study_taxonomy_owner module's
 * presave hook — no need to include it in the JSON:API document.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, name, areaUuid } = body as {
    type: 'area' | 'subject';
    name: string;
    areaUuid?: string;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (type === 'area') {
    const document = {
      data: {
        type: 'taxonomy_term--area',
        attributes: { name: name.trim() },
      },
    };

    const res = await drupalFetch('/jsonapi/taxonomy_term/area', {
      method: 'POST',
      body: JSON.stringify(document),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: 'Failed to create area', detail: err }, { status: res.status });
    }

    return NextResponse.json(await res.json(), { status: 201 });
  }

  if (type === 'subject') {
    if (!areaUuid) {
      return NextResponse.json({ error: 'areaUuid is required for subjects' }, { status: 400 });
    }

    const document = {
      data: {
        type: 'taxonomy_term--subject',
        attributes: { name: name.trim() },
        relationships: {
          field_area: {
            data: { type: 'taxonomy_term--area', id: areaUuid },
          },
        },
      },
    };

    const res = await drupalFetch('/jsonapi/taxonomy_term/subject', {
      method: 'POST',
      body: JSON.stringify(document),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: 'Failed to create subject', detail: err }, { status: res.status });
    }

    return NextResponse.json(await res.json(), { status: 201 });
  }

  return NextResponse.json({ error: 'type must be "area" or "subject"' }, { status: 400 });
}
