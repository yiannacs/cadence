import 'server-only'
import * as cache from './cache'
import { lookupBpm } from './getsongbpm'
import type { BpmEntry } from './types'

// Client components must import BpmSource from './types' — this module pulls
// in node:fs through the cache.

export { GetSongBpmError } from './getsongbpm'
export { BpmCacheError } from './cache'

// Lookups in progress, by track ID. React Strict Mode runs effects twice in
// dev, so the same track is routinely requested twice at once.
const globalForResolver = globalThis as typeof globalThis & {
  __cadenceBpmInFlight?: Map<string, Promise<BpmEntry>>
}
const inFlight = (globalForResolver.__cadenceBpmInFlight ??= new Map())

async function resolve(trackId: string, artist: string, title: string): Promise<BpmEntry> {
  const cached = await cache.get(trackId)
  // Covers values from every source, so synthetic entries are not re-queried.
  if (cached && !cache.needsLookup(cached)) return cached

  // A thrown lookup caches nothing and propagates to the caller.
  const result = await lookupBpm(artist, title)
  // A miss is cached as bpm: null and retried after the miss TTL. set() may
  // refuse the write (say, a manual value landed meanwhile); it then returns
  // what is actually stored.
  return cache.set(trackId, {
    bpm: result.kind === 'hit' ? result.bpm : null,
    tolerance: null,
    source: 'api',
  })
}

/**
 * The BPM entry for a track: from the cache, or looked up on GetSongBPM and
 * cached. `artist` is the track's primary (first) artist.
 *
 * Throws GetSongBpmError when the lookup fails and BpmCacheError when the
 * cache can't be read; nothing is cached in either case.
 */
export function getBpm(trackId: string, artist: string, title: string): Promise<BpmEntry> {
  const pending = inFlight.get(trackId)
  if (pending) return pending

  const lookup = resolve(trackId, artist, title).finally(() => {
    if (inFlight.get(trackId) === lookup) inFlight.delete(trackId)
  })
  inFlight.set(trackId, lookup)
  return lookup
}

/** Test seam — forgets lookups in progress. */
export function __resetForTests(): void {
  inFlight.clear()
}
