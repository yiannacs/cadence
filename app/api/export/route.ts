import type { NextRequest } from 'next/server'
import { parseExportRequest, runExport, type ExportPartialBody, type ExportResponse } from '@/lib/export'
import { SpotifyError, addTracks, createPlaylist } from '@/lib/spotify/api'
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

function describe(err: unknown): { status: number; kind: string; message: string } {
  if (err instanceof SpotifyError) {
    return { status: statusFor(err), kind: err.kind, message: messageForSpotifyError(err) }
  }
  console.error('[export] unexpected error:', (err as Error)?.message ?? err)
  return { status: 500, kind: 'internal', message: 'The export failed unexpectedly.' }
}

/**
 * Body: { name, public, uris, description? } — URIs in play order. Creates a
 * new playlist on the user's profile and adds the tracks in chunks of 100, in
 * order. 200 → ExportResponse. If the playlist was created but adding stopped
 * early, the error response also carries `playlist`, `added` and `total`
 * (ExportPartialBody) so the user can find the half-filled playlist.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const token = await getAccessToken()
  if (!token) {
    return (await hasSession())
      ? errorResponse(401, 'refresh_failed', REFRESH_FAILED_MESSAGE)
      : errorResponse(401, 'unauthorized', 'Not logged in to Spotify.')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'bad_request', 'Request body must be JSON.')
  }
  const req = parseExportRequest(body)
  if (!req) {
    return errorResponse(
      400,
      'bad_request',
      'Expected { name, public, uris, description? } with a name and 1–10,000 spotify:track: URIs.'
    )
  }

  let outcome
  try {
    outcome = await runExport(req, {
      createPlaylist: (opts) => createPlaylist(token, opts),
      addTracks: (playlistId, uris) => addTracks(token, playlistId, uris),
    })
  } catch (err) {
    // The create failed: nothing exists on Spotify.
    const { status, kind, message } = describe(err)
    return errorResponse(status, kind, message)
  }

  const { playlist, added, total } = outcome
  if (outcome.error === undefined) {
    const response: ExportResponse = { playlist, added, total }
    return Response.json(response)
  }

  const { status, kind, message } = describe(outcome.error)
  const partial: ExportPartialBody = {
    error: { kind, message },
    playlist,
    added,
    total,
  }
  return Response.json(partial, { status })
}
