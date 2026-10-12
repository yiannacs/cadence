import 'server-only'
import { notFound, redirect } from 'next/navigation'
import {
  SpotifyError,
  getMyPlaylists,
  getPlaylist,
  type PlaylistDetail,
  type PlaylistSummary,
} from '@/lib/spotify/api'
import { REFRESH_FAILED_MESSAGE, messageForSpotifyError } from '@/lib/spotify/messages'
import { getAccessToken, hasSession } from '@/lib/spotify/session'

export type PlaylistsResult = { ok: true; playlists: PlaylistSummary[] } | { ok: false; message: string }
export type PlaylistResult = { ok: true; playlist: PlaylistDetail } | { ok: false; message: string }

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

/**
 * One playlist's metadata. Redirects home when logged out; 404s when Spotify
 * doesn't know the ID (it answers 400 for malformed ones).
 */
export async function loadPlaylist(playlistId: string): Promise<PlaylistResult> {
  if (!(await hasSession())) redirect('/')

  const token = await getAccessToken()
  if (!token) return { ok: false, message: REFRESH_FAILED_MESSAGE }

  try {
    return { ok: true, playlist: await getPlaylist(token, playlistId) }
  } catch (err) {
    if (!(err instanceof SpotifyError)) throw err
    if (err.status === 404 || err.status === 400) notFound()
    return { ok: false, message: messageForSpotifyError(err) }
  }
}
