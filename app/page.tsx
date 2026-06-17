import { cookies } from 'next/headers'
import { getValidToken } from '@/lib/spotify/auth'

type SessionState =
  | { status: 'logged-out' }
  | { status: 'logged-in'; displayName: string }
  | { status: 'error'; message: string }

// Maps the ?error= code set by the callback route to a readable message.
function messageForCallbackError(code: string): string {
  switch (code) {
    case 'access_denied':
      return "Access was denied. If this is a second account, it may not be added to the app's allowlist (Spotify Development Mode)."
    case 'token_exchange_failed':
      return 'Login failed while exchanging the authorization code. Please try again.'
    case 'missing_code':
      return 'Login failed — Spotify did not return an authorization code.'
    default:
      return `Login failed: ${code}`
  }
}

async function getSession(): Promise<SessionState> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('sp_at')?.value
  const refreshToken = cookieStore.get('sp_rt')?.value
  const expiresAt = Number(cookieStore.get('sp_exp')?.value ?? 0)

  // No refresh token → never logged in. Not an error, just show the login button.
  if (!refreshToken) return { status: 'logged-out' }

  const result = await getValidToken(accessToken, refreshToken, expiresAt)
  if (!result) {
    return {
      status: 'error',
      message: 'Your session expired and could not be refreshed. Please log in again.',
    }
  }

  let res: Response
  try {
    res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${result.accessToken}` },
    })
  } catch {
    return {
      status: 'error',
      message: 'Could not reach Spotify. Check your connection and try again.',
    }
  }

  if (!res.ok) {
    if (res.status === 403) {
      return {
        status: 'error',
        message:
          "Spotify returned 403 — this account is likely not added to the app (Development Mode allowlist). Add it in the Spotify dashboard under Settings → User Management.",
      }
    }
    if (res.status === 401) {
      return {
        status: 'error',
        message: 'Spotify rejected the session (401). Please log in again.',
      }
    }
    return {
      status: 'error',
      message: `Could not load your Spotify profile (HTTP ${res.status}).`,
    }
  }

  const me = await res.json()
  return { status: 'logged-in', displayName: me.display_name ?? me.id ?? 'unknown' }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const session = await getSession()

  // A callback ?error= takes precedence; otherwise surface any session error.
  const errorMessage =
    (error && messageForCallbackError(error)) ||
    (session.status === 'error' ? session.message : null)

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 font-sans">
      <main className="flex flex-col items-center gap-8 text-center px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-50">cadence</h1>
        <p className="text-zinc-400 text-lg max-w-sm">
          Running playlists ordered by tempo. Pick a vibe, we handle the BPM.
        </p>

        {errorMessage && (
          <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded px-4 py-3 max-w-sm">
            {errorMessage}
          </p>
        )}

        {session.status === 'logged-in' ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-zinc-300 text-sm">
              Logged in as{' '}
              <span className="text-zinc-50 font-medium">{session.displayName}</span>
            </p>
            <a
              href="/api/logout"
              className="rounded-full border border-zinc-700 px-6 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-50"
            >
              Log out
            </a>
          </div>
        ) : (
          <a
            href="/api/login"
            className="rounded-full bg-[#1DB954] px-8 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Log in with Spotify
          </a>
        )}
      </main>
    </div>
  )
}
