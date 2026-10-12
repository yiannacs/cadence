import type { NextRequest } from 'next/server'
import { resolveBatch } from '@/lib/bpm/batch'
import { MAX_RESOLVE_ITEMS, parseResolveItems } from '@/lib/resolution'
import { hasSession } from '@/lib/spotify/session'

function errorResponse(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status })
}

/**
 * Body: [{ id, artist, title }], at most MAX_RESOLVE_ITEMS, `artist` being
 * the primary artist. Returns a ResolveResponse: one result per distinct ID,
 * plus a stop reason when further lookups would be pointless.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // `next dev -H 0.0.0.0` exposes this route to the LAN; without this, anyone
  // there could burn the GetSongBPM budget. Proxy skips /api/bpm, so this is
  // a presence check, not a refresh.
  if (!(await hasSession())) return errorResponse(401, 'unauthorized', 'Not logged in to Spotify.')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'bad_request', 'Request body must be JSON.')
  }
  const items = parseResolveItems(body)
  if (!items) {
    return errorResponse(
      400,
      'bad_request',
      `Expected an array of at most ${MAX_RESOLVE_ITEMS} { id, artist, title } objects.`
    )
  }

  const response = await resolveBatch(items)
  if (response.stop) console.error(`[bpm] lookups stopped (${response.stop.kind}): ${response.stop.message}`)
  return Response.json(response)
}
