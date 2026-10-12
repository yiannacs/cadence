import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ hasSession: vi.fn<() => Promise<boolean>>() }))
const batch = vi.hoisted(() => ({ resolveBatch: vi.fn() }))
vi.mock('@/lib/spotify/session', () => session)
vi.mock('@/lib/bpm/batch', () => batch)

import { POST } from './route'

function post(body: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/bpm/resolve', { method: 'POST', body })
}

beforeEach(() => {
  session.hasSession.mockResolvedValue(true)
  batch.resolveBatch.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('POST /api/bpm/resolve', () => {
  it('requires the Spotify session cookie', async () => {
    session.hasSession.mockResolvedValue(false)
    const res = await POST(post('[]'))
    expect(res.status).toBe(401)
    expect(batch.resolveBatch).not.toHaveBeenCalled()
  })

  it.each([['not json'], ['{"id":"a"}'], ['[{"id":"a"}]']])('rejects a malformed body: %s', async (body) => {
    const res = await POST(post(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error.kind).toBe('bad_request')
    expect(batch.resolveBatch).not.toHaveBeenCalled()
  })

  it('resolves the deduped items and returns the batch result', async () => {
    const result = { results: [{ id: 'a', status: 'resolved', bpm: 120, bpmSource: 'api' }], stop: null }
    batch.resolveBatch.mockResolvedValue(result)
    const res = await POST(
      post(JSON.stringify([
        { id: 'a', artist: 'A', title: 'T' },
        { id: 'a', artist: 'A', title: 'T' },
      ]))
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
    expect(batch.resolveBatch).toHaveBeenCalledWith([{ id: 'a', artist: 'A', title: 'T' }])
  })
})
