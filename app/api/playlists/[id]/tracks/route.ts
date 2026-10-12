import type { NextRequest } from 'next/server'
import { withCachedBpm } from '@/lib/bpm/batch'
import { BpmCacheError } from '@/lib/bpm/cache'
import { dedupeById } from '@/lib/resolution'
import { SpotifyError, getPlaylistTracks } from '@/lib/spotify/api'
import { REFRESH_FAILED_MESSAGE, messageForSpotifyError } from '@/lib/spotify/messages'
import { getAccessToken, hasSession } from '@/lib/spotify/session'

function errorResponse(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status })
}

function statusFor(err: SpotifyError): number {
  switch (err.kind) {
    case 'unauthorized':
      return 401
    case 'forbidden':
    case 'playlist_not_owned':
      return 403
    case 'rate_limited':
      return 429
    default:
      // Spotify (or the way to it) failed, not this request.
      return 502
  }
}

/**
 * The playlist's tracks as TrackWithBpm[], deduped by ID, with whatever BPMs
 * the cache already holds. Never calls GetSongBPM: tracks with bpmSource null
 * still need POST /api/bpm/resolve.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/tracks'>
): Promise<Response> {
  const { id } = await ctx.params

  const token = await getAccessToken()
  if (!token) {
    return (await hasSession())
      ? errorResponse(401, 'refresh_failed', REFRESH_FAILED_MESSAGE)
      : errorResponse(401, 'unauthorized', 'Not logged in to Spotify.')
  }

  try {
    return Response.json(await withCachedBpm(dedupeById(await getPlaylistTracks(token, id))))
  } catch (err) {
    if (err instanceof SpotifyError) {
      return errorResponse(statusFor(err), err.kind, messageForSpotifyError(err))
    }
    if (err instanceof BpmCacheError) {
      console.error('[tracks] BPM cache unavailable:', err.message)
      return errorResponse(500, 'cache', `The BPM cache could not be read: ${err.message}`)
    }
    throw err
  }
}
