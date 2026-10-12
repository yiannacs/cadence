import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_CHUNK_SIZE,
  MAX_DESCRIPTION_LENGTH,
  MAX_EXPORT_URIS,
  MAX_NAME_LENGTH,
  buildExportRequest,
  chunk,
  defaultPlaylistName,
  exportDescription,
  exportTotals,
  exportUris,
  parseExportRequest,
  postExport,
  readExportResponse,
  runExport,
  type ExportCalls,
} from './export'
import { moveTrack } from './editor'
import { runBuild, type BuildResult, type StageDraft } from './stages'
import type { TrackWithBpm } from './types'

function track(id: string, bpm: number | null, durationMs = 200_000): TrackWithBpm {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Song ${id}`,
    artists: ['Artist'],
    durationMs,
    bpm,
    bpmSource: 'api', // a null BPM is a miss
  }
}

function draft(id: string, anchorTrackId: string, durationMs = 400_000): StageDraft {
  return { id, name: id, durationMs, anchorTrackId }
}

const tracks: TrackWithBpm[] = [
  track('a150', 150),
  track('a160', 160),
  track('a172', 172),
  track('a145', 145),
  track('t158', 158),
  track('t165', 165),
  track('t170', 170),
  track('t175', 175),
  track('t200', 200),
  track('miss', null),
]

const drafts = [draft('warmup', 'a150'), draft('build', 'a160'), draft('peak', 'a172'), draft('cooldown', 'a145')]

function build(): BuildResult {
  return runBuild(drafts, tracks, 1)
}

function uris(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `spotify:track:t${i}`)
}

describe('exportUris / exportTotals', () => {
  it('lists stage 1 in play order, then stage 2, … and leaves Unplaced out', () => {
    const result = build()
    const expected = result.stages.flatMap((s) => s.tracks.map((t) => `spotify:track:${t.id}`))
    expect(exportUris(result)).toEqual(expected)
    expect(result.unplaced.length).toBeGreaterThan(0)
    for (const t of result.unplaced) expect(exportUris(result)).not.toContain(t.uri)
  })

  it('follows the edited result', () => {
    const result = build()
    const moved = moveTrack(result, 'miss', 'peak').result
    expect(exportUris(moved)).toContain('spotify:track:miss')
    expect(exportUris(moved)).toEqual(moved.stages.flatMap((s) => s.tracks.map((t) => t.uri)))
  })

  it('counts the exported tracks and their length', () => {
    const result = build()
    const n = result.stages.reduce((sum, s) => sum + s.tracks.length, 0)
    expect(exportTotals(result)).toEqual({ tracks: n, durationMs: n * 200_000 })
  })
})

describe('defaultPlaylistName / exportDescription', () => {
  it('names the playlist after the source and the local date', () => {
    expect(defaultPlaylistName('Running mix', new Date(2026, 9, 2))).toBe('cadence · Running mix · 2026-10-02')
  })

  it('cuts a long source name to fit', () => {
    const name = defaultPlaylistName('x'.repeat(300), new Date(2026, 9, 2))
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    expect(name.endsWith('… · 2026-10-02')).toBe(true)
  })

  it('summarizes each stage tempo', () => {
    expect(exportDescription(build())).toBe('warmup 150 · build 160 · peak 172 · cooldown 145 — made with cadence')
  })

  it('stays within Spotify’s description limit', () => {
    const result = build()
    const labels = Object.fromEntries(result.stages.map((s) => [s.id, 'y'.repeat(120)]))
    const description = exportDescription({ ...result, labels })
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH)
    expect(description.endsWith('— made with cadence')).toBe(true)
  })
})

describe('buildExportRequest', () => {
  it('builds a valid body from the result', () => {
    const result = build()
    const req = buildExportRequest(result, '  My run  ', false)
    expect(req).toEqual({
      name: 'My run',
      public: false,
      uris: exportUris(result),
      description: exportDescription(result),
    })
    expect(parseExportRequest(JSON.parse(JSON.stringify(req)))).toEqual(req)
  })

  it('is null when no stage holds a track', () => {
    const result = build()
    expect(buildExportRequest({ ...result, stages: result.stages.map((s) => ({ ...s, tracks: [] })) }, 'x', false)).toBeNull()
  })
})

describe('parseExportRequest', () => {
  const ok = { name: 'Run', public: false, uris: ['spotify:track:4uLU6hMCjMI75M1A2tKUQC'] }

  it('accepts a minimal body and an optional description', () => {
    expect(parseExportRequest(ok)).toEqual(ok)
    expect(parseExportRequest({ ...ok, description: 'd' })).toEqual({ ...ok, description: 'd' })
    expect(parseExportRequest({ ...ok, name: '  Run ' })).toEqual(ok)
  })

  it('accepts the maximum number of URIs', () => {
    expect(parseExportRequest({ ...ok, uris: uris(MAX_EXPORT_URIS) })?.uris).toHaveLength(MAX_EXPORT_URIS)
  })

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['null', null],
    ['a missing key', { name: 'Run', uris: ok.uris }],
    ['an extra key', { ...ok, collaborative: true }],
    ['an empty name', { ...ok, name: '   ' }],
    ['a long name', { ...ok, name: 'x'.repeat(MAX_NAME_LENGTH + 1) }],
    ['a string public flag', { ...ok, public: 'false' }],
    ['no URIs', { ...ok, uris: [] }],
    ['too many URIs', { ...ok, uris: uris(MAX_EXPORT_URIS + 1) }],
    ['an episode URI', { ...ok, uris: ['spotify:episode:abc'] }],
    ['a local file URI', { ...ok, uris: ['spotify:local:a:b:c:180'] }],
    ['a URL', { ...ok, uris: ['https://open.spotify.com/track/abc'] }],
    ['an ID with junk', { ...ok, uris: ['spotify:track:abc/../x'] }],
    ['a non-string URI', { ...ok, uris: [42] }],
    ['a long description', { ...ok, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }],
    ['a non-string description', { ...ok, description: 1 }],
  ])('rejects %s', (_, body) => {
    expect(parseExportRequest(body)).toBeNull()
  })
})

describe('chunk', () => {
  it('splits into consecutive chunks without reordering', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 100)).toEqual([])
    expect(chunk(uris(250), 100).flat()).toEqual(uris(250))
  })

  it('refuses a size below 1', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError)
  })
})

describe('runExport', () => {
  function calls(failOnCall?: number): ExportCalls & { added: string[][] } {
    const added: string[][] = []
    return {
      added,
      createPlaylist: vi.fn(async () => ({ id: 'new', url: 'https://open.spotify.com/playlist/new' })),
      addTracks: vi.fn(async (_id: string, part: string[]) => {
        if (added.length + 1 === failOnCall) throw new Error('boom')
        added.push(part)
        return 'snap'
      }),
    }
  }

  it('creates once, then adds in order in chunks of 100', async () => {
    const c = calls()
    const all = uris(250)
    const out = await runExport({ name: 'Run', public: false, uris: all, description: 'd' }, c)
    expect(c.createPlaylist).toHaveBeenCalledTimes(1)
    expect(c.createPlaylist).toHaveBeenCalledWith({ name: 'Run', isPublic: false, description: 'd' })
    expect(c.added.map((p) => p.length)).toEqual([100, 100, 50])
    expect(c.added.flat()).toEqual(all)
    expect(c.addTracks).toHaveBeenCalledWith('new', all.slice(0, EXPORT_CHUNK_SIZE))
    expect(out).toEqual({ playlist: { id: 'new', url: 'https://open.spotify.com/playlist/new' }, added: 250, total: 250 })
  })

  it('sends one chunk at a time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await runExport(
      { name: 'Run', public: true, uris: uris(300) },
      {
        createPlaylist: async () => ({ id: 'p', url: 'u' }),
        addTracks: async () => {
          maxInFlight = Math.max(maxInFlight, ++inFlight)
          await new Promise((r) => setTimeout(r, 1))
          inFlight--
        },
      }
    )
    expect(maxInFlight).toBe(1)
  })

  it('omits the description when there is none', async () => {
    const c = calls()
    await runExport({ name: 'Run', public: true, uris: uris(1) }, c)
    expect(c.createPlaylist).toHaveBeenCalledWith({ name: 'Run', isPublic: true })
  })

  it('stops at the first failed chunk and reports how far it got', async () => {
    const c = calls(2)
    const out = await runExport({ name: 'Run', public: false, uris: uris(250) }, c)
    expect(c.addTracks).toHaveBeenCalledTimes(2)
    expect(out.added).toBe(100)
    expect(out.total).toBe(250)
    expect(out.playlist.id).toBe('new')
    expect((out.error as Error).message).toBe('boom')
  })

  it('throws when the create fails, adding nothing', async () => {
    const c = calls()
    c.createPlaylist = vi.fn(async () => {
      throw new Error('nope')
    })
    await expect(runExport({ name: 'Run', public: false, uris: uris(3) }, c)).rejects.toThrow('nope')
    expect(c.addTracks).not.toHaveBeenCalled()
  })
})

describe('readExportResponse / postExport', () => {
  const playlist = { id: 'p', url: 'https://open.spotify.com/playlist/p' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a full export', async () => {
    const res = Response.json({ playlist, added: 3, total: 3 })
    expect(await readExportResponse(res)).toEqual({ status: 'done', playlist, added: 3, total: 3 })
  })

  it('reads a partial export, with the link', async () => {
    const res = Response.json(
      { error: { kind: 'http', message: 'Spotify failed.' }, playlist, added: 100, total: 250 },
      { status: 502 }
    )
    expect(await readExportResponse(res)).toEqual({
      status: 'partial',
      playlist,
      added: 100,
      total: 250,
      message: 'Spotify failed.',
    })
  })

  it('reads a failure with nothing created', async () => {
    const res = Response.json({ error: { kind: 'forbidden', message: 'No.' } }, { status: 403 })
    expect(await readExportResponse(res)).toEqual({ status: 'failed', message: 'No.' })
    expect(await readExportResponse(new Response('oops', { status: 500 }))).toEqual({
      status: 'failed',
      message: 'Export failed (HTTP 500).',
    })
  })

  it('posts the request as JSON to the route', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ playlist, added: 1, total: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const req = { name: 'Run', public: false, uris: uris(1) }
    expect((await postExport(req)).status).toBe('done')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/export')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(req)
  })

  it('warns that the playlist may exist when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const out = await postExport({ name: 'Run', public: false, uris: uris(1) })
    expect(out.status).toBe('failed')
    expect(out.status === 'failed' && out.message).toMatch(/may have been created/)
  })
})
