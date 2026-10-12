import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SpotifyError,
  addTracks,
  createPlaylist,
  getMe,
  getMyPlaylists,
  getPlaylist,
  getPlaylistTracks,
  spotifyFetch,
} from './api'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function spotifyErrorBody(status: number, message: string, headers: HeadersInit = {}): Response {
  return json({ error: { status, message } }, { status, headers })
}

function calledUrl(i: number): string {
  return String(fetchMock.mock.calls[i][0])
}

async function caught(p: Promise<unknown>): Promise<SpotifyError> {
  try {
    await p
  } catch (err) {
    return err as SpotifyError
  }
  throw new Error('expected a rejection')
}

function rawTrack(n: number) {
  return {
    type: 'track',
    id: `t${n}`,
    uri: `spotify:track:t${n}`,
    name: `Song ${n}`,
    duration_ms: 200_000 + n,
    artists: [{ name: `Artist ${n}` }],
  }
}

describe('spotifyFetch', () => {
  it('prefixes paths with the API base and sends the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }))
    await expect(spotifyFetch('tok', '/me')).resolves.toEqual({ ok: true })
    expect(calledUrl(0)).toBe('https://api.spotify.com/v1/me')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('uses absolute URLs as given', async () => {
    fetchMock.mockResolvedValueOnce(json({}))
    await spotifyFetch('tok', 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50')
    expect(calledUrl(0)).toBe('https://api.spotify.com/v1/me/playlists?offset=50&limit=50')
  })

  it('returns undefined for an empty body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(spotifyFetch('tok', '/x')).resolves.toBeUndefined()
  })

  it("passes Spotify's error message through and maps status to kind", async () => {
    fetchMock.mockResolvedValueOnce(spotifyErrorBody(401, 'The access token expired'))
    const err = await caught(spotifyFetch('tok', '/me'))
    expect(err).toBeInstanceOf(SpotifyError)
    expect(err).toMatchObject({ status: 401, kind: 'unauthorized', message: 'The access token expired' })

    fetchMock.mockResolvedValueOnce(spotifyErrorBody(403, 'Forbidden'))
    expect(await caught(spotifyFetch('tok', '/me'))).toMatchObject({ status: 403, kind: 'forbidden' })

    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    expect(await caught(spotifyFetch('tok', '/me'))).toMatchObject({
      status: 502,
      kind: 'http',
      message: 'Spotify returned HTTP 502',
    })
  })

  it('turns a fetch rejection into a network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await caught(spotifyFetch('tok', '/me'))).toMatchObject({ status: 0, kind: 'network' })
  })

  it('waits out a short Retry-After and retries once', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(spotifyErrorBody(429, 'slow down', { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ id: 'me' }))

    const p = spotifyFetch('tok', '/me')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).resolves.toEqual({ id: 'me' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('defaults a missing Retry-After to 1s', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(spotifyErrorBody(429, 'slow down'))
      .mockResolvedValueOnce(json({}))

    const p = spotifyFetch('tok', '/me')
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(p).resolves.toEqual({})
  })

  it('throws rate_limited on a second 429 rather than retrying again', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(spotifyErrorBody(429, 'slow down', { 'Retry-After': '1' }))
      .mockResolvedValueOnce(spotifyErrorBody(429, 'still slow', { 'Retry-After': '3' }))

    const p = caught(spotifyFetch('tok', '/me'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await p).toMatchObject({ kind: 'rate_limited', retryAfterSec: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws rate_limited immediately for a long Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(spotifyErrorBody(429, 'slow down', { 'Retry-After': '50000' }))
    expect(await caught(spotifyFetch('tok', '/me'))).toMatchObject({
      status: 429,
      kind: 'rate_limited',
      retryAfterSec: 50000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('getMe', () => {
  it('maps id and a nullable display name', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'u1', display_name: null }))
    await expect(getMe('tok')).resolves.toEqual({ id: 'u1', displayName: null })
  })
})

describe('getMyPlaylists', () => {
  it('follows every page and marks which playlists the user owns', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/me')) return json({ id: 'me', display_name: 'Me' })
      if (url.includes('offset=50')) {
        return json({
          items: [
            // Followed playlist: under Dev Mode rules `items` is absent.
            { id: 'p2', name: 'Theirs', owner: { id: 'someone' }, images: [] },
          ],
          next: null,
        })
      }
      return json({
        items: [
          {
            id: 'p1',
            name: 'Mine',
            owner: { id: 'me' },
            images: [{ url: 'https://img/1' }],
            items: { total: 120 },
          },
          { id: 'p3', name: 'Old shape', owner: { id: 'me' }, images: null, tracks: { total: 7 } },
        ],
        next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
      })
    })

    const playlists = await getMyPlaylists('tok')
    expect(playlists).toEqual([
      { id: 'p1', name: 'Mine', ownerId: 'me', isOwn: true, trackCount: 120, imageUrl: 'https://img/1' },
      { id: 'p3', name: 'Old shape', ownerId: 'me', isOwn: true, trackCount: 7, imageUrl: null },
      { id: 'p2', name: 'Theirs', ownerId: 'someone', isOwn: false, trackCount: null, imageUrl: null },
    ])
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      'https://api.spotify.com/v1/me/playlists?limit=50'
    )
  })
})

describe('getPlaylist', () => {
  it('fetches one playlist and treats a present `items` as readable', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: 'p1',
        name: 'Shared',
        // Collaborative: someone else owns it, but Spotify includes `items`.
        owner: { id: 'someone' },
        images: [{ url: 'https://img/1' }],
        items: { total: 42 },
      })
    )
    await expect(getPlaylist('tok', 'p1')).resolves.toEqual({
      id: 'p1',
      name: 'Shared',
      readable: true,
      trackCount: 42,
      imageUrl: 'https://img/1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calledUrl(0)).toBe('https://api.spotify.com/v1/playlists/p1')
  })

  it('marks a playlist without `items` unreadable', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: 'p2', name: 'Theirs', owner: { id: 'someone' }, images: [] })
    )
    await expect(getPlaylist('tok', 'p2')).resolves.toMatchObject({
      readable: false,
      trackCount: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to an ownership check for old-shape responses', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/me')
        ? json({ id: 'me', display_name: 'Me' })
        : json({ id: 'p3', name: 'Old', owner: { id: 'me' }, images: null, tracks: { total: 7 } })
    )
    await expect(getPlaylist('tok', 'p3')).resolves.toMatchObject({ readable: true, trackCount: 7 })

    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/me')
        ? json({ id: 'me', display_name: 'Me' })
        : json({ id: 'p4', name: 'Old', owner: { id: 'x' }, images: null, tracks: { total: 7 } })
    )
    await expect(getPlaylist('tok', 'p4')).resolves.toMatchObject({ readable: false })
  })

  it('passes a 404 through as SpotifyError', async () => {
    fetchMock.mockResolvedValueOnce(spotifyErrorBody(404, 'Resource not found'))
    const err = await caught(getPlaylist('tok', 'nope'))
    expect(err).toBeInstanceOf(SpotifyError)
    expect(err.status).toBe(404)
  })
})

