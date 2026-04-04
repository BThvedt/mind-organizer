import { NextRequest, NextResponse } from 'next/server';
import { applyTokenCookies } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  const tokenRes = await fetch(
    `${process.env.NEXT_PUBLIC_DRUPAL_BASE_URL}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: process.env.DRUPAL_CLIENT_ID!,
        client_secret: process.env.DRUPAL_CLIENT_SECRET!,
        username,
        password,
      }),
    }
  );

  if (!tokenRes.ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const tokens = await tokenRes.json();
  const response = NextResponse.json({ success: true });
  applyTokenCookies(response, tokens);
  return response;
}