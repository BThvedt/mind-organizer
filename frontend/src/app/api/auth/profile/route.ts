import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';

export async function GET() {
  const uuid = await getCurrentUserUuid();
  if (!uuid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const res = await drupalFetch(`/jsonapi/user/user/${uuid}`);
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to load profile' }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({
    uuid,
    name: data.data?.attributes?.name ?? '',
    mail: data.data?.attributes?.mail ?? '',
  });
}

export async function PATCH(request: NextRequest) {
  const uuid = await getCurrentUserUuid();
  if (!uuid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const attributes: Record<string, unknown> = {};

  if (body.name !== undefined) {
    attributes.name = body.name;
  }

  if (body.currentPassword !== undefined && body.newPassword !== undefined) {
    attributes.pass = {
      existing: body.currentPassword,
      value: body.newPassword,
    };
  }

  if (Object.keys(attributes).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const res = await drupalFetch(`/jsonapi/user/user/${uuid}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'user--user',
        id: uuid,
        attributes,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ?? 'Update failed';
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({
    uuid,
    name: data.data?.attributes?.name ?? '',
    mail: data.data?.attributes?.mail ?? '',
  });
}