describe('getPlaylistTracks', () => {
  it('returns every track across pages, reading item or track', async () => {
    // 130 tracks → 3 pages at limit 50.
    const all = Array.from({ length: 130 }, (_, i) => rawTrack(i))
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const slice = all.slice(offset, offset + 50)
      const next =
        offset + 50 < all.length
          ? `https://api.spotify.com/v1/playlists/pl/items?offset=${offset + 50}&limit=50`
          : null
      // Mix both entry shapes to cover old and new responses.
      const items = slice.map((t, i) => (i % 2 ? { item: t } : { track: t }))
      return json({ items, next, total: all.length })
    })

    const tracks = await getPlaylistTracks('tok', 'pl')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(calledUrl(0)).toBe('https://api.spotify.com/v1/playlists/pl/items?limit=50')
    expect(tracks).toHaveLength(130)
    expect(tracks[0]).toEqual({
      id: 't0',
      uri: 'spotify:track:t0',
      name: 'Song 0',
      artists: ['Artist 0'],
      durationMs: 200_000,
    })
    expect(tracks[129].id).toBe('t129')
  })

  it('drops removed tracks, local files and episodes', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        items: [
          { item: rawTrack(1) },
          { item: null },
          { is_local: true, item: { ...rawTrack(2), id: null, uri: 'spotify:local:a:b:c:180' } },
          { item: { ...rawTrack(3), is_local: true } },
          { item: { ...rawTrack(4), type: 'episode', uri: 'spotify:episode:e4' } },
          { item: rawTrack(5) },
        ],
        next: null,
      })
    )
    const tracks = await getPlaylistTracks('tok', 'pl')
    expect(tracks.map((t) => t.id)).toEqual(['t1', 't5'])
  })

  it('reports a 403 as playlist_not_owned', async () => {
    fetchMock.mockResolvedValueOnce(spotifyErrorBody(403, 'Forbidden'))
    expect(await caught(getPlaylistTracks('tok', 'theirs'))).toMatchObject({
      status: 403,
      kind: 'playlist_not_owned',
      message: 'Forbidden',
    })
  })

  it('stops on a pagination loop', async () => {
    fetchMock.mockImplementation(async () =>
      json({ items: [], next: 'https://api.spotify.com/v1/playlists/pl/items?offset=0' })
    )
    await expect(getPlaylistTracks('tok', 'pl')).rejects.toThrow(/pagination exceeded/)
  })
})

describe('createPlaylist', () => {
  it('posts to /me/playlists and always sends public', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: 'new', external_urls: { spotify: 'https://open.spotify.com/playlist/new' } }, { status: 201 })
    )
    const created = await createPlaylist('tok', { name: 'Run' })
    expect(created).toEqual({ id: 'new', url: 'https://open.spotify.com/playlist/new' })
    expect(calledUrl(0)).toBe('https://api.spotify.com/v1/me/playlists')
    const init = fetchMock.mock.calls[0][1]!
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Run', public: false })
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('passes isPublic and description through', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'x', external_urls: { spotify: 'u' } }))
    await createPlaylist('tok', { name: 'Run', isPublic: true, description: 'tempo' })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      name: 'Run',
      public: true,
      description: 'tempo',
    })
  })
})

describe('addTracks', () => {
  it('posts uris to /playlists/{id}/items', async () => {
    fetchMock.mockResolvedValueOnce(json({ snapshot_id: 'snap' }, { status: 201 }))
    await expect(addTracks('tok', 'pl', ['spotify:track:a'])).resolves.toBe('snap')
    expect(calledUrl(0)).toBe('https://api.spotify.com/v1/playlists/pl/items')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      uris: ['spotify:track:a'],
    })
  })

  it('rejects more than 100 URIs without calling Spotify', async () => {
    const uris = Array.from({ length: 101 }, (_, i) => `spotify:track:${i}`)
    await expect(addTracks('tok', 'pl', uris)).rejects.toThrow(RangeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
