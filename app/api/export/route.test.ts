import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  hasSession: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('@/lib/spotify/session', () => session)

import { POST } from './route'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  session.getAccessToken.mockResolvedValue('tok')
  session.hasSession.mockResolvedValue(true)
  return () => vi.unstubAllGlobals()
})

function uris(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `spotify:track:t${i}`)
}

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://127.0.0.1:3000/api/export', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

// A fresh Response per use: a body can only be read once.
const created = () => Response.json({ id: 'new', external_urls: { spotify: 'https://open.spotify.com/playlist/new' } })

function sentBody(call: number): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[call][1]?.body))
}

describe('POST /api/export', () => {
  it('401s without an access token and calls nothing', async () => {
    session.getAccessToken.mockResolvedValue(null)
    session.hasSession.mockResolvedValue(false)
    const res = await post({ name: 'Run', public: false, uris: uris(1) })
    expect(res.status).toBe(401)
    expect((await res.json()).error.kind).toBe('unauthorized')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so when the session exists but the refresh failed', async () => {
    session.getAccessToken.mockResolvedValue(null)
    const res = await post({ name: 'Run', public: false, uris: uris(1) })
    expect(res.status).toBe(401)
    expect((await res.json()).error.kind).toBe('refresh_failed')
  })

  it.each([
    ['not json'],
    [{ name: 'Run', public: false }],
    [{ name: 'Run', public: false, uris: ['spotify:episode:x'] }],
    [{ name: '', public: false, uris: uris(1) }],
    [{ name: 'Run', public: false, uris: uris(1), extra: 1 }],
  ])('rejects a malformed body: %j', async (body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect((await res.json()).error.kind).toBe('bad_request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a private playlist and adds >100 tracks in order, 100 at a time', async () => {
    fetchMock.mockResolvedValueOnce(created())
    fetchMock.mockImplementation(async () => Response.json({ snapshot_id: 's' }, { status: 201 }))
    const all = uris(250)

    const res = await post({ name: 'Run', public: false, uris: all, description: 'peak 172 — made with cadence' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      playlist: { id: 'new', url: 'https://open.spotify.com/playlist/new' },
      added: 250,
      total: 250,
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.spotify.com/v1/me/playlists')
    expect(sentBody(0)).toEqual({ name: 'Run', public: false, description: 'peak 172 — made with cadence' })
    for (const i of [1, 2, 3]) {
      expect(String(fetchMock.mock.calls[i][0])).toBe('https://api.spotify.com/v1/playlists/new/items')
      expect(fetchMock.mock.calls[i][1]?.method).toBe('POST')
    }
    const sent = [1, 2, 3].map((i) => sentBody(i).uris as string[])
    expect(sent.map((u) => u.length)).toEqual([100, 100, 50])
    expect(sent.flat()).toEqual(all)
  })

  it('maps a failed create to its Spotify error and adds nothing', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { status: 403, message: 'Forbidden' } }, { status: 403 }))
    const res = await post({ name: 'Run', public: false, uris: uris(3) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.kind).toBe('forbidden')
    expect(body.playlist).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a partial export with the playlist link when a chunk fails', async () => {
    fetchMock
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(Response.json({ snapshot_id: 's' }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ error: { status: 500, message: 'Server error' } }, { status: 500 }))

    const res = await post({ name: 'Run', public: false, uris: uris(250) })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.playlist).toEqual({ id: 'new', url: 'https://open.spotify.com/playlist/new' })
    expect(body.added).toBe(100)
    expect(body.total).toBe(250)
    expect(body.error.kind).toBe('http')
    expect(body.error.message).toContain('Server error')
    // Stops at the failed chunk: the third is never sent, so nothing lands out of order.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
