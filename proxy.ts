import { type NextRequest, NextResponse } from 'next/server'
import { SpotifyAuthError, refreshAccessToken } from '@/lib/spotify/auth'
import {
  ACCESS_TOKEN_COOKIE,
  EXPIRES_AT_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearTokens,
  needsRefresh,
  setTokens,
} from '@/lib/spotify/session'

// The only place tokens get refreshed. Server Components can't set cookies,
// so a refresh anywhere downstream would be thrown away. Next's docs warn
// proxy isn't a full session layer; for a single local user it's enough.
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
  if (!refreshToken) return NextResponse.next()

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  const expiresAt = Number(request.cookies.get(EXPIRES_AT_COOKIE)?.value ?? 0)
  if (!needsRefresh(accessToken, expiresAt)) return NextResponse.next()

  try {
    return setTokens(request, await refreshAccessToken(refreshToken))
  } catch (err) {
    // Revoked, or past the 6-month refresh-token lifetime: the session is
    // dead, so log out cleanly and let the app show the login button.
    if (err instanceof SpotifyAuthError && err.code === 'invalid_grant') {
      return clearTokens(request)
    }
    // Network blip or Spotify 5xx: don't log the user out over it. The
    // request goes through as-is and the next one tries again.
    console.error('[proxy] token refresh failed:', err)
    return NextResponse.next()
  }
}

export const config = {
  // Skip routes that must not trigger a refresh — above all the callback,
  // which would otherwise race a refresh using the *old* refresh token.
  matcher: ['/((?!api/login|api/callback|api/logout|api/bpm|_next/static|_next/image|favicon.ico).*)'],
}
