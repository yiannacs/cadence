import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as cache from './cache'
import type { BpmEntry } from './types'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-cache-'))
  file = path.join(dir, 'bpm-cache.json')
  process.env.BPM_CACHE_PATH = file
  await cache.__resetForTests()
})

afterEach(async () => {
  await cache.__resetForTests()
  delete process.env.BPM_CACHE_PATH
  await fs.rm(dir, { recursive: true, force: true })
})

const api = (bpm: number | null) => ({ bpm, tolerance: null, source: 'api' as const })
const manual = (bpm: number | null) => ({ bpm, tolerance: null, source: 'manual' as const })
const synthetic = (bpm: number) => ({ bpm, tolerance: 5, source: 'synthetic' as const })

async function seed(entry: Omit<BpmEntry, 'updatedAt'>) {
  await cache.set('t', entry)
}

describe('set() precedence', () => {
  it('accepts synthetic over an API miss', async () => {
    await seed(api(null))
    expect(await cache.set('t', synthetic(150))).toMatchObject(synthetic(150))
  })

  it('refuses a miss over synthetic or manual', async () => {
    await seed(synthetic(150))
    expect(await cache.set('t', api(null))).toMatchObject(synthetic(150))

    await cache.set('m', manual(160))
    expect(await cache.set('m', api(null))).toMatchObject(manual(160))
  })

  it('refuses synthetic over api', async () => {
    await seed(api(120))
    expect(await cache.set('t', synthetic(150))).toMatchObject(api(120))
  })

  it('refuses api over manual', async () => {
    await seed(manual(160))
    expect(await cache.set('t', api(80))).toMatchObject(manual(160))
    expect((await cache.get('t'))?.bpm).toBe(160)
  })

  it('lets api replace synthetic and manual replace api', async () => {
    await seed(synthetic(150))
    expect((await cache.set('t', api(120))).source).toBe('api')
    expect((await cache.set('t', manual(240))).source).toBe('manual')
  })
})

describe('persistence', () => {
  it('writes to BPM_CACHE_PATH and reloads from it', async () => {
    await cache.set('t', api(128))
    await cache.__resetForTests()
    expect((await cache.get('t'))?.bpm).toBe(128)
    expect(JSON.parse(await fs.readFile(file, 'utf8')).t.bpm).toBe(128)
  })

  it('coalesces concurrent writes and leaves no temp files behind', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => cache.set(`t${i}`, api(100 + i))))
    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(Object.keys(onDisk)).toHaveLength(50)
    expect(await fs.readdir(dir)).toEqual(['bpm-cache.json'])
  })

  it('fails loudly on a corrupt file, never overwrites it, and recovers once fixed', async () => {
    await fs.writeFile(file, '{ not json', 'utf8')

    await expect(cache.get('t')).rejects.toThrow(cache.BpmCacheError)
    await expect(cache.set('t', api(120))).rejects.toThrow(/Could not load BPM cache/)
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json')

    await fs.writeFile(file, JSON.stringify({ t: { ...manual(99), updatedAt: new Date().toISOString() } }), 'utf8')
    expect((await cache.get('t'))?.bpm).toBe(99)
  })

  it('rejects a file that is valid JSON but not an object', async () => {
    await fs.writeFile(file, '[]', 'utf8')
    await expect(cache.get('t')).rejects.toThrow(/not a JSON object/)
  })
})

describe('needsLookup', () => {
  it('trusts values and fresh misses, retries stale misses', () => {
    const now = new Date().toISOString()
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    expect(cache.needsLookup(undefined)).toBe(true)
    expect(cache.needsLookup({ ...api(120), updatedAt: old })).toBe(false)
    expect(cache.needsLookup({ ...api(null), updatedAt: now })).toBe(false)
    expect(cache.needsLookup({ ...api(null), updatedAt: old })).toBe(true)
  })
})
