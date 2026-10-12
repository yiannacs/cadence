import type { SpotifyError } from './api'

// Proxy refreshes before pages and most routes run; a missing access token
// with a session present means that refresh failed on a network blip.
export const REFRESH_FAILED_MESSAGE =
  'Could not refresh your Spotify session. Check your connection and reload.'

/** User-facing wording for a Web API error. */
export function messageForSpotifyError(err: SpotifyError): string {
  switch (err.kind) {
    case 'network':
      return 'Could not reach Spotify. Check your connection and try again.'
    case 'unauthorized':
      return 'Spotify rejected the session (401). Please log in again.'
    case 'playlist_not_owned':
      return 'Spotify only lets this app read playlists you own.'
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
      return `Spotify request failed (HTTP ${err.status}): ${err.message}`
  }
}
