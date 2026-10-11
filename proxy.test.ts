import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function requestWith(cookie: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/', { headers: { cookie } })
}

function tokenResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Cookies forwarded to downstream handlers. Next carries the rewritten
// request headers on the proxy response as x-middleware-request-* headers.
function forwardedCookie(res: Response): string | null {
  return res.headers.get('x-middleware-request-cookie')
}

describe('proxy', () => {
  it('passes through without a refresh token', async () => {
    const res = await proxy(requestWith(''))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('passes through while the access token has more than a minute left', async () => {
    const exp = Date.now() + 5 * 60_000
    await proxy(requestWith(`sp_rt=rt; sp_at=at; sp_exp=${exp}`))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes an expired token for both this request and the browser', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: 'fresh', expires_in: 3600 }))

    const res = await proxy(requestWith('sp_rt=rt; sp_at=stale; sp_exp=0'))

    // Downstream Route Handlers and Server Components see the new token...
    expect(forwardedCookie(res)).toContain('sp_at=fresh')
    expect(forwardedCookie(res)).toMatch(/sp_exp=\d{13}/)
    // ...and the browser stores it.
    expect(res.cookies.get('sp_at')?.value).toBe('fresh')
    expect(Number(res.cookies.get('sp_exp')?.value)).toBeGreaterThan(Date.now())
    // Unrotated refresh token is left alone.
    expect(res.cookies.get('sp_rt')).toBeUndefined()

    const body = fetchMock.mock.calls[0][1]!.body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
  })

  it('refreshes when the access token cookie is gone', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: 'fresh', expires_in: 3600 }))
    const res = await proxy(requestWith(`sp_rt=rt; sp_exp=${Date.now() + 3_600_000}`))
    expect(res.cookies.get('sp_at')?.value).toBe('fresh')
  })

  it('stores a rotated refresh token', async () => {
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: 'fresh', refresh_token: 'rt2', expires_in: 3600 })
    )
    const res = await proxy(requestWith('sp_rt=rt; sp_exp=0'))
    expect(res.cookies.get('sp_rt')?.value).toBe('rt2')
    expect(forwardedCookie(res)).toContain('sp_rt=rt2')
  })

  it('logs out cleanly on invalid_grant', async () => {
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400)
    )
    const res = await proxy(requestWith('sp_rt=rt; sp_at=stale; sp_exp=0'))

    for (const name of ['sp_at', 'sp_rt', 'sp_exp']) {
      expect(res.cookies.get(name)?.value).toBe('')
    }
    expect(forwardedCookie(res) ?? '').not.toMatch(/sp_(at|rt|exp)=/)
  })

  it('keeps the session on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const res = await proxy(requestWith('sp_rt=rt; sp_exp=0'))
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('keeps the session on a Spotify 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream error', { status: 503 }))
    const res = await proxy(requestWith('sp_rt=rt; sp_exp=0'))
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
