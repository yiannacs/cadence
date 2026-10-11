const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SCOPES = [
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
]

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    state,
    scope: SCOPES.join(' '),
    // Force the approval screen instead of silently re-authing an existing
    // Spotify session — lets the user actually re-consent or switch accounts.
    show_dialog: 'true',
  })
  return `${SPOTIFY_AUTH_URL}?${params}`
}

export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number // unix ms
}

/**
 * A failed call to Spotify's token endpoint. `code` is Spotify's OAuth error
 * code (e.g. 'invalid_grant' for a revoked or expired refresh token), so
 * callers can tell "log in again" apart from a transient failure.
 */
export class SpotifyAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly description: string | null
  ) {
    super(`Spotify token request failed ${status}: ${code}${description ? ` (${description})` : ''}`)
    this.name = 'SpotifyAuthError'
  }
}

function basicAuthHeader(): string {
  return (
    'Basic ' +
    Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64')
  )
}

// A fetch rejection propagates untouched: that's a network failure, not
// Spotify saying no.
async function requestToken(body: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body,
  })

  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    // Non-JSON body (e.g. a gateway error page); carry on with no fields.
  }

  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : `http_${res.status}`
    const description =
      typeof data.error_description === 'string' ? data.error_description : text || null
    throw new SpotifyAuthError(res.status, code, description)
  }

  return data
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const data = await requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    })
  )
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  }
}

/** Throws SpotifyAuthError when Spotify rejects the refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const data = await requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  )
  return {
    accessToken: data.access_token as string,
    // Spotify only returns a new refresh token occasionally; keep the old one if absent
    refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  }
}
