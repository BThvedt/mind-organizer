const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Exchange a refresh token for a new access/refresh token pair.
 * Returns null if the refresh token is invalid or expired.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenSet | null> {
  try {
    const res = await fetch(`${DRUPAL_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.DRUPAL_CLIENT_ID!,
        client_secret: process.env.DRUPAL_CLIENT_SECRET!,
        scope: 'mind_organizer',
      }),
    });

    if (!res.ok) return null;

    const tokens = await res.json();
    if (!tokens.access_token) return null;

    return tokens as TokenSet;
  } catch {
    return null;
  }
}

/** Apply token cookies to a NextResponse. */
export function applyTokenCookies(
  response: { cookies: { set: (name: string, value: string, opts: object) => void } },
  tokens: TokenSet
) {
  response.cookies.set('access_token', tokens.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: tokens.expires_in,
    path: '/',
  });
  response.cookies.set('refresh_token', tokens.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
}
