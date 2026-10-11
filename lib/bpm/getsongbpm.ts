import 'server-only'
import { lookupQuery, pickMatch, searchTitles, type Candidate, type Match } from './normalize'

// GetSongBPM search client. Only ever returns 'hit' or 'miss' — the two
// answers worth caching. Everything else throws: a bad key, a rate block or an
// outage must never be stored as a 30-day "no BPM" for every track.

const SEARCH_URL = 'https://api.getsong.co/search/' // trailing slash required
const TIMEOUT_MS = 10_000
const RESULT_LIMIT = 5

const MAX_CONCURRENT = 3
// GetSongBPM blocks the key for an hour past 3000 requests/hour. Stay well under.
const HOURLY_BUDGET = 2500
const HOUR_MS = 60 * 60 * 1000

export type BpmLookup = ({ kind: 'hit' } & Match) | { kind: 'miss' }

export type GetSongBpmErrorKind =
  | 'config' // no API key configured
  | 'auth' // 401 / 403
  | 'rate-limit' // 429
  | 'http' // any other non-200
  | 'invalid-response' // not JSON, or JSON we don't recognise
  | 'network'
  | 'timeout'
  | 'budget' // our own hourly cap reached
  | 'circuit-open' // an earlier fatal response stopped all lookups

export class GetSongBpmError extends Error {
  constructor(
    readonly kind: GetSongBpmErrorKind,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'GetSongBpmError'
  }
}

interface Job {
  start: () => Promise<void>
  reject: (err: unknown) => void
}

interface ClientState {
  active: number
  queue: Job[]
  // Start times of requests in the last hour.
  sent: number[]
  // Set by the first fatal response. Lookups stay off for an hour (the length
  // of GetSongBPM's block) or until the key changes, whichever comes first.
  breaker: { error: GetSongBpmError; at: number; apiKey: string } | null
}

// On globalThis so dev-mode HMR shares one limiter instead of stacking several.
const globalForClient = globalThis as typeof globalThis & { __cadenceGetSongBpm?: ClientState }
const state = (globalForClient.__cadenceGetSongBpm ??= {
  active: 0,
  queue: [],
  sent: [],
  breaker: null,
})

function apiKey(): string {
  const key = process.env.GETSONGBPM_API_KEY
  if (!key) throw new GetSongBpmError('config', 'GETSONGBPM_API_KEY is not set')
  return key
}

function openBreaker(): GetSongBpmError | null {
  const b = state.breaker
  if (!b) return null
  if (Date.now() - b.at > HOUR_MS || b.apiKey !== process.env.GETSONGBPM_API_KEY) {
    state.breaker = null
    return null
  }
  return new GetSongBpmError('circuit-open', `GetSongBPM lookups stopped: ${b.error.message}`, b.error.status, {
    cause: b.error,
  })
}

function trip(error: GetSongBpmError, key: string): void {
  state.breaker = { error, at: Date.now(), apiKey: key }
  const open = openBreaker()
  for (const job of state.queue.splice(0)) job.reject(open)
}

function pump(): void {
  while (state.active < MAX_CONCURRENT && state.queue.length > 0) {
    const job = state.queue.shift()!
    const open = openBreaker()
    if (open) {
      job.reject(open)
      continue
    }
    const now = Date.now()
    state.sent = state.sent.filter((t) => now - t < HOUR_MS)
    if (state.sent.length >= HOURLY_BUDGET) {
      job.reject(new GetSongBpmError('budget', `Hourly GetSongBPM budget of ${HOURLY_BUDGET} requests used up`))
      continue
    }
    state.sent.push(now)
    state.active++
    void job.start().finally(() => {
      state.active--
      pump()
    })
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    state.queue.push({ start: () => task().then(resolve, reject), reject })
    pump()
  })
}

// Statuses that mean every following request would fail the same way.
function isFatal(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 429 || status >= 500
}

function httpError(status: number): GetSongBpmError {
  if (status === 401) return new GetSongBpmError('auth', 'GetSongBPM API key is invalid or inactive (401)', status)
  if (status === 403) return new GetSongBpmError('auth', 'GetSongBPM refused the request (403)', status)
  if (status === 429) return new GetSongBpmError('rate-limit', 'GetSongBPM rate limit hit (429)', status)
  return new GetSongBpmError('http', `GetSongBPM responded ${status}`, status)
}

function parseCandidates(body: unknown): Candidate[] | null {
  const search = (body as { search?: unknown } | null)?.search
  // A miss is a 200 with {"search":{"error":"no result"}} — an object, not [].
  if (search && !Array.isArray(search) && (search as { error?: unknown }).error === 'no result') return []
  if (!Array.isArray(search)) return null

  const out: Candidate[] = []
  for (const item of search) {
    const { id, title, tempo, artist } = item ?? {}
    // tempo arrives as a string ("123"); artist is an object.
    if (typeof title !== 'string' || typeof artist?.name !== 'string') continue
    if (typeof tempo !== 'string' && typeof tempo !== 'number') continue
    out.push({ id: String(id), title, artist: artist.name, tempo: String(tempo) })
  }
  return out
}

async function search(artist: string, title: string): Promise<Candidate[]> {
  const key = apiKey()
  return enqueue(async () => {
    const url = `${SEARCH_URL}?${new URLSearchParams({
      type: 'both',
      lookup: lookupQuery(artist, title),
      limit: String(RESULT_LIMIT),
    })}`

    let status: number
    let text: string
    try {
      const res = await fetch(url, {
        headers: { 'X-API-KEY': key, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      status = res.status
      text = await res.text()
    } catch (err) {
      const name = (err as Error | null)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new GetSongBpmError('timeout', `GetSongBPM did not answer within ${TIMEOUT_MS / 1000}s`, undefined, {
          cause: err,
        })
      }
      throw new GetSongBpmError('network', `Could not reach GetSongBPM: ${(err as Error)?.message}`, undefined, {
        cause: err,
      })
    }

    if (status !== 200) {
      const error = httpError(status)
      if (isFatal(status)) trip(error, key)
      throw error
    }

    // Don't trust content-type: errors come back as text/html with a JSON body.
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (err) {
      const error = new GetSongBpmError('invalid-response', 'GetSongBPM returned a non-JSON response', status, {
        cause: err,
      })
      trip(error, key)
      throw error
    }

    const candidates = parseCandidates(body)
    if (!candidates) {
      const error = new GetSongBpmError('invalid-response', 'GetSongBPM returned an unrecognised response', status)
      trip(error, key)
      throw error
    }
    return candidates
  })
}

/**
 * Looks up the BPM of a track by its primary artist and title. At most two
 * requests: the cleaned title, then — only on a miss, and only if different —
 * the title with its parentheticals kept.
 */
export async function lookupBpm(artist: string, title: string): Promise<BpmLookup> {
  for (const query of searchTitles(title)) {
    const found = pickMatch(artist, title, await search(artist, query))
    if (found) return { kind: 'hit', ...found }
  }
  return { kind: 'miss' }
}

/** Test seam — clears the limiter, hourly budget and breaker. */
export function __resetForTests(): void {
  state.active = 0
  state.queue = []
  state.sent = []
  state.breaker = null
}
