import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GetSongBpmError, __resetForTests, lookupBpm } from './getsongbpm'
import { hit, htmlPage, invalidKey, noResult, respond } from '@/test/fixtures/getsongbpm'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  __resetForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GETSONGBPM_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function requestOf(call: number) {
  const [url, init] = fetchMock.mock.calls[call]
  return { url: new URL(String(url)), init: init! }
}

describe('lookupBpm', () => {
  it('sends an encoded search with the key in a header', async () => {
    fetchMock.mockResolvedValueOnce(hit('Rock & Roll', 'Led Zeppelin', '170'))
    await lookupBpm('Led Zeppelin', 'Rock & Roll - Remaster')

    const { url, init } = requestOf(0)
    expect(url.origin + url.pathname).toBe('https://api.getsong.co/search/')
    expect(url.searchParams.get('type')).toBe('both')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('lookup')).toBe('song:Rock & Roll artist:Led Zeppelin')
    expect(url.search).not.toContain('test-key')
    expect(new Headers(init.headers).get('X-API-KEY')).toBe('test-key')
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns a hit with the string tempo parsed', async () => {
    fetchMock.mockResolvedValueOnce(hit("Don't Stop Me Now", 'Queen', '80', 'q1'))
    expect(await lookupBpm('Queen', 'Don’t Stop Me Now')).toEqual({
      kind: 'hit',
      bpm: 80,
      match: { id: 'q1', title: "Don't Stop Me Now", artist: 'Queen' },
    })
  })

  it('returns a miss for {search:{error:"no result"}}', async () => {
    fetchMock.mockResolvedValueOnce(noResult())
    expect(await lookupBpm('Nobody', 'Nothing')).toEqual({ kind: 'miss' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tries the parenthetical-keeping title second, and stops at two requests', async () => {
    fetchMock.mockResolvedValueOnce(noResult()).mockResolvedValueOnce(hit('Song (feat. X)', 'A', '120'))
    expect(await lookupBpm('A', 'Song (feat. X) - Remastered')).toMatchObject({ kind: 'hit', bpm: 120 })
    expect(requestOf(1).url.searchParams.get('lookup')).toBe('song:Song (feat. X) artist:A')

    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => noResult())
    expect(await lookupBpm('A', 'Song (feat. X) - Remastered')).toEqual({ kind: 'miss' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a non-matching result as a miss', async () => {
    fetchMock.mockImplementation(async () => hit('Enter Sandman', 'Metallica', '123'))
    expect(await lookupBpm('Metallica', 'Sandman')).toEqual({ kind: 'miss' })
  })
})

describe('errors', () => {
  it('throws a typed auth error on 401, served as text/html', async () => {
    fetchMock.mockResolvedValueOnce(invalidKey())
    const err = await lookupBpm('A', 'B').catch((e) => e)
    expect(err).toBeInstanceOf(GetSongBpmError)
    expect(err).toMatchObject({ kind: 'auth', status: 401 })
    expect(err.message).toMatch(/invalid or inactive/)
    expect(err.message).not.toContain('test-key')
  })

  it.each([
    [404, 'http'],
    [429, 'rate-limit'],
    [503, 'http'],
  ])('throws on %i', async (status, kind) => {
    fetchMock.mockResolvedValueOnce(respond(status, 'nope', 'text/html'))
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind, status })
  })

  it('throws on an HTML page', async () => {
    fetchMock.mockResolvedValueOnce(htmlPage())
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('throws on an unrecognised JSON payload', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { error: 'something' }))
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('throws on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws on a timeout', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('throws without a request when no key is configured', async () => {
    vi.stubEnv('GETSONGBPM_API_KEY', '')
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'config' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('circuit breaker', () => {
  it('stops all further calls after a fatal response', async () => {
    fetchMock.mockImplementation(async () => invalidKey())
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'auth' })
    await expect(lookupBpm('C', 'D')).rejects.toMatchObject({ kind: 'circuit-open', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects queued lookups when it trips', async () => {
    fetchMock.mockImplementation(async () => respond(429, 'slow down', 'text/html'))
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => lookupBpm('A', `Song ${i}`)))

    // Three were already in flight; the queued three never reach the network.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    const kinds = results.map((r) => (r as PromiseRejectedResult).reason.kind)
    expect(kinds.filter((k) => k === 'circuit-open')).toHaveLength(3)
  })

  it('does not trip on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(noResult())
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'network' })
    expect(await lookupBpm('A', 'B')).toEqual({ kind: 'miss' })
  })

  it('closes when the key changes', async () => {
    fetchMock.mockResolvedValueOnce(invalidKey()).mockResolvedValueOnce(noResult())
    await expect(lookupBpm('A', 'B')).rejects.toMatchObject({ kind: 'auth' })
    vi.stubEnv('GETSONGBPM_API_KEY', 'fixed-key')
    expect(await lookupBpm('A', 'B')).toEqual({ kind: 'miss' })
  })
})

describe('rate limiting', () => {
  it('runs at most three requests at once', async () => {
    let active = 0
    let peak = 0
    fetchMock.mockImplementation(async () => {
      peak = Math.max(peak, ++active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return noResult()
    })
    await Promise.all(Array.from({ length: 10 }, (_, i) => lookupBpm('A', `Song ${i}`)))
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(peak).toBe(3)
  })
})
