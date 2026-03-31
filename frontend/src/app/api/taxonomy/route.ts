import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch } from '@/lib/drupal';

/**
 * GET /api/taxonomy?type=areas
 * GET /api/taxonomy?type=subjects&area=<uuid>
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  if (type === 'areas') {
    const res = await drupalFetch('/jsonapi/taxonomy_term/area?sort=name&page[limit]=100');
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch areas' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  }

  if (type === 'subjects') {
    const area = searchParams.get('area');
    const filter = area ? `&filter[field_area.id][value]=${area}` : '';
    const res = await drupalFetch(
      `/jsonapi/taxonomy_term/subject?sort=name&page[limit]=100${filter}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch subjects' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  }

  return NextResponse.json({ error: 'type must be "areas" or "subjects"' }, { status: 400 });
}
