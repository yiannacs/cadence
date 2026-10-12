import type { BpmSource } from './bpm/types'
import type { Track, TrackWithBpm } from './types'

// Client side of BPM resolution: the wire contract of /api/playlists/[id]/tracks
// and /api/bpm/resolve, plus the chunked resolve loop and its state. Kept free
// of server-only imports — the builder page imports this file.

// Tracks per POST /api/bpm/resolve. Small enough that each chunk returns in a
// few seconds behind GetSongBPM's concurrency limit, so progress moves.
export const RESOLVE_CHUNK_SIZE = 20
// Upper bound the route accepts per request.
export const MAX_RESOLVE_ITEMS = 50

export interface ResolveItem {
  id: string
  artist: string // primary artist only
  title: string
}

export type ResolveResult =
  // bpm null with bpmSource 'api' is a miss: looked up, no match.
  | { id: string; status: 'resolved'; bpm: number | null; bpmSource: BpmSource }
  // The lookup errored; nothing was cached and the track is retried next time.
  | { id: string; status: 'unresolved'; reason: string }

export interface ResolveResponse {
  results: ResolveResult[]
  // Set when no further lookups can succeed for now (bad key, rate block,
  // budget used up, broken cache). The client stops sending chunks.
  stop: { kind: string; message: string } | null
}

// Body of every non-2xx response from the app's own API routes.
export interface ApiErrorBody {
  error: { kind: string; message: string }
}

/** Keeps the first occurrence of each track ID. */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** True for tracks with no settled BPM answer yet — never looked up, or the lookup errored. */
export function needsResolution(track: TrackWithBpm): boolean {
  return track.bpmSource === null
}

export function toResolveItem(track: Track): ResolveItem {
  return { id: track.id, artist: track.artists[0] ?? '', title: track.name }
}

/** Validates a POST /api/bpm/resolve body. Null when it's malformed. */
export function parseResolveItems(body: unknown): ResolveItem[] | null {
  if (!Array.isArray(body) || body.length > MAX_RESOLVE_ITEMS) return null
  const items: ResolveItem[] = []
  for (const raw of body) {
    const { id, artist, title } = (raw ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || !id) return null
    if (typeof artist !== 'string' || typeof title !== 'string') return null
    items.push({ id, artist, title })
  }
  return dedupeById(items)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Sends `items` to the resolver one chunk at a time, calling `onChunk` as each
 * returns. Returns why it stopped early — the server's stop reason or a failed
 * request — or null once every chunk is through (or `signal` aborted).
 */
export async function resolveInChunks(
  items: ResolveItem[],
  {
    post,
    onChunk,
    signal,
    chunkSize = RESOLVE_CHUNK_SIZE,
  }: {
    post: (chunk: ResolveItem[]) => Promise<ResolveResponse>
    onChunk: (response: ResolveResponse) => void
    signal?: AbortSignal
    chunkSize?: number
  }
): Promise<string | null> {
  for (const part of chunk(items, chunkSize)) {
    if (signal?.aborted) return null
    let response: ResolveResponse
    try {
      response = await post(part)
    } catch (err) {
      if (signal?.aborted) return null
      return (err as Error).message
    }
    if (signal?.aborted) return null
    onChunk(response)
    if (response.stop) return response.stop.message
  }
  return null
}

// ---- Fetch wrappers for the app's own routes ----

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function call<T>(url: string, init: RequestInit, what: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new Error('Could not reach the cadence server. Is it still running?')
  }
  const body = await readJson(res)
  if (!res.ok) {
    const message = (body as ApiErrorBody | null)?.error?.message
    throw new Error(message || `${what} failed (HTTP ${res.status})`)
  }
  return body as T
}

export function fetchPlaylistTracks(playlistId: string, signal?: AbortSignal): Promise<TrackWithBpm[]> {
  return call(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, { signal }, 'Loading tracks')
}

export function postResolve(items: ResolveItem[], signal?: AbortSignal): Promise<ResolveResponse> {
  return call(
    '/api/bpm/resolve',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
      signal,
    },
    'BPM lookup'
  )
}

// ---- Track list state ----

export interface TrackListState {
  phase: 'loading' | 'load-error' | 'resolving' | 'idle'
  tracks: TrackWithBpm[]
  // Why loading failed, or why resolution stopped early.
  error: string | null
  // Per-track lookup errors from the last pass, by track ID.
  failed: Record<string, string>
  // Lookups answered in the current pass, out of `total`.
  progress: { done: number; total: number }
}

export type TrackListAction =
  | { type: 'loaded'; tracks: TrackWithBpm[] }
  | { type: 'load-failed'; message: string }
  | { type: 'resolve-start'; total: number }
  | { type: 'chunk'; results: ResolveResult[] }
  | { type: 'resolve-end'; stop: string | null }

export const initialTrackListState: TrackListState = {
  phase: 'loading',
  tracks: [],
  error: null,
  failed: {},
  progress: { done: 0, total: 0 },
}

export function trackListReducer(state: TrackListState, action: TrackListAction): TrackListState {
  switch (action.type) {
    case 'loaded':
      return { ...state, phase: 'idle', tracks: dedupeById(action.tracks), error: null }
    case 'load-failed':
      return { ...state, phase: 'load-error', error: action.message }
    case 'resolve-start':
      // A new pass retries every earlier failure, so they're cleared here.
      return { ...state, phase: 'resolving', error: null, failed: {}, progress: { done: 0, total: action.total } }
    case 'chunk': {
      const resolved = new Map<string, ResolveResult & { status: 'resolved' }>()
      const failed = { ...state.failed }
      for (const r of action.results) {
        if (r.status === 'resolved') resolved.set(r.id, r)
        else failed[r.id] = r.reason
      }
      const tracks = state.tracks.map((t) => {
        const r = resolved.get(t.id)
        return r ? { ...t, bpm: r.bpm, bpmSource: r.bpmSource } : t
      })
      const done = Math.min(state.progress.total, state.progress.done + action.results.length)
      return { ...state, tracks, failed, progress: { ...state.progress, done } }
    }
    case 'resolve-end':
      return { ...state, phase: 'idle', error: action.stop }
  }
}

export interface TrackListSummary {
  total: number
  withBpm: number
  misses: number // looked up, no match
  pending: number // no answer yet: not looked up, or the lookup errored
}

export function summarize(tracks: TrackWithBpm[]): TrackListSummary {
  let withBpm = 0
  let misses = 0
  for (const t of tracks) {
    if (t.bpm !== null) withBpm++
    else if (t.bpmSource !== null) misses++
  }
  return { total: tracks.length, withBpm, misses, pending: tracks.length - withBpm - misses }
}
