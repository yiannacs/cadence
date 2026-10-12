import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { respond, hit, invalidKey, noResult } from '@/test/fixtures/getsongbpm'
import type { Track } from '../types'
import { messageForBpmError, resolveBatch, withCachedBpm } from './batch'
import * as cache from './cache'
import { BpmCacheError } from './cache'
import * as client from './getsongbpm'
import { GetSongBpmError } from './getsongbpm'
import { __resetForTests } from './index'

const fetchMock = vi.fn<typeof fetch>()
let dir: string
let cacheFile: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-batch-'))
  cacheFile = path.join(dir, 'bpm-cache.json')
  vi.stubEnv('BPM_CACHE_PATH', cacheFile)
  vi.stubEnv('GETSONGBPM_API_KEY', 'test-key')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  __resetForTests()
  client.__resetForTests()
  await cache.__resetForTests()
})

afterEach(async () => {
  await cache.__resetForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

function track(id: string): Track {
  return { id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: ['A'], durationMs: 1000 }
}

async function cachedIds(): Promise<string[]> {
  await cache.__resetForTests() // waits for pending flushes
  return Object.keys(JSON.parse(await fs.readFile(cacheFile, 'utf8'))).sort()
}

describe('withCachedBpm', () => {
  it('attaches cached values and misses, and leaves the rest unresolved', async () => {
    await cache.set('hit', { bpm: 128, tolerance: null, source: 'api' })
    await cache.set('miss', { bpm: null, tolerance: null, source: 'api' })
    await cache.set('old-miss', {
      bpm: null,
      tolerance: null,
      source: 'api',
      updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const out = await withCachedBpm(['hit', 'miss', 'old-miss', 'new'].map(track))
    expect(out.map(({ id, bpm, bpmSource }) => ({ id, bpm, bpmSource }))).toEqual([
      { id: 'hit', bpm: 128, bpmSource: 'api' },
      { id: 'miss', bpm: null, bpmSource: 'api' },
      // An expired miss is due for another lookup.
      { id: 'old-miss', bpm: null, bpmSource: null },
      { id: 'new', bpm: null, bpmSource: null },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('resolveBatch', () => {
  it('returns hits and misses as resolved, and caches both', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes('Hit') ? hit('Hit', 'A', '150') : noResult()
    )
    const res = await resolveBatch([
      { id: 'h', artist: 'A', title: 'Hit' },
      { id: 'm', artist: 'A', title: 'Nothing' },
    ])
    expect(res).toEqual({
      results: [
        { id: 'h', status: 'resolved', bpm: 150, bpmSource: 'api' },
        { id: 'm', status: 'resolved', bpm: null, bpmSource: 'api' },
      ],
      stop: null,
    })
    expect(await cachedIds()).toEqual(['h', 'm'])
  })

  it('reports per-track errors as unresolved without stopping', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('Flaky')) throw new TypeError('fetch failed')
      return hit('Fine', 'A', '100')
    })
    const res = await resolveBatch([
      { id: 'f', artist: 'A', title: 'Flaky' },
      { id: 'ok', artist: 'A', title: 'Fine' },
    ])
    expect(res.stop).toBeNull()
    expect(res.results[0]).toEqual({ id: 'f', status: 'unresolved', reason: 'Could not reach GetSongBPM.' })
    expect(res.results[1]).toMatchObject({ status: 'resolved', bpm: 100 })
    // The errored track stays uncached, so it's retried next time.
    expect(await cachedIds()).toEqual(['ok'])
  })

  it('stops on an invalid key and caches nothing', async () => {
    fetchMock.mockImplementation(async () => invalidKey())
    const res = await resolveBatch(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, artist: 'A', title: id })))
    expect(res.stop).toEqual({ kind: 'auth', message: expect.stringMatching(/^GetSongBPM key invalid/) })
    expect(res.results.every((r) => r.status === 'unresolved')).toBe(true)
    await cache.__resetForTests()
    await expect(fs.access(cacheFile)).rejects.toThrow()
  })

  it("reports an open breaker by the error that tripped it", async () => {
    fetchMock.mockResolvedValueOnce(respond(429, 'Too Many Requests', 'text/html'))
    await resolveBatch([{ id: 'a', artist: 'A', title: 'a' }])
    fetchMock.mockReset()

    const res = await resolveBatch([{ id: 'b', artist: 'A', title: 'b' }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.stop).toEqual({ kind: 'rate-limit', message: 'GetSongBPM rate limit hit. Try again in an hour.' })
  })

  it('stops when the cache is unreadable', async () => {
    await fs.writeFile(cacheFile, '{ not json', 'utf8')
    const res = await resolveBatch([{ id: 'a', artist: 'A', title: 'a' }])
    expect(res.stop?.kind).toBe('cache')
    expect(res.results[0].status).toBe('unresolved')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('messageForBpmError', () => {
  it('never leaks the API key', () => {
    for (const kind of ['config', 'auth', 'rate-limit', 'http', 'invalid-response', 'network', 'timeout', 'budget'] as const) {
      expect(messageForBpmError(new GetSongBpmError(kind, 'x', 500))).not.toContain('test-key')
    }
    expect(messageForBpmError(new BpmCacheError('bad file'))).toContain('bad file')
  })
})
