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

function basicAuthHeader(): string {
  return (
    'Basic ' +
    Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64')
  )
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed ${res.status}: ${body}`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed ${res.status}: ${body}`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    // Spotify only returns a new refresh token occasionally; keep the old one if absent
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

// Returns the current access token, refreshing if needed.
// newTokens is populated when a refresh occurred — callers must write those back to cookies.
export async function getValidToken(
  accessToken: string | undefined,
  refreshToken: string | undefined,
  expiresAt: number
): Promise<{ accessToken: string; newTokens?: TokenSet } | null> {
  if (!refreshToken) return null

  // Token good for at least another minute
  if (accessToken && Date.now() < expiresAt - 60_000) {
    return { accessToken }
  }

  try {
    const newTokens = await refreshAccessToken(refreshToken)
    return { accessToken: newTokens.accessToken, newTokens }
  } catch {
    return null
  }
}
