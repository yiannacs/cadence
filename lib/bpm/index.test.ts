import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as cache from './cache'
import * as client from './getsongbpm'
import { GetSongBpmError, __resetForTests, getBpm } from './index'
import { hit, invalidKey, noResult } from '@/test/fixtures/getsongbpm'

const fetchMock = vi.fn<typeof fetch>()
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-resolver-'))
  vi.stubEnv('BPM_CACHE_PATH', path.join(dir, 'bpm-cache.json'))
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
  await fs.rm(dir, { recursive: true, force: true })
})

describe('getBpm', () => {
  it('caches a hit as an api entry and serves repeats from the cache', async () => {
    fetchMock.mockImplementation(async () => hit("Don't Stop Me Now", 'Queen', '80'))
    expect(await getBpm('t1', 'Queen', "Don't Stop Me Now")).toMatchObject({ bpm: 80, tolerance: null, source: 'api' })
    expect(await getBpm('t1', 'Queen', "Don't Stop Me Now")).toMatchObject({ bpm: 80 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('hits the network once for concurrent calls on the same track', async () => {
    fetchMock.mockImplementation(async () => hit('Song', 'A', '120'))
    const [a, b] = await Promise.all([getBpm('t1', 'A', 'Song'), getBpm('t1', 'A', 'Song')])
    expect(a).toEqual(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches a miss as bpm null and retries it only after the TTL', async () => {
    fetchMock.mockImplementation(async () => noResult())
    expect(await getBpm('t1', 'A', 'Song')).toMatchObject({ bpm: null, source: 'api' })
    await getBpm('t1', 'A', 'Song')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000)
    fetchMock.mockImplementation(async () => hit('Song', 'A', '120'))
    expect(await getBpm('t1', 'A', 'Song')).toMatchObject({ bpm: 120, source: 'api' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not re-query synthetic or manual entries', async () => {
    await cache.set('s', { bpm: 150, tolerance: 5, source: 'synthetic' })
    await cache.set('m', { bpm: 160, tolerance: null, source: 'manual' })
    expect(await getBpm('s', 'A', 'Song')).toMatchObject({ bpm: 150, source: 'synthetic' })
    expect(await getBpm('m', 'A', 'Song')).toMatchObject({ bpm: 160, source: 'manual' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the stored entry when a manual value lands mid-lookup', async () => {
    fetchMock.mockImplementation(async () => {
      await cache.set('t1', { bpm: 160, tolerance: null, source: 'manual' })
      return hit('Song', 'A', '80')
    })
    expect(await getBpm('t1', 'A', 'Song')).toMatchObject({ bpm: 160, source: 'manual' })
  })

  it('caches nothing and rethrows on an API error', async () => {
    fetchMock.mockImplementation(async () => invalidKey())
    await expect(getBpm('t1', 'A', 'Song')).rejects.toBeInstanceOf(GetSongBpmError)
    expect(await cache.get('t1')).toBeUndefined()

    // The breaker keeps later tracks off the network too.
    await expect(getBpm('t2', 'A', 'Other')).rejects.toMatchObject({ kind: 'circuit-open' })
    expect(await cache.get('t2')).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows a retry after a failed lookup', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(hit('Song', 'A', '120'))
    await expect(getBpm('t1', 'A', 'Song')).rejects.toMatchObject({ kind: 'network' })
    expect(await getBpm('t1', 'A', 'Song')).toMatchObject({ bpm: 120 })
  })
})
