import type { NextRequest } from 'next/server'
import * as cache from '@/lib/bpm/cache'
import { BpmCacheError } from '@/lib/bpm/cache'
import { parseSyntheticWrite, type SyntheticResponse } from '@/lib/editor'
import { hasSession } from '@/lib/spotify/session'

function errorResponse(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status })
}

/**
 * Body: { trackId, bpm, tolerance } — the center and spread of the stage a
 * no-BPM track was dropped into. Caches it as a synthetic entry; the cache's
 * precedence rule keeps any real value already there. Returns the entry the
 * cache actually holds, as a SyntheticResponse.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Same guard as /api/bpm/resolve: the dev server is exposed to the LAN, and
  // proxy skips /api/bpm, so this is a presence check, not a refresh.
  if (!(await hasSession())) return errorResponse(401, 'unauthorized', 'Not logged in to Spotify.')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'bad_request', 'Request body must be JSON.')
  }
  const write = parseSyntheticWrite(body)
  if (!write) {
    return errorResponse(400, 'bad_request', 'Expected { trackId, bpm, tolerance } with a positive BPM.')
  }

  try {
    const stored = await cache.set(write.trackId, { bpm: write.bpm, tolerance: write.tolerance, source: 'synthetic' })
    const response: SyntheticResponse = { bpm: stored.bpm, tolerance: stored.tolerance, bpmSource: stored.source }
    return Response.json(response)
  } catch (err) {
    const message =
      err instanceof BpmCacheError ? `The BPM cache could not be read: ${err.message}` : 'The BPM cache could not be written.'
    console.error(`[bpm] synthetic write failed: ${(err as Error).message}`)
    return errorResponse(500, 'cache', message)
  }
}
