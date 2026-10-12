import { describe, expect, it } from 'vitest'
import type { StageProblem } from './fill'
import {
  DEFAULT_STAGES,
  anchorOption,
  buildKey,
  canBuild,
  filterTracks,
  formatRange,
  minutesToMs,
  msToMinutes,
  parseStoredStages,
  problemMessage,
  runBuild,
  stageLabel,
  stagesReducer,
  totalDurationMs,
  validateDrafts,
  type StageDraft,
} from './stages'
import type { TrackWithBpm } from './types'

function track(
  id: string,
  bpm: number | null,
  { name = `Song ${id}`, artists = ['Artist'], durationMs = 200_000, bpmSource = bpm === null ? null : 'api' } = {} as {
    name?: string
    artists?: string[]
    durationMs?: number
    bpmSource?: TrackWithBpm['bpmSource']
  }
): TrackWithBpm {
  return { id, uri: `spotify:track:${id}`, name, artists, durationMs, bpm, bpmSource }
}

function draft(id: string, anchorTrackId: string | null, durationMs = 400_000, name = id): StageDraft {
  return { id, name, durationMs, anchorTrackId }
}

const tracks: TrackWithBpm[] = [
  track('a150', 150),
  track('a160', 160),
  track('a172', 172),
  track('a145', 145),
  track('t152', 152),
  track('t158', 158),
  track('t165', 165),
  track('t170', 170),
  track('miss', null, { bpmSource: 'api' }),
  track('pending', null),
]

describe('stagesReducer', () => {
  const base = [draft('w', 'a150'), draft('b', 'a160'), draft('p', null)]

  it('adds a stage with the last stage’s duration and no anchor', () => {
    const next = stagesReducer(base, { type: 'add', id: 'new' })
    expect(next).toHaveLength(4)
    expect(next[3]).toEqual({ id: 'new', name: '', durationMs: 400_000, anchorTrackId: null })
    expect(base).toHaveLength(3)
  })

  it('removes a stage', () => {
    expect(stagesReducer(base, { type: 'remove', id: 'b' }).map((s) => s.id)).toEqual(['w', 'p'])
  })

  it('moves a stage up or down, ignoring moves past either end', () => {
    expect(stagesReducer(base, { type: 'move', id: 'p', offset: -1 }).map((s) => s.id)).toEqual(['w', 'p', 'b'])
    expect(stagesReducer(base, { type: 'move', id: 'w', offset: 1 }).map((s) => s.id)).toEqual(['b', 'w', 'p'])
    expect(stagesReducer(base, { type: 'move', id: 'w', offset: -1 })).toBe(base)
    expect(stagesReducer(base, { type: 'move', id: 'p', offset: 1 })).toBe(base)
  })

  it('renames and sets durations', () => {
    const next = stagesReducer(stagesReducer(base, { type: 'rename', id: 'b', name: 'climb' }), {
      type: 'set-duration',
      id: 'b',
      durationMs: 60_000,
    })
    expect(next[1]).toEqual({ id: 'b', name: 'climb', durationMs: 60_000, anchorTrackId: 'a160' })
    expect(base[1].name).toBe('b')
  })

  it('sets an anchor and takes it off any other stage, so anchors never repeat', () => {
    const next = stagesReducer(base, { type: 'set-anchor', id: 'p', trackId: 'a150' })
    expect(next.map((s) => s.anchorTrackId)).toEqual([null, 'a160', 'a150'])
  })

  it('clears an anchor', () => {
    const next = stagesReducer(base, { type: 'set-anchor', id: 'w', trackId: null })
    expect(next.map((s) => s.anchorTrackId)).toEqual([null, 'a160', null])
  })
})

describe('durations', () => {
  it('converts minutes to ms and back', () => {
    expect(minutesToMs('5')).toBe(300_000)
    expect(minutesToMs('2.5')).toBe(150_000)
    expect(minutesToMs('')).toBeNaN()
    expect(minutesToMs('abc')).toBeNaN()
    expect(msToMinutes(300_000)).toBe('5')
    expect(msToMinutes(150_000)).toBe('2.5')
    expect(msToMinutes(NaN)).toBe('')
  })

  it('sums only valid durations', () => {
    expect(totalDurationMs([draft('a', null, 300_000), draft('b', null, NaN), draft('c', null, -5), draft('d', null, 60_000)])).toBe(
      360_000
    )
  })

  it('the default template is four stages in run order, 30 minutes in all', () => {
    expect(DEFAULT_STAGES.map((s) => s.name)).toEqual(['warmup', 'build', 'peak', 'cooldown'])
    expect(totalDurationMs(DEFAULT_STAGES)).toBe(30 * 60_000)
  })
})

