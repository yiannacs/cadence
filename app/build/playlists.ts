import 'server-only'
import { redirect } from 'next/navigation'
import { SpotifyError, getMyPlaylists, type PlaylistSummary } from '@/lib/spotify/api'
import { REFRESH_FAILED_MESSAGE, messageForSpotifyError } from '@/lib/spotify/messages'
import { getAccessToken, hasSession } from '@/lib/spotify/session'

export type PlaylistsResult = { ok: true; playlists: PlaylistSummary[] } | { ok: false; message: string }

/** The user's playlists for the build pages. Redirects home when logged out. */
export async function loadPlaylists(): Promise<PlaylistsResult> {
  if (!(await hasSession())) redirect('/')

  const token = await getAccessToken()
  if (!token) return { ok: false, message: REFRESH_FAILED_MESSAGE }

  try {
    return { ok: true, playlists: await getMyPlaylists(token) }
  } catch (err) {
    if (!(err instanceof SpotifyError)) throw err
    return { ok: false, message: messageForSpotifyError(err) }
  }
}
