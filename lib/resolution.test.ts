import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RESOLVE_ITEMS,
  dedupeById,
  fetchPlaylistTracks,
  initialTrackListState,
  parseResolveItems,
  postResolve,
  resolveInChunks,
  summarize,
  toResolveItem,
  trackListReducer,
  type ResolveItem,
  type ResolveResponse,
} from './resolution'
import type { TrackWithBpm } from './types'

function track(id: string, bpm: number | null = null, bpmSource: TrackWithBpm['bpmSource'] = null): TrackWithBpm {
  return { id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: ['A', 'B'], durationMs: 200_000, bpm, bpmSource }
}

function items(n: number): ResolveItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}`, artist: 'A', title: `Song ${i}` }))
}

const ok = (chunk: ResolveItem[]): ResolveResponse => ({
  results: chunk.map((i) => ({ id: i.id, status: 'resolved', bpm: 120, bpmSource: 'api' })),
  stop: null,
})

describe('dedupeById', () => {
  it('keeps the first occurrence of each ID, in order', () => {
    const out = dedupeById([track('a', 1, 'api'), track('b'), track('a'), track('c'), track('b')])
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(out[0].bpm).toBe(1)
  })
})

describe('toResolveItem', () => {
  it('sends the primary artist only', () => {
    expect(toResolveItem(track('x'))).toEqual({ id: 'x', artist: 'A', title: 'Song x' })
  })
})

describe('parseResolveItems', () => {
  it('accepts a list of { id, artist, title } and dedupes it', () => {
    const body = [
      { id: 'a', artist: 'A', title: 'T', extra: 1 },
      { id: 'a', artist: 'A', title: 'T' },
      { id: 'b', artist: '', title: 'U' },
    ]
    expect(parseResolveItems(body)).toEqual([
      { id: 'a', artist: 'A', title: 'T' },
      { id: 'b', artist: '', title: 'U' },
    ])
  })

  it.each([
    ['a non-array', { id: 'a', artist: 'A', title: 'T' }],
    ['a missing id', [{ artist: 'A', title: 'T' }]],
    ['an empty id', [{ id: '', artist: 'A', title: 'T' }]],
    ['a non-string title', [{ id: 'a', artist: 'A', title: 3 }]],
    ['a null entry', [null]],
    ['too many items', items(MAX_RESOLVE_ITEMS + 1)],
  ])('rejects %s', (_, body) => {
    expect(parseResolveItems(body)).toBeNull()
  })
})

describe('resolveInChunks', () => {
  it('posts chunks in order and reports each one', async () => {
    const post = vi.fn(async (chunk: ResolveItem[]) => ok(chunk))
    const onChunk = vi.fn()
    expect(await resolveInChunks(items(45), { post, onChunk, chunkSize: 20 })).toBeNull()
    expect(post.mock.calls.map(([c]) => c.length)).toEqual([20, 20, 5])
    expect(post.mock.calls[1][0][0].id).toBe('t20')
    expect(onChunk).toHaveBeenCalledTimes(3)
  })

  it('stops sending chunks once the server reports a stop', async () => {
    const post = vi.fn(async (chunk: ResolveItem[]) => ({
      results: chunk.map((i) => ({ id: i.id, status: 'unresolved' as const, reason: 'key' })),
      stop: { kind: 'auth', message: 'GetSongBPM key invalid' },
    }))
    const onChunk = vi.fn()
    expect(await resolveInChunks(items(45), { post, onChunk, chunkSize: 20 })).toBe('GetSongBPM key invalid')
    expect(post).toHaveBeenCalledTimes(1)
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('stops with the error message when a request fails', async () => {
    const post = vi
      .fn<(chunk: ResolveItem[]) => Promise<ResolveResponse>>()
      .mockImplementationOnce(async (chunk) => ok(chunk))
      .mockRejectedValueOnce(new Error('server down'))
    expect(await resolveInChunks(items(45), { post, onChunk: () => {}, chunkSize: 20 })).toBe('server down')
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('stops quietly once aborted', async () => {
    const controller = new AbortController()
    const onChunk = vi.fn()
    const post = vi.fn(async (chunk: ResolveItem[]) => {
      controller.abort()
      return ok(chunk)
    })
    expect(await resolveInChunks(items(45), { post, onChunk, signal: controller.signal, chunkSize: 20 })).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
    expect(onChunk).not.toHaveBeenCalled()
  })

  it('sends nothing for an empty list', async () => {
    const post = vi.fn()
    expect(await resolveInChunks([], { post, onChunk: () => {} })).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('trackListReducer', () => {
  const loaded = trackListReducer(initialTrackListState, {
    type: 'loaded',
    tracks: [track('a', 128, 'manual'), track('b'), track('c'), track('b')],
  })

  it('dedupes tracks on load', () => {
    expect(loaded.phase).toBe('idle')
    expect(loaded.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('sets one track’s BPM without touching progress', () => {
    const s = trackListReducer(loaded, { type: 'set-bpm', id: 'b', bpm: 172, bpmSource: 'synthetic' })
    expect(s.tracks[1]).toMatchObject({ id: 'b', bpm: 172, bpmSource: 'synthetic' })
    expect(s.tracks[0]).toBe(loaded.tracks[0])
    expect(s.progress).toEqual(loaded.progress)
    expect(loaded.tracks[1].bpm).toBeNull()
  })

  it('merges resolved results and records failures', () => {
    let s = trackListReducer(loaded, { type: 'resolve-start', total: 2 })
    expect(s.phase).toBe('resolving')
    s = trackListReducer(s, {
      type: 'chunk',
      results: [
        { id: 'b', status: 'resolved', bpm: null, bpmSource: 'api' },
        { id: 'c', status: 'unresolved', reason: 'Could not reach GetSongBPM.' },
      ],
    })
    expect(s.tracks[1]).toMatchObject({ id: 'b', bpm: null, bpmSource: 'api' })
    expect(s.tracks[2]).toMatchObject({ id: 'c', bpm: null, bpmSource: null })
    expect(s.failed).toEqual({ c: 'Could not reach GetSongBPM.' })
    expect(s.progress).toEqual({ done: 2, total: 2 })

    s = trackListReducer(s, { type: 'resolve-end', stop: 'rate limit' })
    expect(s).toMatchObject({ phase: 'idle', error: 'rate limit' })

    // A retry clears the previous pass's failures and stop reason.
    s = trackListReducer(s, { type: 'resolve-start', total: 1 })
    expect(s).toMatchObject({ phase: 'resolving', error: null, failed: {}, progress: { done: 0, total: 1 } })
  })

  it('keeps the load error', () => {
    expect(trackListReducer(initialTrackListState, { type: 'load-failed', message: 'nope' })).toMatchObject({
      phase: 'load-error',
      error: 'nope',
    })
  })
})

describe('summarize', () => {
  it('counts values, misses and tracks still without an answer', () => {
    const tracks = [track('a', 120, 'api'), track('b', 90, 'synthetic'), track('c', null, 'api'), track('d')]
    expect(summarize(tracks)).toEqual({ total: 4, withBpm: 2, misses: 1, pending: 1 })
  })
})

describe('fetch wrappers', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads tracks from the playlist route', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([track('a')]))
    expect(await fetchPlaylistTracks('p/1')).toEqual([track('a')])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/playlists/p%2F1/tracks')
  })

  it("throws the route's error message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { kind: 'playlist_not_owned', message: 'Only your own playlists' } }, { status: 403 })
    )
    await expect(fetchPlaylistTracks('p')).rejects.toThrow('Only your own playlists')
  })

  it('falls back to the status when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 500 }))
    await expect(postResolve(items(1))).rejects.toThrow('BPM lookup failed (HTTP 500)')
  })

  it('posts the items as a JSON array', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(ok(items(2))))
    await postResolve(items(2))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/bpm/resolve')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(items(2))
  })

  it('reports an unreachable server plainly', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(postResolve(items(1))).rejects.toThrow(/Could not reach the cadence server/)
  })
})
