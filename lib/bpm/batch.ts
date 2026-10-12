import 'server-only'
import type { ResolveItem, ResolveResponse, ResolveResult } from '../resolution'
import type { Track, TrackWithBpm } from '../types'
import * as cache from './cache'
import { BpmCacheError } from './cache'
import { GetSongBpmError } from './getsongbpm'
import { getBpm } from './index'

// Many-track wrappers over the cache and getBpm, for the playlist routes.

/**
 * Attaches whatever the cache already knows, without touching the network.
 * Tracks with no entry, or with a miss old enough to be re-queried, come back
 * unresolved (bpmSource null) so the client sends them to the resolver.
 */
export async function withCachedBpm(tracks: Track[]): Promise<TrackWithBpm[]> {
  return Promise.all(
    tracks.map(async (track) => {
      const entry = await cache.get(track.id)
      return entry && !cache.needsLookup(entry)
        ? { ...track, bpm: entry.bpm, bpmSource: entry.source }
        : { ...track, bpm: null, bpmSource: null }
    })
  )
}

// GetSongBPM failures that are about one request, not the service. Every
// other kind means the remaining lookups would fail the same way.
const PER_TRACK_KINDS = new Set(['network', 'timeout', 'http'])

function isFatal(err: unknown): boolean {
  if (err instanceof BpmCacheError) return true
  return err instanceof GetSongBpmError && !PER_TRACK_KINDS.has(err.kind)
}

// The kind behind a stop. An open breaker reports the error that tripped it.
function stopKind(err: unknown): string {
  if (err instanceof BpmCacheError) return 'cache'
  const e = err as GetSongBpmError
  return e.kind === 'circuit-open' && e.cause instanceof GetSongBpmError ? e.cause.kind : e.kind
}

/** User-facing wording for a lookup error. Never includes the API key. */
export function messageForBpmError(err: unknown): string {
  if (err instanceof BpmCacheError) return `The BPM cache could not be read: ${err.message}`
  if (!(err instanceof GetSongBpmError)) return 'BPM lookup failed unexpectedly'
  switch (err.kind) {
    case 'config':
      return 'GetSongBPM is not configured: set GETSONGBPM_API_KEY in .env.local and restart.'
    case 'auth':
      return err.status === 401
        ? 'GetSongBPM key invalid or inactive. Lookups are paused for an hour, or until the key changes.'
        : 'GetSongBPM refused the request (403). Lookups are paused for an hour, or until the key changes.'
    case 'rate-limit':
      return 'GetSongBPM rate limit hit. Try again in an hour.'
    case 'budget':
      return "This hour's GetSongBPM lookup budget is used up. Try again in an hour."
    case 'invalid-response':
      return 'GetSongBPM returned an unexpected response. Lookups are paused for an hour.'
    case 'circuit-open':
      // The breaker carries the error that tripped it.
      return err.cause instanceof GetSongBpmError
        ? messageForBpmError(err.cause)
        : 'GetSongBPM lookups are paused for an hour after an earlier failure.'
    case 'http':
      return `GetSongBPM is unavailable (HTTP ${err.status ?? '?'}).`
    case 'network':
      return 'Could not reach GetSongBPM.'
    case 'timeout':
      return 'GetSongBPM did not answer in time.'
  }
}

/**
 * Resolves a batch through getBpm (which owns caching, concurrency and the
 * budget). A failed lookup comes back 'unresolved', never as a miss; the
 * first error that dooms the remaining lookups is reported as `stop`.
 */
export async function resolveBatch(items: ResolveItem[]): Promise<ResolveResponse> {
  const outcomes = await Promise.allSettled(items.map((i) => getBpm(i.id, i.artist, i.title)))

  let stop: ResolveResponse['stop'] = null
  const results = outcomes.map((outcome, n): ResolveResult => {
    const { id } = items[n]
    if (outcome.status === 'fulfilled') {
      return { id, status: 'resolved', bpm: outcome.value.bpm, bpmSource: outcome.value.source }
    }
    const err = outcome.reason
    if (!(err instanceof GetSongBpmError) && !(err instanceof BpmCacheError)) {
      console.error('[bpm] unexpected lookup error:', err)
    }
    const message = messageForBpmError(err)
    if (!stop && isFatal(err)) stop = { kind: stopKind(err), message }
    return { id, status: 'unresolved', reason: message }
  })

  return { results, stop }
}