describe('validateDrafts', () => {
  it('reports unpicked anchors as anchor-missing only, not as duplicates of each other', () => {
    const problems = validateDrafts([draft('a', null), draft('b', null), draft('c', 'a150')], tracks)
    expect(problems.map((p) => [p.stageId, p.reason])).toEqual([
      ['a', 'anchor-missing'],
      ['b', 'anchor-missing'],
    ])
  })

  it('still reports real duplicate anchors', () => {
    const problems = validateDrafts([draft('a', 'a150'), draft('b', 'a160'), draft('c', 'a150')], tracks)
    expect(problems.map((p) => [p.stageId, p.reason])).toEqual([['c', 'duplicate-anchor']])
  })

  it('treats equal contiguous anchors as a non-blocking notice', () => {
    const same = [...tracks, track('b150', 150)]
    const drafts = [draft('a', 'a150'), draft('b', 'b150')]
    const problems = validateDrafts(drafts, same)
    expect(problems).toEqual([{ stageId: 'b', reason: 'equal-contiguous-anchors', blocking: false }])
    expect(canBuild(drafts, problems)).toBe(true)
  })

  it('blocks Build on blocking problems and on an empty stage list', () => {
    const drafts = [draft('a', 'miss')]
    expect(canBuild(drafts, validateDrafts(drafts, tracks))).toBe(false)
    expect(canBuild([], [])).toBe(false)
    expect(canBuild([draft('a', 'a150')], [])).toBe(true)
  })
})

