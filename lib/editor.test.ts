import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  carryKey,
  checkMove,
  locateTrack,
  moveTrack,
  orderUnplaced,
  parseSyntheticWrite,
  postSynthetic,
  setResultTrackBpm,
  takesSyntheticBpm,
  withTrackBpm,
} from './editor'
import { hasBpm, type FilledStage } from './fill'
import { buildKey, runBuild, type BuildResult, type StageDraft } from './stages'
import type { TrackWithBpm } from './types'

function track(
  id: string,
  bpm: number | null,
  bpmSource: TrackWithBpm['bpmSource'] = bpm === null ? null : 'api',
  durationMs = 200_000
): TrackWithBpm {
  return { id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: ['Artist'], durationMs, bpm, bpmSource }
}

function draft(id: string, anchorTrackId: string, durationMs = 400_000): StageDraft {
  return { id, name: id, durationMs, anchorTrackId }
}

// warmup 150 · build 160 · peak 172 · cooldown 145 (F4's example).
const tracks: TrackWithBpm[] = Object.freeze([
  track('a150', 150),
  track('a160', 160),
  track('a172', 172),
  track('a145', 145),
  track('t158', 158),
  track('t165', 165),
  track('t170', 170),
  track('t175', 175),
  track('t200', 200),
  track('miss', null, 'api'),
  track('pending', null, null),
  track('guess', 150, 'synthetic'),
  track('man', 140, 'manual'),
]) as TrackWithBpm[]

const drafts = [draft('warmup', 'a150'), draft('build', 'a160'), draft('peak', 'a172'), draft('cooldown', 'a145')]

function build(): BuildResult {
  // Short targets so some tracks stay unplaced.
  return runBuild(drafts, tracks, 1)
}

function stage(result: BuildResult, id: string): FilledStage<TrackWithBpm> {
  return result.stages.find((s) => s.id === id)!
}

function ids(ts: TrackWithBpm[]): string[] {
  return ts.map((t) => t.id)
}

function sortedBpms(ts: TrackWithBpm[]): number[] {
  return ts.filter(hasBpm).map((t) => t.bpm)
}

// Every track of the build exactly once across stages + unplaced.
function expectPartition(result: BuildResult) {
  const all = [...result.stages.flatMap((s) => ids(s.tracks)), ...ids(result.unplaced)]
  expect(all.sort()).toEqual(ids(tracks).sort())
}

describe('locateTrack / checkMove', () => {
  const result = build()

  it('finds a track in a stage or in Unplaced', () => {
    expect(locateTrack(result, 'a172')?.container).toBe('peak')
    expect(locateTrack(result, 'miss')?.container).toBeNull()
    expect(locateTrack(result, 'nope')).toBeNull()
  })

  it('allows any move between containers, including out-of-range ones', () => {
    expect(checkMove(result, 'miss', 'peak')).toBeNull()
    expect(checkMove(result, 't200', 'warmup')).toBeNull()
    expect(checkMove(result, 'a160', 'build')).toBe('same-container')
  })

  it('keeps an anchor in its own stage', () => {
    expect(checkMove(result, 'a172', 'build')).toBe('anchor')
    expect(checkMove(result, 'a172', null)).toBe('anchor')
  })

  it('refuses unknown tracks and stages', () => {
    expect(checkMove(result, 'nope', 'peak')).toBe('not-found')
    expect(checkMove(result, 'miss', 'nope')).toBe('not-found')
  })
})

describe('takesSyntheticBpm', () => {
  it('is true for missing and synthetic BPMs only', () => {
    expect(takesSyntheticBpm(track('x', null, 'api'))).toBe(true)
    expect(takesSyntheticBpm(track('x', null, null))).toBe(true)
    expect(takesSyntheticBpm(track('x', 150, 'synthetic'))).toBe(true)
    expect(takesSyntheticBpm(track('x', 150, 'api'))).toBe(false)
    expect(takesSyntheticBpm(track('x', 150, 'manual'))).toBe(false)
  })
})

