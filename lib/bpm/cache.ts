import 'server-only'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BpmCacheFile, BpmEntry, BpmSource } from './types'

// The cache file is owned by the running server: it keeps the whole cache in
// memory and rewrites the file on every change. Stop the dev server before
// hand-editing data/bpm-cache.json, or the next flush silently overwrites the
// edit.

// How long a negative result (bpm: null) stays trusted before we ask again.
// GetSongBPM's catalogue grows; a miss today may be a hit next month.
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Read lazily so tests can point BPM_CACHE_PATH at a temp file.
function cachePath(): string {
  return path.resolve(process.env.BPM_CACHE_PATH ?? path.join('data', 'bpm-cache.json'))
}

export class BpmCacheError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BpmCacheError'
  }
}

interface CacheState {
  // The whole cache lives here once loaded. Every read and write goes through
  // this Map, never straight to disk — one copy of the truth means callers
  // can't clobber each other with stale snapshots.
  memory: Map<string, BpmEntry> | null
  // In-flight load, so N concurrent callers trigger one read rather than N.
  loading: Promise<Map<string, BpmEntry>> | null
  // Flushes run strictly one at a time: each hooks onto the tail of this chain.
  writeChain: Promise<void>
  // A flush waiting behind the running one. It serialises memory when it
  // starts, so every write that lands before then rides along with it.
  queuedFlush: Promise<void> | null
}

// Module state lives on globalThis: Turbopack's server HMR re-creates modules
// in dev, and a stale instance with its own Map would keep flushing old data.
const globalForCache = globalThis as typeof globalThis & { __cadenceBpmCache?: CacheState }
const state = (globalForCache.__cadenceBpmCache ??= {
  memory: null,
  loading: null,
  writeChain: Promise.resolve(),
  queuedFlush: null,
})

async function load(): Promise<Map<string, BpmEntry>> {
  if (state.memory) return state.memory
  if (state.loading) return state.loading

  state.loading = (async () => {
    const file = cachePath()
    let parsed: BpmCacheFile = {}
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (err: unknown) {
      // A missing file is the normal first-run case. Anything else is real,
      // and must never degrade to an empty cache: the next flush would wipe
      // the user's manual and synthetic entries.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new BpmCacheError(`Could not load BPM cache at ${file}: ${(err as Error).message}`, {
          cause: err,
        })
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BpmCacheError(`BPM cache at ${file} is not a JSON object`)
    }
    state.memory = new Map(Object.entries(parsed))
    return state.memory
  })()

  try {
    return await state.loading
  } finally {
    // Cleared on failure too, so a fixed file recovers without a restart.
    state.loading = null
  }
}

async function flushNow(): Promise<void> {
  if (!state.memory) return
  const file = cachePath()
  const serialized = JSON.stringify(Object.fromEntries(state.memory), null, 2)
  // Unique per flush: a pid alone collides across module instances.
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`

  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(tmp, serialized, 'utf8')
    // Rename is atomic: a crash mid-write leaves the old good cache in place
    // rather than a half-written file.
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

// At most one flush running plus one queued; later writes join the queued one.
// The handler runs on both outcomes so a failed write doesn't poison the
// chain and block every flush after it.
function scheduleFlush(): Promise<void> {
  if (state.queuedFlush) return state.queuedFlush
  const start = () => {
    state.queuedFlush = null
    return flushNow()
  }
  state.queuedFlush = state.writeChain.then(start, start)
  state.writeChain = state.queuedFlush
  return state.queuedFlush
}

export async function get(trackId: string): Promise<BpmEntry | undefined> {
  return (await load()).get(trackId)
}

const RANK: Record<BpmSource, number> = { synthetic: 0, api: 1, manual: 2 }

/**
 * Writes an entry, enforcing the precedence rule synthetic < api < manual: a
 * cached value is only replaced by a value of equal or higher rank. A miss
 * (bpm: null) never erases a value, while anything may replace a miss — that
 * is the case synthetic exists for. Keeping real data distinguishable from
 * guesses is what stops the cache rotting into self-confirming nonsense.
 *
 * Enforced here rather than by callers: a synthetic write can land between
 * the get() and set() of an in-flight lookup.
 *
 * Returns the entry actually stored — the existing one if the write was refused.
 */
export async function set(
  trackId: string,
  entry: Omit<BpmEntry, 'updatedAt'> & { updatedAt?: string }
): Promise<BpmEntry> {
  const cache = await load()
  const existing = cache.get(trackId)

  if (
    existing &&
    existing.bpm !== null &&
    (entry.bpm === null || RANK[entry.source] < RANK[existing.source])
  ) {
    return existing
  }

  const stored: BpmEntry = {
    bpm: entry.bpm,
    tolerance: entry.tolerance,
    source: entry.source,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  }
  cache.set(trackId, stored)

  await scheduleFlush()
  return stored
}

/** True when we should hit the API rather than trust what we have. */
export function needsLookup(entry: BpmEntry | undefined): boolean {
  if (!entry) return true
  // A real BPM from any source is good enough to skip the network.
  if (entry.bpm !== null) return false
  return Date.now() - Date.parse(entry.updatedAt) > MISS_TTL_MS
}

/** Test seam — waits for pending flushes, then drops the in-memory copy so the next call re-reads from disk. */
export async function __resetForTests(): Promise<void> {
  await state.writeChain.catch(() => {})
  state.memory = null
  state.loading = null
  state.queuedFlush = null
  state.writeChain = Promise.resolve()
}

export type { BpmEntry, BpmSource }
