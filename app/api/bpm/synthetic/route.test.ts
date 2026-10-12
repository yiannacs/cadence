import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as cache from '@/lib/bpm/cache'

const session = vi.hoisted(() => ({ hasSession: vi.fn<() => Promise<boolean>>() }))
vi.mock('@/lib/spotify/session', () => session)

import { POST } from './route'

let dir: string
let file: string

function post(body: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/bpm/synthetic', { method: 'POST', body })
}

async function onDisk(): Promise<Record<string, unknown>> {
  await cache.__resetForTests() // waits for pending flushes
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

beforeEach(async () => {
  // A temp cache file: tests never write under data/.
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-synthetic-'))
  file = path.join(dir, 'bpm-cache.json')
  process.env.BPM_CACHE_PATH = file
  await cache.__resetForTests()
  session.hasSession.mockResolvedValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await cache.__resetForTests()
  delete process.env.BPM_CACHE_PATH
  await fs.rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('POST /api/bpm/synthetic', () => {
  it('requires the Spotify session cookie', async () => {
    session.hasSession.mockResolvedValue(false)
    const res = await POST(post(JSON.stringify({ trackId: 'abc', bpm: 172, tolerance: 4 })))
    expect(res.status).toBe(401)
    expect(await cache.get('abc')).toBeUndefined()
  })

  it.each([
    ['not json'],
    ['[]'],
    ['{"trackId":"abc","bpm":172}'],
    ['{"trackId":"abc","bpm":172,"tolerance":4,"source":"manual"}'],
    ['{"trackId":"","bpm":172,"tolerance":4}'],
    ['{"trackId":"../x","bpm":172,"tolerance":4}'],
    ['{"trackId":"abc","bpm":0,"tolerance":4}'],
    ['{"trackId":"abc","bpm":"172","tolerance":4}'],
    ['{"trackId":"abc","bpm":172,"tolerance":-1}'],
  ])('rejects a malformed body: %s', async (body) => {
    const res = await POST(post(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error.kind).toBe('bad_request')
  })

  it('caches a synthetic entry for a track the API missed', async () => {
    await cache.set('miss', { bpm: null, tolerance: null, source: 'api' })
    const res = await POST(post(JSON.stringify({ trackId: 'miss', bpm: 172, tolerance: 4.5 })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bpm: 172, tolerance: 4.5, bpmSource: 'synthetic' })
    expect((await onDisk()).miss).toMatchObject({ bpm: 172, tolerance: 4.5, source: 'synthetic' })
  })

  it('updates an earlier guess', async () => {
    await cache.set('t', { bpm: 150, tolerance: 3, source: 'synthetic' })
    const res = await POST(post(JSON.stringify({ trackId: 't', bpm: 165, tolerance: 6 })))
    expect(await res.json()).toEqual({ bpm: 165, tolerance: 6, bpmSource: 'synthetic' })
  })

  it('keeps a real value and returns it', async () => {
    await cache.set('real', { bpm: 128, tolerance: null, source: 'api' })
    const res = await POST(post(JSON.stringify({ trackId: 'real', bpm: 172, tolerance: 4 })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bpm: 128, tolerance: null, bpmSource: 'api' })
    expect((await onDisk()).real).toMatchObject({ bpm: 128, source: 'api' })
  })

  it('reports a broken cache file as a cache error', async () => {
    await fs.writeFile(file, '{ not json', 'utf8')
    await cache.__resetForTests()
    const res = await POST(post(JSON.stringify({ trackId: 'abc', bpm: 172, tolerance: 4 })))
    expect(res.status).toBe(500)
    expect((await res.json()).error.kind).toBe('cache')
  })
})
