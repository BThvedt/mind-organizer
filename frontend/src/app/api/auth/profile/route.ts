import { NextRequest, NextResponse } from 'next/server';
import { drupalFetch, getCurrentUserUuid } from '@/lib/drupal';
import {
  clampMatchStrength,
  MATCH_STRENGTH_DEFAULT,
  parseMatchStrength,
} from '@/lib/match-strength';

type DrupalUserAttributes = {
  name?: string;
  mail?: string;
  created?: string;
  field_link_match_strength?: unknown;
  field_ask_match_strength?: unknown;
};

function profileResponse(uuid: string, attrs: DrupalUserAttributes) {
  const linkParsed = parseMatchStrength(attrs.field_link_match_strength);
  const askParsed = parseMatchStrength(attrs.field_ask_match_strength);

  return {
    uuid,
    name: attrs.name ?? '',
    mail: attrs.mail ?? '',
    created: attrs.created ?? null,
    linkMatchStrength: linkParsed ?? MATCH_STRENGTH_DEFAULT,
    askMatchStrength: askParsed ?? MATCH_STRENGTH_DEFAULT,
  };
}

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
  const attrs = (data.data?.attributes ?? {}) as DrupalUserAttributes;
  return NextResponse.json(profileResponse(uuid, attrs));
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

  if (body.linkMatchStrength !== undefined) {
    const value = parseMatchStrength(body.linkMatchStrength);
    if (value === null) {
      return NextResponse.json({ error: 'Invalid link match strength.' }, { status: 422 });
    }
    attributes.field_link_match_strength = clampMatchStrength(value);
  }

  if (body.askMatchStrength !== undefined) {
    const value = parseMatchStrength(body.askMatchStrength);
    if (value === null) {
      return NextResponse.json({ error: 'Invalid Ask AI match strength.' }, { status: 422 });
    }
    attributes.field_ask_match_strength = clampMatchStrength(value);
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
  const attrs = (data.data?.attributes ?? {}) as DrupalUserAttributes;
  return NextResponse.json(profileResponse(uuid, attrs));
}
