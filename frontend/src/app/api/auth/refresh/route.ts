import { NextRequest, NextResponse } from 'next/server';
import { refreshAccessToken, applyTokenCookies } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const tokens = await refreshAccessToken(refreshToken);

  if (!tokens) {
    const response = NextResponse.json(
      { error: 'Refresh token invalid or expired' },
      { status: 401 }
    );
    response.cookies.delete('access_token');
    response.cookies.delete('refresh_token');
    return response;
  }

  const response = NextResponse.json({ success: true });
  applyTokenCookies(response, tokens);
  return response;
}
