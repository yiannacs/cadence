import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as cache from '@/lib/bpm/cache'

const session = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  hasSession: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('@/lib/spotify/session', () => session)

import { GET } from './route'

const fetchMock = vi.fn<typeof fetch>()
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-tracks-'))
  vi.stubEnv('BPM_CACHE_PATH', path.join(dir, 'bpm-cache.json'))
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  session.getAccessToken.mockResolvedValue('tok')
  session.hasSession.mockResolvedValue(true)
  await cache.__resetForTests()
})

afterEach(async () => {
  await cache.__resetForTests()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await fs.rm(dir, { recursive: true, force: true })
})

function rawTrack(id: string) {
  return {
    item: { id, uri: `spotify:track:${id}`, name: `Song ${id}`, duration_ms: 180_000, artists: [{ name: 'A' }] },
  }
}

function call(id = 'pl') {
  return GET(new NextRequest(`http://127.0.0.1:3000/api/playlists/${id}/tracks`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/playlists/[id]/tracks', () => {
  it('returns deduped tracks with cached BPMs and calls no BPM API', async () => {
    await cache.set('a', { bpm: 140, tolerance: null, source: 'api' })
    fetchMock.mockResolvedValueOnce(
      Response.json({ items: [rawTrack('a'), rawTrack('b'), rawTrack('a')], next: null })
    )

    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'a', uri: 'spotify:track:a', name: 'Song a', artists: ['A'], durationMs: 180_000, bpm: 140, bpmSource: 'api' },
      { id: 'b', uri: 'spotify:track:b', name: 'Song b', artists: ['A'], durationMs: 180_000, bpm: null, bpmSource: null },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.spotify.com')
  })

  it('maps a 403 to playlist_not_owned', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { status: 403, message: 'Forbidden' } }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toEqual({
      kind: 'playlist_not_owned',
      message: 'Spotify only lets this app read playlists you own.',
    })
  })

  it('401s without an access token', async () => {
    session.getAccessToken.mockResolvedValue(null)
    session.hasSession.mockResolvedValue(false)
    const res = await call()
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