describe('moveTrack', () => {
  it('gives a no-BPM track the stage center as a synthetic BPM and asks to cache it', () => {
    const before = build()
    const peak = stage(before, 'peak')
    const { result, synthetic } = moveTrack(before, 'miss', 'peak')

    const moved = stage(result, 'peak').tracks.find((t) => t.id === 'miss')!
    expect(moved).toMatchObject({ bpm: 172, bpmSource: 'synthetic' })
    expect(synthetic).toEqual({ trackId: 'miss', bpm: 172, tolerance: stage(result, 'peak').spreadBpm })
    expect(result.unplaced.some((t) => t.id === 'miss')).toBe(false)
    expect(result.edited).toBe(true)
    expectPartition(result)

    // Totals follow the move; direction (peak: up, then down) is re-applied.
    expect(stage(result, 'peak').totalMs).toBe(peak.totalMs + 200_000)
    expect(stage(result, 'peak').direction).toBe(peak.direction)
    const bpms = sortedBpms(stage(result, 'peak').tracks)
    const top = bpms.indexOf(Math.max(...bpms))
    expect(bpms.slice(0, top + 1)).toEqual([...bpms.slice(0, top + 1)].sort((a, b) => a - b))
    expect(bpms.slice(top)).toEqual([...bpms.slice(top)].sort((a, b) => b - a))
  })

  it('treats a pending lookup like a miss', () => {
    const { synthetic } = moveTrack(build(), 'pending', 'warmup')
    expect(synthetic).toMatchObject({ trackId: 'pending', bpm: 150 })
  })

  it('re-guesses a synthetic track dropped into another stage', () => {
    let result = moveTrack(build(), 'miss', 'peak').result
    const second = moveTrack(result, 'miss', 'build')
    result = second.result
    expect(second.synthetic).toMatchObject({ trackId: 'miss', bpm: 160 })
    expect(locateTrack(result, 'miss')).toMatchObject({ container: 'build', track: { bpm: 160, bpmSource: 'synthetic' } })
    expect(stage(result, 'peak').tracks.some((t) => t.id === 'miss')).toBe(false)
    expectPartition(result)
  })

  it('never re-guesses an api or manual BPM, even out of range', () => {
    const before = build()
    for (const id of ['t200', 'man']) {
      const at = locateTrack(before, id)!
      const target = at.container === 'warmup' ? 'peak' : 'warmup'
      const { result, synthetic } = moveTrack(before, id, target)
      expect(synthetic).toBeNull()
      expect(locateTrack(result, id)).toMatchObject({ container: target, track: at.track })
    }
  })

  it('moves a track back to Unplaced without a cache write, keeping its BPM', () => {
    const placed = moveTrack(build(), 'miss', 'peak').result
    const peakTotal = stage(placed, 'peak').totalMs
    const { result, synthetic } = moveTrack(placed, 'miss', null)
    expect(synthetic).toBeNull()
    expect(locateTrack(result, 'miss')).toMatchObject({ container: null, track: { bpm: 172, bpmSource: 'synthetic' } })
    expect(stage(result, 'peak').totalMs).toBe(peakTotal - 200_000)
    expectPartition(result)
  })

  it('updates shortfall as tracks leave a stage', () => {
    const before = build()
    const build_ = stage(before, 'build')
    const other = build_.tracks.find((t) => t.id !== build_.anchorTrackId)!
    const { result } = moveTrack(before, other.id, null)
    expect(stage(result, 'build').totalMs).toBe(build_.totalMs - other.durationMs)
    expect(stage(result, 'build').shortfallMs).toBe(Math.max(0, build_.targetMs - stage(result, 'build').totalMs))
  })

  it('returns the same result for a refused move, and never mutates its input', () => {
    const before = build()
    const snapshot = JSON.stringify(before)
    expect(moveTrack(before, 'a172', null)).toEqual({ result: before, synthetic: null })
    expect(moveTrack(before, 'a160', 'build').result).toBe(before)
    moveTrack(before, 'miss', 'peak')
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('setResultTrackBpm', () => {
  it('replaces the BPM wherever the track is and re-orders its stage', () => {
    const placed = moveTrack(build(), 'miss', 'peak').result
    const result = setResultTrackBpm(placed, 'miss', 120, 'api')
    expect(locateTrack(result, 'miss')).toMatchObject({ container: 'peak', track: { bpm: 120, bpmSource: 'api' } })
    expect(result.edited).toBe(true)

    const unplaced = setResultTrackBpm(build(), 'miss', 99, 'api')
    expect(locateTrack(unplaced, 'miss')?.track.bpm).toBe(99)
  })

  it('returns the same result when nothing changes', () => {
    const before = build()
    expect(setResultTrackBpm(before, 'a172', 172, 'api')).toBe(before)
    expect(setResultTrackBpm(before, 'nope', 1, 'api')).toBe(before)
  })
})

describe('withTrackBpm / carryKey', () => {
  it('keeps a current result current after a synthetic BPM lands in the playlist', () => {
    const result = build()
    const after = withTrackBpm(tracks, 'miss', 172, 'synthetic')
    expect(after.find((t) => t.id === 'miss')).toMatchObject({ bpm: 172, bpmSource: 'synthetic' })
    expect(tracks.find((t) => t.id === 'miss')?.bpm).toBeNull()
    expect(buildKey(drafts, after)).not.toBe(result.key)
    expect(carryKey(result.key, drafts, tracks, after)).toBe(buildKey(drafts, after))
  })

  it('leaves a stale result stale', () => {
    const result = build()
    const changed = drafts.map((d) => (d.id === 'peak' ? { ...d, durationMs: 1 } : d))
    const after = withTrackBpm(tracks, 'miss', 172, 'synthetic')
    expect(carryKey(result.key, changed, tracks, after)).toBe(result.key)
  })
})

describe('orderUnplaced', () => {
  it('lists no-BPM tracks first in arrival order, then the rest by BPM', () => {
    const out = orderUnplaced([track('b', 170), track('z', null), track('a', 170), track('c', 120), track('y', null, 'api')])
    expect(ids(out)).toEqual(['z', 'y', 'c', 'a', 'b'])
  })
})

describe('parseSyntheticWrite', () => {
  it('accepts exactly { trackId, bpm, tolerance }', () => {
    expect(parseSyntheticWrite({ trackId: '4uLU6hMCjMI75M1A2tKUQC', bpm: 172, tolerance: 3 })).toEqual({
      trackId: '4uLU6hMCjMI75M1A2tKUQC',
      bpm: 172,
      tolerance: 3,
    })
    expect(parseSyntheticWrite({ trackId: 'a', bpm: 0.5, tolerance: 0 })).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['an array', [{ trackId: 'a', bpm: 172, tolerance: 3 }]],
    ['a missing key', { trackId: 'a', bpm: 172 }],
    ['an extra key', { trackId: 'a', bpm: 172, tolerance: 3, source: 'api' }],
    ['a non-base62 ID', { trackId: 'a/b', bpm: 172, tolerance: 3 }],
    ['a too-long ID', { trackId: 'a'.repeat(65), bpm: 172, tolerance: 3 }],
    ['a zero BPM', { trackId: 'a', bpm: 0, tolerance: 3 }],
    ['an absurd BPM', { trackId: 'a', bpm: 1000, tolerance: 3 }],
    ['a NaN-ish BPM', { trackId: 'a', bpm: '172', tolerance: 3 }],
    ['a negative tolerance', { trackId: 'a', bpm: 172, tolerance: -1 }],
    ['a null tolerance', { trackId: 'a', bpm: 172, tolerance: null }],
  ])('rejects %s', (_, body) => {
    expect(parseSyntheticWrite(body)).toBeNull()
  })
})

describe('postSynthetic', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the write and returns the stored entry', async () => {
    const fetchMock = vi.fn(async () => Response.json({ bpm: 172, tolerance: 3, bpmSource: 'synthetic' }))
    vi.stubGlobal('fetch', fetchMock)
    const write = { trackId: 'a', bpm: 172, tolerance: 3 }
    expect(await postSynthetic(write)).toEqual({ bpm: 172, tolerance: 3, bpmSource: 'synthetic' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bpm/synthetic',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(write) })
    )
  })

  it("throws the route's error message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { kind: 'unauthorized', message: 'Not logged in to Spotify.' } }, { status: 401 }))
    )
    await expect(postSynthetic({ trackId: 'a', bpm: 172, tolerance: 3 })).rejects.toThrow('Not logged in to Spotify.')
  })
})