describe('problemMessage', () => {
  const msg = (reason: StageProblem['reason'], d?: StageDraft) =>
    problemMessage({ stageId: d?.id ?? null, reason, blocking: true }, d, tracks)

  it('words every problem code', () => {
    expect(msg('invalid-duration', draft('a', 'a150'))).toMatch(/duration/)
    expect(msg('anchor-missing', draft('a', null))).toBe('Pick an anchor song.')
    expect(msg('anchor-missing', draft('a', 'gone'))).toMatch(/isn't in this playlist/)
    expect(msg('anchor-no-bpm', draft('a', 'miss'))).toMatch(/no BPM/)
    expect(msg('anchor-no-bpm', draft('a', 'pending'))).toMatch(/Still looking up/)
    expect(msg('duplicate-anchor', draft('a', 'a150'))).toMatch(/already uses this song/)
    expect(msg('equal-contiguous-anchors', draft('a', 'a150'))).toBe(
      "Same tempo as the previous stage — they'll be merged into one."
    )
    expect(msg('duplicate-stage-id', draft('a', 'a150'))).toMatch(/duplicate/)
    expect(msg('duplicate-pool-id')).toMatch(/same track twice/)
  })
})

describe('filterTracks', () => {
  const list = [
    track('1', 120, { name: 'Don’t Stop Me Now', artists: ['Queen'] }),
    track('2', 120, { name: 'Café del Mar', artists: ['Energy 52'] }),
    track('3', 120, { name: 'Run', artists: ['Foo Fighters', 'Queen Latifah'] }),
  ]

  it('returns everything for an empty query', () => {
    expect(filterTracks(list, '  ')).toBe(list)
  })

  it('matches title and artists, ignoring case and accents, requiring every word', () => {
    expect(filterTracks(list, 'queen').map((t) => t.id)).toEqual(['1', '3'])
    expect(filterTracks(list, 'cafe').map((t) => t.id)).toEqual(['2'])
    expect(filterTracks(list, 'run latifah').map((t) => t.id)).toEqual(['3'])
    expect(filterTracks(list, 'run zzz')).toEqual([])
  })
})

describe('anchorOption', () => {
  const drafts = [draft('w', 'a150', 1, 'warmup'), draft('b', null, 1, '')]

  it('disables tracks without a BPM, saying why', () => {
    expect(anchorOption(tracks.find((t) => t.id === 'miss')!, 'b', drafts)).toEqual({
      disabled: true,
      hint: "no BPM — can't anchor",
    })
    expect(anchorOption(tracks.find((t) => t.id === 'pending')!, 'b', drafts)).toEqual({
      disabled: true,
      hint: 'BPM lookup pending',
    })
  })

  it('disables a track that anchors another stage, naming it', () => {
    expect(anchorOption(tracks[0], 'b', drafts)).toEqual({ disabled: true, hint: 'anchors warmup' })
    expect(anchorOption(tracks[0], 'w', drafts)).toEqual({ disabled: false, hint: null })
    expect(anchorOption(tracks[0], 'b', [draft('x', null), draft('y', 'a150', 1, '')])).toEqual({
      disabled: true,
      hint: 'anchors Stage 2',
    })
  })
})

describe('stageLabel', () => {
  it('falls back to the stage number', () => {
    expect(stageLabel(draft('a', null, 1, '  '), 2)).toBe('Stage 3')
    expect(stageLabel(draft('a', null, 1, ' peak '), 2)).toBe('peak')
  })
})

describe('runBuild', () => {
  const drafts = [
    draft('w', 'a150', 400_000, 'warmup'),
    draft('b', 'a160', 400_000, 'build'),
    draft('p', 'a172', 400_000, 'peak'),
    draft('c', 'a145', 400_000, 'cooldown'),
  ]

  it('fills every stage from a loaded playlist, keeping the seed', () => {
    const result = runBuild(drafts, tracks, 7)
    expect(result.seed).toBe(7)
    expect(result.edited).toBe(false)
    expect(result.merged).toEqual([])
    expect(result.stages.map((s) => s.id)).toEqual(['w', 'b', 'p', 'c'])
    expect(result.labels).toEqual({ w: 'warmup', b: 'build', p: 'peak', c: 'cooldown' })
    expect(result.stages[1].rangeBpm).toEqual([155, 166])
    for (const s of result.stages) expect(s.tracks.some((t) => t.id === s.anchorTrackId)).toBe(true)
    expect(result.unplaced.map((t) => t.id)).toEqual(expect.arrayContaining(['miss', 'pending']))
    expect(result.key).toBe(buildKey(drafts, tracks))
  })

  it('is reproducible for a seed', () => {
    expect(runBuild(drafts, tracks, 42)).toEqual(runBuild(drafts, tracks, 42))
  })

  it('merges contiguous stages with equal anchor BPMs and labels the merged stage', () => {
    const pool = [...tracks, track('b160', 160)]
    const withTwin = [drafts[0], drafts[1], draft('b2', 'b160', 200_000, ''), drafts[2]]
    const result = runBuild(withTwin, pool, 1)
    expect(result.stages.map((s) => s.id)).toEqual(['w', 'b', 'p'])
    expect(result.stages[1].targetMs).toBe(600_000)
    expect(result.labels.b).toBe('build + Stage 3')
    expect(result.merged).toEqual([['build', 'Stage 3']])
  })

  it('throws while a blocking problem remains', () => {
    expect(() => runBuild([draft('w', 'miss')], tracks, 1)).toThrow()
  })
})

describe('buildKey', () => {
  const drafts = [draft('w', 'a150')]

  it('changes when the specs change', () => {
    expect(buildKey(drafts, tracks)).not.toBe(buildKey([draft('w', 'a150', 1)], tracks))
    expect(buildKey(drafts, tracks)).not.toBe(buildKey([draft('w', 'a160')], tracks))
  })

  it('changes when more BPMs arrive', () => {
    const resolved = tracks.map((t) => (t.id === 'pending' ? { ...t, bpm: 130, bpmSource: 'api' as const } : t))
    expect(buildKey(drafts, tracks)).not.toBe(buildKey(drafts, resolved))
  })
})

describe('formatRange', () => {
  it('formats bounded and open ranges', () => {
    expect(formatRange([155, 166])).toBe('155–166')
    expect(formatRange([-Infinity, 158.5])).toBe('≤ 158.5')
    expect(formatRange([166, Infinity])).toBe('> 166')
    expect(formatRange([-Infinity, Infinity])).toBe('any')
  })
})

describe('parseStoredStages', () => {
  it('reads back what was stored, NaN durations included', () => {
    const drafts = [draft('a', 'a150', 300_000, 'warmup'), draft('b', null, NaN, '')]
    const out = parseStoredStages(JSON.stringify({ version: 1, stages: drafts }))
    expect(out).toEqual(drafts)
  })

  it('rejects missing, malformed or other-version data', () => {
    expect(parseStoredStages(null)).toBeNull()
    expect(parseStoredStages('{')).toBeNull()
    expect(parseStoredStages('null')).toBeNull()
    expect(parseStoredStages(JSON.stringify({ version: 2, stages: [] }))).toBeNull()
  })

  it('drops entries without an ID and repeated IDs, and fixes bad fields', () => {
    const raw = JSON.stringify({
      version: 1,
      stages: [{ id: 'a', name: 3, durationMs: '5', anchorTrackId: '' }, { name: 'x' }, { id: 'a' }, null],
    })
    expect(parseStoredStages(raw)).toEqual([{ id: 'a', name: '', durationMs: NaN, anchorTrackId: null }])
  })
})
