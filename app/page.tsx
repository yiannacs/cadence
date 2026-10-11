import { SpotifyError, getMe } from '@/lib/spotify/api'
import { getAccessToken, hasSession } from '@/lib/spotify/session'

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
  // No refresh token → never logged in (or proxy just cleared a dead
  // session). Not an error, just show the login button.
  if (!(await hasSession())) return { status: 'logged-out' }

  // Proxy refreshes before we render; a missing access token here means that
  // refresh failed on a network blip or a Spotify outage.
  const accessToken = await getAccessToken()
  if (!accessToken) {
    return {
      status: 'error',
      message: 'Could not refresh your Spotify session. Check your connection and reload.',
    }
  }

  try {
    const me = await getMe(accessToken)
    return { status: 'logged-in', displayName: me.displayName ?? me.id }
  } catch (err) {
    if (!(err instanceof SpotifyError)) throw err
    return { status: 'error', message: messageForSpotifyError(err) }
  }
}

function messageForSpotifyError(err: SpotifyError): string {
  switch (err.kind) {
    case 'network':
      return 'Could not reach Spotify. Check your connection and try again.'
    case 'unauthorized':
      return 'Spotify rejected the session (401). Please log in again.'
    case 'forbidden':
      // On /me, the usual cause is a missing allowlist entry, but pass
      // Spotify's own message along rather than assume.
      return `Spotify returned 403: ${err.message}. If this account isn't on the app's Development Mode allowlist, add it in the Spotify dashboard under Settings → User Management.`
    case 'rate_limited':
      // Dev Mode Retry-After values can run to many hours.
      return err.retryAfterSec !== undefined && err.retryAfterSec >= 60
        ? `Spotify is rate-limiting this app. Try again in about ${Math.ceil(err.retryAfterSec / 60)} minutes.`
        : 'Spotify is rate-limiting this app. Try again in a few seconds.'
    default:
      return `Could not load your Spotify profile (HTTP ${err.status}): ${err.message}`
  }
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
