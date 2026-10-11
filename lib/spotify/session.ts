import 'server-only'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import type { TokenSet } from './auth'

// One source of truth for the session cookies, shared by the callback,
// logout and proxy. Pages and Route Handlers only ever read them.
export const ACCESS_TOKEN_COOKIE = 'sp_at'
export const REFRESH_TOKEN_COOKIE = 'sp_rt'
export const EXPIRES_AT_COOKIE = 'sp_exp'

export const TOKEN_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
}

// Spotify refresh tokens die 6 months after the original authorization, and
// refreshing doesn't extend that. No point keeping the cookie any longer.
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 180

// Refresh when the access token has less than this left, so a request that
// starts just before expiry doesn't hit Spotify with a dead token.
const REFRESH_MARGIN_MS = 60_000

type ResponseCookies = NextResponse['cookies']

/** True when the proxy should refresh before letting the request through. */
export function needsRefresh(
  accessToken: string | undefined,
  expiresAt: number,
  now = Date.now()
): boolean {
  return !accessToken || now >= expiresAt - REFRESH_MARGIN_MS
}

/** Writes the token cookies onto a response so the browser stores them. */
export function setTokenCookies(
  jar: ResponseCookies,
  tokens: TokenSet,
  { includeRefreshToken = true } = {}
): void {
  jar.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...TOKEN_COOKIE_OPTS,
    maxAge: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
  })
  jar.set(EXPIRES_AT_COOKIE, String(tokens.expiresAt), {
    ...TOKEN_COOKIE_OPTS,
    maxAge: SESSION_MAX_AGE_SEC,
  })
  if (includeRefreshToken) {
    jar.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...TOKEN_COOKIE_OPTS,
      maxAge: SESSION_MAX_AGE_SEC,
    })
  }
}

export function clearTokenCookies(jar: ResponseCookies): void {
  jar.delete(ACCESS_TOKEN_COOKIE)
  jar.delete(REFRESH_TOKEN_COOKIE)
  jar.delete(EXPIRES_AT_COOKIE)
}

/**
 * Proxy only. Forwards fresh tokens to this request's handlers *and* sends
 * them to the browser.
 *
 * Order matters: the request cookies must be set before NextResponse.next()
 * copies the request headers. Setting only the response cookie reaches Server
 * Components but not Route Handlers, which would then 401 on the first call
 * after expiry. Building the response first has the same bug. That's why this
 * builds the response itself rather than taking one.
 */
export function setTokens(request: NextRequest, tokens: TokenSet): NextResponse {
  // Spotify only sometimes rotates the refresh token; leave the cookie (and
  // its max-age) alone when it didn't.
  const rotated = tokens.refreshToken !== request.cookies.get(REFRESH_TOKEN_COOKIE)?.value

  request.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken)
  request.cookies.set(EXPIRES_AT_COOKIE, String(tokens.expiresAt))
  if (rotated) request.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken)

  const response = NextResponse.next({ request: { headers: request.headers } })
  setTokenCookies(response.cookies, tokens, { includeRefreshToken: rotated })
  return response
}

/** Proxy only. Logs the user out for this request and in the browser. */
export function clearTokens(request: NextRequest): NextResponse {
  request.cookies.delete(ACCESS_TOKEN_COOKIE)
  request.cookies.delete(REFRESH_TOKEN_COOKIE)
  request.cookies.delete(EXPIRES_AT_COOKIE)

  const response = NextResponse.next({ request: { headers: request.headers } })
  clearTokenCookies(response.cookies)
  return response
}

/**
 * The access token for this request, for Server Components and Route
 * Handlers. Never refreshes — proxy already did that before we got here.
 * Null when logged out, or when the refresh failed on a network blip.
 */
export async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value ?? null
}

/**
 * True when the user has logged in (a refresh token is present), whether or
 * not the access token is currently usable. A presence check for routes the
 * proxy skips, not proof the session is valid.
 */
export async function hasSession(): Promise<boolean> {
  return (await cookies()).has(REFRESH_TOKEN_COOKIE)
}
