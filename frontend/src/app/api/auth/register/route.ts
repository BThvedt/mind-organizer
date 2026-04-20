import { NextRequest, NextResponse } from 'next/server';
import { applyTokenCookies } from '@/lib/auth';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

export async function POST(request: NextRequest) {
  const { username, email, password, turnstileToken } = await request.json();

  // Verify Turnstile token before doing anything else.
  const turnstileRes = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY!,
        response: turnstileToken ?? '',
      }),
    }
  );
  const { success: captchaOk } = await turnstileRes.json();
  if (!captchaOk) {
    return NextResponse.json({ error: 'Security check failed. Please try again.' }, { status: 400 });
  }

  // Create the user via the custom registration endpoint.
  const createRes = await fetch(`${DRUPAL_BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });

  if (!createRes.ok) {
    const body = await createRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: body.error ?? 'Registration failed. Please try again.' },
      { status: createRes.status }
    );
  }

  // Auto-login: exchange credentials for OAuth tokens.
  const tokenRes = await fetch(`${DRUPAL_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.DRUPAL_CLIENT_ID!,
      client_secret: process.env.DRUPAL_CLIENT_SECRET!,
      username,
      password,
      scope: 'mind_organizer',
    }),
  });

  if (!tokenRes.ok) {
    // Account was created but auto-login failed — user can sign in manually.
    return NextResponse.json(
      { error: 'Account created, but auto-login failed. Please sign in.' },
      { status: 201 }
    );
  }

  const tokens = await tokenRes.json();
  const response = NextResponse.json({ success: true }, { status: 201 });
  applyTokenCookies(response, tokens);
  return response;
}
