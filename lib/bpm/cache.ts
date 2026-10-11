import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BpmCacheFile, BpmEntry, BpmSource } from './types'

const CACHE_PATH = path.join(process.cwd(), 'data', 'bpm-cache.json')

// How long a negative result (bpm: null) stays trusted before we ask again.
// GetSongBPM's catalogue grows; a miss today may be a hit next month.
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000

// The whole cache lives here once loaded. Every read and write goes through
// this Map, never straight to disk — one copy of the truth means callers can't
// clobber each other with stale snapshots.
let memory: Map<string, BpmEntry> | null = null

// In-flight load, so N concurrent callers trigger one read rather than N.
let loading: Promise<Map<string, BpmEntry>> | null = null

async function load(): Promise<Map<string, BpmEntry>> {
  if (memory) return memory
  if (loading) return loading

  loading = (async () => {
    let parsed: BpmCacheFile = {}
    try {
      parsed = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'))
    } catch (err: unknown) {
      // A missing file is the normal first-run case. Anything else is real.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    memory = new Map(Object.entries(parsed))
    loading = null
    return memory
  })()

  return loading
}

// Flushes run strictly one at a time: each hooks onto the tail of this chain.
// Both handlers are the same function so a failed write doesn't poison the
// chain and block every flush after it.
let writeChain: Promise<void> = Promise.resolve()

async function flushNow(): Promise<void> {
  if (!memory) return
  const serialized = JSON.stringify(Object.fromEntries(memory), null, 2)
  const tmp = `${CACHE_PATH}.${process.pid}.tmp`

  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true })
  await fs.writeFile(tmp, serialized, 'utf8')
  // Rename is atomic: a crash mid-write leaves the old good cache in place
  // rather than a half-written file.
  await fs.rename(tmp, CACHE_PATH)
}

function scheduleFlush(): Promise<void> {
  writeChain = writeChain.then(flushNow, flushNow)
  return writeChain
}

export async function get(trackId: string): Promise<BpmEntry | undefined> {
  return (await load()).get(trackId)
}

/**
 * Writes an entry, enforcing the precedence rule: api and manual always win
 * over synthetic, and synthetic never overwrites them. Keeping real data
 * distinguishable from guesses is what stops the cache rotting into
 * self-confirming nonsense.
 *
 * Returns whether the write was accepted.
 */
export async function set(
  trackId: string,
  entry: Omit<BpmEntry, 'updatedAt'> & { updatedAt?: string }
): Promise<boolean> {
  const cache = await load()
  const existing = cache.get(trackId)

  if (entry.source === 'synthetic' && existing && existing.source !== 'synthetic') {
    return false
  }

  cache.set(trackId, {
    bpm: entry.bpm,
    tolerance: entry.tolerance,
    source: entry.source,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  })

  await scheduleFlush()
  return true
}

/** True when we should hit the API rather than trust what we have. */
export function needsLookup(entry: BpmEntry | undefined): boolean {
  if (!entry) return true
  // A real BPM from any source is good enough to skip the network.
  if (entry.bpm !== null) return false
  return Date.now() - Date.parse(entry.updatedAt) > MISS_TTL_MS
}

/** Test seam — drops the in-memory copy so the next call re-reads from disk. */
export function __resetForTests(): void {
  memory = null
  loading = null
}

export type { BpmEntry, BpmSource }
