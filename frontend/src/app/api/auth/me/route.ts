import { NextRequest, NextResponse } from 'next/server';
import { refreshAccessToken, applyTokenCookies } from '@/lib/auth';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

async function probeToken(token: string): Promise<boolean> {
  const res = await fetch(`${DRUPAL_BASE_URL}/jsonapi`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;
  const refreshToken = request.cookies.get('refresh_token')?.value;

  // Happy path: valid access token present
  if (accessToken && (await probeToken(accessToken))) {
    return NextResponse.json({ authenticated: true });
  }

  // Access token missing or rejected — try to refresh silently
  if (refreshToken) {
    const tokens = await refreshAccessToken(refreshToken);

    if (tokens) {
      const response = NextResponse.json({ authenticated: true });
      applyTokenCookies(response, tokens);
      return response;
    }

    // Refresh token also expired — clear both cookies
    const response = NextResponse.json({ authenticated: false });
    response.cookies.delete('access_token');
    response.cookies.delete('refresh_token');
    return response;
  }

  return NextResponse.json({ authenticated: false });
}
