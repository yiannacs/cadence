import { describe, it, expect } from 'vitest'
import {
  allocationIndex,
  fillStages,
  hasBpm,
  inRange,
  mergeEqualContiguous,
  recomputeStage,
  validateStages,
  type FillTrack,
  type FilledStage,
  type StageSpec,
} from './fill'

const MIN = 60_000

function track(id: string, bpm: number | null, durationMs = 3 * MIN): FillTrack {
  return { id, bpm, durationMs }
}

function stage(id: string, anchorTrackId: string, durationMs = 10 * MIN): StageSpec {
  return { id, anchorTrackId, durationMs }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function bpms(s: FilledStage<FillTrack>): number[] {
  return s.tracks.map((t) => (hasBpm(t) ? t.bpm : s.centerBpm))
}

function ids(s: FilledStage<FillTrack>): string[] {
  return s.tracks.map((t) => t.id)
}

function nonDecreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || xs[i - 1] <= x)
}

function nonIncreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || xs[i - 1] >= x)
}

function matchesDirection(s: FilledStage<FillTrack>): boolean {
  const xs = bpms(s)
  switch (s.direction) {
    case 'asc':
      return nonDecreasing(xs)
    case 'desc':
      return nonIncreasing(xs)
    case 'peak':
      return xs.some((_, k) => nonDecreasing(xs.slice(0, k + 1)) && nonIncreasing(xs.slice(k)))
    case 'valley':
      return xs.some((_, k) => nonIncreasing(xs.slice(0, k + 1)) && nonDecreasing(xs.slice(k)))
  }
}

type Output = ReturnType<typeof fillStages<FillTrack>>

function assertInvariants(stages: StageSpec[], pool: FillTrack[], out: Output) {
  // Each pool ID appears exactly once across stages + unplaced.
  const all = [...out.stages.flatMap((s) => s.tracks), ...out.unplaced].map((t) => t.id)
  expect([...all].sort()).toEqual(pool.map((t) => t.id).sort())

  // No-BPM tracks only in unplaced.
  for (const s of out.stages) for (const t of s.tracks) expect(hasBpm(t)).toBe(true)

  expect(out.stages.map((s) => s.id)).toEqual(stages.map((s) => s.id))
  out.stages.forEach((s, i) => {
    const anchor = pool.find((t) => t.id === stages[i].anchorTrackId)!
    expect(s.anchorTrackId).toBe(anchor.id)
    expect(s.tracks).toContain(anchor)
    expect(s.centerBpm).toBe(anchor.bpm)
    expect(s.targetMs).toBe(stages[i].durationMs)

    for (const t of s.tracks) {
      if (t.id !== anchor.id) expect(inRange(t.bpm!, s.rangeBpm)).toBe(true)
    }

    expect(matchesDirection(s)).toBe(true)

    const total = s.tracks.reduce((sum, t) => sum + t.durationMs, 0)
    expect(s.totalMs).toBe(total)
    expect(s.shortfallMs).toBe(Math.max(0, s.targetMs - total))
    // Overshoot bound: whichever track went in last, the stage was still short
    // before it — so removing the longest non-anchor track must leave it short.
    const others = s.tracks.filter((t) => t.id !== anchor.id)
    if (others.length > 0) {
      expect(total - Math.max(...others.map((t) => t.durationMs))).toBeLessThan(s.targetMs)
    }

    const spread = Math.max(3, ...s.tracks.map((t) => Math.abs(t.bpm! - s.centerBpm)))
    expect(s.spreadBpm).toBe(spread)
  })
}

function run(stages: StageSpec[], pool: FillTrack[], seed = 1): Output {
  const out = fillStages(stages, pool, seed)
  assertInvariants(stages, pool, out)
  return out
}

// Every 1 BPM from 120 to 200 — enough music that nothing comes up short.
function spread(from = 120, to = 200, durationMs = 3 * MIN): FillTrack[] {
  const out: FillTrack[] = []
  for (let b = from; b <= to; b++) out.push(track(`t${b}`, b, durationMs))
  return out
}

describe('hasBpm', () => {
  it('treats null, NaN, Infinity, 0 and negatives as no BPM', () => {
    for (const bpm of [null, NaN, Infinity, -Infinity, 0, -120]) expect(hasBpm(track('x', bpm))).toBe(false)
    expect(hasBpm(track('x', 0.5))).toBe(true)
    expect(hasBpm(track('x', 150))).toBe(true)
  })
})

describe('fillStages — ranges', () => {
  const pool = deepFreeze([
    track('warm', 150),
    track('build', 160),
    track('peak', 172),
    track('cool', 145),
    ...spread(130, 190, MIN),
    track('x155', 155, MIN),
    track('x155.1', 155.1, MIN),
    track('x166', 166, MIN),
    track('x166.1', 166.1, MIN),
  ])
  const stages = deepFreeze([
    stage('warmup', 'warm', 30 * MIN),
    stage('build', 'build', 30 * MIN),
    stage('peak', 'peak', 30 * MIN),
    stage('cooldown', 'cool', 30 * MIN),
  ])

  it('matches the worked example', () => {
    const out = run(stages, pool)
    expect(out.stages.map((s) => s.rangeBpm)).toEqual([
      [-Infinity, 155],
      [155, 166],
      [166, Infinity],
      [-Infinity, 158.5],
    ])
    expect(out.stages.map((s) => s.direction)).toEqual(['asc', 'asc', 'peak', 'desc'])
    for (const t of out.stages[1].tracks) {
      expect(t.bpm).toBeGreaterThan(155)
      expect(t.bpm).toBeLessThanOrEqual(166)
    }
  })

  it('gives a midpoint track to the lower stage', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = run(stages, pool, seed)
      const stageOf = (id: string) => out.stages.find((s) => s.tracks.some((t) => t.id === id))?.id
      expect(stageOf('x166')).not.toBe('peak')
      expect(stageOf('x166.1')).not.toBe('build')
      expect(stageOf('x155')).not.toBe('build')
      expect(stageOf('x155.1')).not.toBe('warmup')
    }
  })

  it('close anchors: a 153 track goes to the 155 stage, never the 150 stage', () => {
    const pool = [track('a150', 150), track('a155', 155), track('x153', 153), track('x152.5', 152.5)]
    const out = run([stage('A', 'a150'), stage('B', 'a155')], pool)
    expect(out.stages[0].rangeBpm).toEqual([-Infinity, 152.5])
    expect(out.stages[1].rangeBpm).toEqual([152.5, Infinity])
    expect(ids(out.stages[1])).toContain('x153')
    expect(ids(out.stages[0])).toContain('x152.5')
    expect(ids(out.stages[0])).not.toContain('x153')
  })

  it('handles an anchor close to the edge of its range', () => {
    const pool = [track('a', 150), track('b', 150.5), track('x150.25', 150.25), track('x150.3', 150.3)]
    const out = run([stage('A', 'a'), stage('B', 'b')], pool)
    expect(out.stages[0].rangeBpm).toEqual([-Infinity, 150.25])
    expect(out.stages[1].rangeBpm).toEqual([150.25, Infinity])
    expect(ids(out.stages[0])).toContain('x150.25')
    expect(ids(out.stages[1])).toContain('x150.3')
  })
})

describe('fillStages — greedy fill', () => {
  it('takes nearest-to-anchor tracks until the target is met, ties by ID', () => {
    const pool = [
      track('anchor', 150),
      track('b', 152),
      track('a', 148),
      track('far', 159),
      track('near', 151),
      track('mid', 155),
    ]
    // Anchor + 3 tracks reaches 12 min: near (1), then a/b tied at 2 → a, b.
    const out = run([stage('S', 'anchor', 12 * MIN)], pool)
    expect([...ids(out.stages[0])].sort()).toEqual(['a', 'anchor', 'b', 'near'])
    expect(out.unplaced.map((t) => t.id)).toEqual(['far', 'mid'])
    expect(out.stages[0].totalMs).toBe(12 * MIN)
    expect(out.stages[0].shortfallMs).toBe(0)
  })

  it('tie-breaks by code unit, not locale', () => {
    // 'B' < 'a' by code unit; localeCompare would put 'a' first.
    const pool = [track('anchor', 150), track('a', 151), track('B', 149)]
    const out = run([stage('S', 'anchor', 6 * MIN)], pool)
    expect(ids(out.stages[0])).toContain('B')
    expect(out.unplaced.map((t) => t.id)).toEqual(['a'])
  })

  it('overshoots by at most one track', () => {
    const pool = [track('anchor', 150, 4 * MIN), track('x', 151, 5 * MIN), track('y', 152, 5 * MIN)]
    const out = run([stage('S', 'anchor', 5 * MIN)], pool)
    expect(out.stages[0].totalMs).toBe(9 * MIN)
    expect(out.unplaced.map((t) => t.id)).toEqual(['y'])
  })

  it('stops at the anchor when it alone meets the target', () => {
    const pool = [track('anchor', 150, 6 * MIN), track('x', 150)]
    const out = run([stage('S', 'anchor', 5 * MIN)], pool)
    expect(ids(out.stages[0])).toEqual(['anchor'])
  })

  it('comes up short rather than borrowing across a contiguous boundary', () => {
    const pool = [
      track('a150', 150),
      track('a170', 170),
      track('x158', 158),
      ...spread(161, 169),
    ]
    const out = run([stage('A', 'a150', 30 * MIN), stage('B', 'a170', 3 * MIN)], pool)
    const [a, b] = out.stages
    expect(ids(a)).toEqual(['a150', 'x158'])
    expect(a.shortfallMs).toBe(24 * MIN)
    // B didn't need them, but they're out of A's range: they stay unplaced.
    expect(ids(b)).toEqual(['a170'])
    expect(out.unplaced).toHaveLength(9)
  })

  it('never puts one stage’s anchor in another stage', () => {
    const pool = [track('a150', 150), track('b151', 151), track('c150', 150)]
    // A and C aren't contiguous, so they may share a BPM; B sits between.
    const out = run([stage('A', 'a150'), stage('B', 'b151'), stage('C', 'c150')], pool)
    expect(out.stages.map(ids)).toEqual([['a150'], ['b151'], ['c150']])
  })

  it('sends no-BPM tracks to unplaced, in pool order', () => {
    const pool = [
      track('n1', null),
      track('anchor', 150),
      track('n2', NaN),
      track('n3', 0),
      track('n4', -150),
      track('x', 150),
    ]
    const out = run([stage('S', 'anchor', 60 * MIN)], pool)
    expect(out.unplaced.map((t) => t.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
  })
})

describe('fillStages — overlap between non-contiguous stages', () => {
  // warmup (−∞, 160] and cooldown (−∞, 157.5] overlap at ≤ 157.5.
  const anchors = [track('w', 150), track('p', 170), track('c', 145)]
  const overlap = Array.from({ length: 20 }, (_, i) => track(`o${i}`, 140 + i * 0.75, MIN))
  const pool = deepFreeze([...anchors, ...overlap])

  it('is reproducible for a given seed', () => {
    const stages = [stage('W', 'w', 8 * MIN), stage('P', 'p'), stage('C', 'c', 8 * MIN)]
    expect(run(stages, pool, 42)).toEqual(run(stages, pool, 42))
  })

  it('can differ between seeds', () => {
    // Targets big enough that each stage takes everything allocated to it, so
    // the result shows the allocation directly.
    const stages = [stage('W', 'w', 60 * MIN), stage('P', 'p'), stage('C', 'c', 60 * MIN)]
    const results = new Set<string>()
    for (let seed = 0; seed < 10; seed++) {
      results.add(JSON.stringify(run(stages, pool, seed).stages.map(ids)))
    }
    expect(results.size).toBeGreaterThan(1)
  })

  it('splits overlap tracks between both stages', () => {
    const stages = [stage('W', 'w', 60 * MIN), stage('P', 'p'), stage('C', 'c', 60 * MIN)]
    const out = run(stages, pool, 7)
    // Both stages are short and between them take every overlap track.
    expect(out.stages[0].tracks.length + out.stages[2].tracks.length).toBe(22)
  })

  it('rebalances overlap tracks the chosen stage didn’t need to a short stage', () => {
    // W is satisfied by its anchor; C wants every overlap track.
    const stages = [stage('W', 'w', 3 * MIN), stage('P', 'p'), stage('C', 'c', 60 * MIN)]
    for (const seed of [0, 1, 2, 3, 99]) {
      const out = run(stages, pool, seed)
      expect(ids(out.stages[0])).toEqual(['w'])
      expect(out.stages[2].tracks).toHaveLength(21)
      expect(out.unplaced).toEqual([])
    }
  })

  it('rebalances nearest-to-anchor first', () => {
    // Overlap tracks at 144 (near C) and 151 (far from C). Find a seed that
    // allocates both to W, which doesn't need them; C needs exactly one.
    const pool = [...anchors, track('x144', 144), track('x151', 151)]
    const seed = Array.from({ length: 1000 }, (_, s) => s).find(
      (s) => allocationIndex(s, 'x144', 2) === 0 && allocationIndex(s, 'x151', 2) === 0
    )!
    expect(seed).toBeDefined()
    const out = run([stage('W', 'w', 3 * MIN), stage('P', 'p'), stage('C', 'c', 6 * MIN)], pool, seed)
    expect(ids(out.stages[0])).toEqual(['w'])
    expect([...ids(out.stages[2])].sort()).toEqual(['c', 'x144'])
    expect(out.unplaced.map((t) => t.id)).toEqual(['x151'])
  })

  it('only rebalances into stages whose range covers the track', () => {
    // 159 is in W's range (≤ 160) but not C's (≤ 157.5).
    const pool = [...anchors, track('x159', 159)]
    const out = run([stage('W', 'w', 3 * MIN), stage('P', 'p'), stage('C', 'c', 60 * MIN)], pool)
    expect(ids(out.stages[2])).toEqual(['c'])
    expect(out.unplaced.map((t) => t.id)).toEqual(['x159'])
  })
})

describe('fillStages — direction', () => {
  // Every track in range, so the order shows the direction clearly.
  function directions(centers: number[]) {
    const pool = [...centers.map((b, i) => track(`a${i}`, b)), ...spread(100, 220, MIN)]
    const stages = centers.map((_, i) => stage(`S${i}`, `a${i}`, 5 * MIN))
    return run(stages, pool).stages.map((s) => s.direction)
  }

  it('lower → this → higher is ascending', () => {
    expect(directions([140, 150, 160])[1]).toBe('asc')
  })

  it('higher → this → lower is descending', () => {
    expect(directions([160, 150, 140])[1]).toBe('desc')
  })

  it('lower → this → lower is a peak', () => {
    expect(directions([140, 160, 150])[1]).toBe('peak')
  })

  it('higher → this → higher is a valley', () => {
    expect(directions([160, 140, 150])[1]).toBe('valley')
  })

  it('first stage heads towards the next anchor', () => {
    expect(directions([150, 160])[0]).toBe('asc')
    expect(directions([160, 150])[0]).toBe('desc')
  })

  it('last stage continues the direction coming in', () => {
    expect(directions([150, 160])[1]).toBe('asc')
    expect(directions([160, 150])[1]).toBe('desc')
    expect(directions([140, 170, 150])[2]).toBe('desc')
    expect(directions([170, 140, 150])[2]).toBe('asc')
  })

  it('a single stage is ascending', () => {
    expect(directions([150])).toEqual(['asc'])
  })

  // Single stage → whole range, all tracks taken; direction forced via recompute.
  const pool = [
    track('s0', 150),
    track('s1', 151),
    track('s2', 152),
    track('s3', 153),
    track('s4', 154),
    track('s5', 155),
  ]
  const base = fillStages([stage('S', 's0', 60 * MIN)], pool, 1).stages[0]

  it('deals peak tracks alternately into rising and falling halves', () => {
    const peak = recomputeStage({ ...base, direction: 'peak' }, pool)
    expect(ids(peak)).toEqual(['s0', 's2', 's4', 's5', 's3', 's1'])
  })

  it('deals valley tracks alternately into falling and rising halves', () => {
    const valley = recomputeStage({ ...base, direction: 'valley' }, pool)
    expect(ids(valley)).toEqual(['s4', 's2', 's0', 's1', 's3', 's5'])
  })

  it('breaks BPM ties by ID in every direction', () => {
    const tied = [track('b', 150), track('a', 150), track('c', 150)]
    const s = fillStages([stage('S', 'b', 60 * MIN)], tied, 1).stages[0]
    expect(ids(s)).toEqual(['a', 'b', 'c'])
    expect(ids(recomputeStage({ ...s, direction: 'desc' }, tied))).toEqual(['a', 'b', 'c'])
    expect(ids(recomputeStage({ ...s, direction: 'peak' }, tied))).toEqual(['a', 'c', 'b'])
    expect(ids(recomputeStage({ ...s, direction: 'valley' }, tied))).toEqual(['c', 'a', 'b'])
  })

  it('orders a whole filled run by each stage’s direction', () => {
    const pool = [track('w', 150), track('b', 160), track('p', 172), track('c', 145), ...spread(120, 200, MIN)]
    const out = run(
      [stage('W', 'w', 8 * MIN), stage('B', 'b', 8 * MIN), stage('P', 'p', 8 * MIN), stage('C', 'c', 8 * MIN)],
      pool,
      3
    )
    expect(nonDecreasing(bpms(out.stages[0]))).toBe(true)
    expect(nonIncreasing(bpms(out.stages[3]))).toBe(true)
  })
})

describe('validateStages', () => {
  const pool = [track('a', 150), track('b', 160), track('c', 170), track('none', null)]

  it('accepts valid stages', () => {
    expect(validateStages([stage('A', 'a'), stage('B', 'b')], pool)).toEqual([])
  })

  it('rejects non-finite or non-positive durations', () => {
    for (const d of [0, -1, NaN, Infinity]) {
      expect(validateStages([stage('A', 'a', d)], pool)).toEqual([
        { stageId: 'A', reason: 'invalid-duration', blocking: true },
      ])
    }
  })

  it('rejects an anchor missing from the pool', () => {
    expect(validateStages([stage('A', 'zzz')], pool)).toEqual([
      { stageId: 'A', reason: 'anchor-missing', blocking: true },
    ])
  })

  it('rejects anchors without a BPM (null, NaN, 0, negative)', () => {
    for (const bpm of [null, NaN, 0, -150]) {
      expect(validateStages([stage('A', 'x')], [track('x', bpm)])).toEqual([
        { stageId: 'A', reason: 'anchor-no-bpm', blocking: true },
      ])
    }
  })

  it('rejects the same track anchoring two stages', () => {
    expect(validateStages([stage('A', 'a'), stage('B', 'b'), stage('C', 'a')], pool)).toEqual([
      { stageId: 'C', reason: 'duplicate-anchor', blocking: true },
    ])
  })

  it('flags contiguous equal anchors as a non-blocking notice', () => {
    const pool = [track('a', 150), track('a2', 150), track('b', 160)]
    expect(validateStages([stage('A', 'a'), stage('A2', 'a2')], pool)).toEqual([
      { stageId: 'A2', reason: 'equal-contiguous-anchors', blocking: false },
    ])
    expect(validateStages([stage('A', 'a'), stage('B', 'b'), stage('A2', 'a2')], pool)).toEqual([])
  })

  it('rejects duplicate stage IDs', () => {
    expect(validateStages([stage('A', 'a'), stage('A', 'b')], pool)).toEqual([
      { stageId: 'A', reason: 'duplicate-stage-id', blocking: true },
    ])
  })

  it('rejects duplicate pool IDs, once per ID', () => {
    const dupes = [...pool, track('b', 160), track('b', 161)]
    expect(validateStages([stage('A', 'a')], dupes)).toEqual([
      { stageId: null, reason: 'duplicate-pool-id', blocking: true, trackId: 'b' },
    ])
  })

  it('makes fillStages throw on every problem, notices included', () => {
    const cases: [StageSpec[], FillTrack[]][] = [
      [[stage('A', 'a', 0)], pool],
      [[stage('A', 'zzz')], pool],
      [[stage('A', 'none')], pool],
      [[stage('A', 'a'), stage('B', 'a')], pool],
      [[stage('A', 'a'), stage('B', 'b2')], [...pool, track('b2', 150)]],
      [[stage('A', 'a'), stage('A', 'b')], pool],
      [[stage('A', 'a')], [...pool, track('a', 150)]],
    ]
    for (const [stages, p] of cases) expect(() => fillStages(stages, p, 1)).toThrow(/fillStages/)
  })
})

describe('mergeEqualContiguous', () => {
  const pool = deepFreeze([
    track('a', 150),
    track('a2', 150),
    track('a3', 150),
    track('b', 160),
    track('b2', 160),
  ])

  it('merges a pair into the first stage, summing durations', () => {
    const stages = deepFreeze([stage('A', 'a', 5 * MIN), stage('A2', 'a2', 7 * MIN), stage('B', 'b')])
    const out = mergeEqualContiguous(stages, pool)
    expect(out.stages).toEqual([stage('A', 'a', 12 * MIN), stage('B', 'b')])
    expect(out.merged).toEqual([['A', 'A2']])
    expect(validateStages(out.stages, pool)).toEqual([])
  })

  it('merges a run of three', () => {
    const stages = [stage('A', 'a', MIN), stage('A2', 'a2', 2 * MIN), stage('A3', 'a3', 3 * MIN)]
    const out = mergeEqualContiguous(stages, pool)
    expect(out.stages).toEqual([stage('A', 'a', 6 * MIN)])
    expect(out.merged).toEqual([['A', 'A2', 'A3']])
  })

  it('merges separate runs separately', () => {
    const stages = [stage('A', 'a'), stage('A2', 'a2'), stage('B', 'b'), stage('B2', 'b2')]
    const out = mergeEqualContiguous(stages, pool)
    expect(out.stages.map((s) => s.id)).toEqual(['A', 'B'])
    expect(out.merged).toEqual([
      ['A', 'A2'],
      ['B', 'B2'],
    ])
  })

  it('leaves equal non-contiguous anchors alone', () => {
    const stages = [stage('A', 'a'), stage('B', 'b'), stage('A2', 'a2')]
    const out = mergeEqualContiguous(stages, pool)
    expect(out.stages).toEqual(stages)
    expect(out.merged).toEqual([])
  })

  it('does not merge stages whose anchors are missing or lack a BPM', () => {
    const p = [track('n1', null), track('n2', null)]
    const stages = [stage('A', 'n1'), stage('B', 'n2'), stage('C', 'gone'), stage('D', 'gone2')]
    expect(mergeEqualContiguous(stages, p).merged).toEqual([])
  })
})

describe('fillStages — edge cases and purity', () => {
  it('returns every track unplaced when there are no stages', () => {
    const pool = [track('a', 150), track('n', null)]
    const out = fillStages([], pool, 1)
    expect(out).toEqual({ stages: [], unplaced: pool })
    expect(out.unplaced).not.toBe(pool)
  })

  it('handles an empty pool', () => {
    expect(fillStages([], [], 1)).toEqual({ stages: [], unplaced: [] })
    expect(() => fillStages([stage('A', 'a')], [], 1)).toThrow(/anchor-missing/)
  })

  it('does not mutate its inputs', () => {
    const pool = deepFreeze([
      track('w', 150),
      track('p', 170),
      track('c', 145),
      track('n', null),
      ...spread(130, 180, MIN),
    ])
    const stages = deepFreeze([stage('W', 'w', 8 * MIN), stage('P', 'p', 8 * MIN), stage('C', 'c', 8 * MIN)])
    const out = run(stages, pool, 5)
    deepFreeze(out)
    const moved = [...out.stages[0].tracks, track('n', null)]
    expect(() => recomputeStage(out.stages[0], moved)).not.toThrow()
    expect(() => validateStages(stages, pool)).not.toThrow()
    expect(() => mergeEqualContiguous(stages, pool)).not.toThrow()
  })

  it('gives the same stages when the pool is shuffled', () => {
    const pool = [track('w', 150), track('p', 170), track('c', 145), track('n', null), ...spread(120, 190, MIN)]
    const stages = [stage('W', 'w', 15 * MIN), stage('P', 'p', 15 * MIN), stage('C', 'c', 15 * MIN)]
    const reference = run(stages, pool, 11)

    // Deterministic shuffles (reverse, interleave) — no Math.random in tests.
    const shuffles = [
      [...pool].reverse(),
      [...pool.filter((_, i) => i % 2 === 1), ...pool.filter((_, i) => i % 2 === 0)],
    ]
    for (const shuffled of shuffles) {
      const out = run(stages, shuffled, 11)
      expect(out.stages).toEqual(reference.stages)
      expect(out.unplaced.map((t) => t.id).sort()).toEqual(reference.unplaced.map((t) => t.id).sort())
      // unplaced follows the order of the pool it was given.
      const order = shuffled.map((t) => t.id)
      const positions = out.unplaced.map((t) => order.indexOf(t.id))
      expect(nonDecreasing(positions)).toBe(true)
    }
  })

  it('returns the caller’s own track objects', () => {
    const pool = [track('a', 150), track('x', 151)]
    const out = fillStages([stage('A', 'a')], pool, 1)
    expect(out.stages[0].tracks[0]).toBe(pool[0])
  })
})

describe('recomputeStage', () => {
  const pool = [track('anchor', 150), track('x', 146), track('y', 155), track('z', 152)]
  const filled = deepFreeze(fillStages([stage('S', 'anchor', 60 * MIN)], pool, 1).stages[0])

  it('places a no-BPM track as if it were at the center, ignoring it for spread', () => {
    const dropped = track('miss', null, MIN)
    const out = recomputeStage(filled, [...filled.tracks, dropped])
    expect(ids(out)).toEqual(['x', 'anchor', 'miss', 'z', 'y'])
    expect(out.spreadBpm).toBe(5)
    expect(out.totalMs).toBe(filled.totalMs + MIN)
    expect(out.shortfallMs).toBe(filled.targetMs - out.totalMs)
    expect(out.rangeBpm).toEqual(filled.rangeBpm)
    expect(out.direction).toBe(filled.direction)
    expect(out).not.toBe(filled)
  })

  it('places a dropped track with a synthetic BPM by that BPM', () => {
    const dropped = { ...track('miss', null, MIN), bpm: 148 }
    expect(ids(recomputeStage(filled, [...filled.tracks, dropped]))).toEqual(['x', 'miss', 'anchor', 'z', 'y'])
  })

  it('keeps direction and range; recomputes totals when tracks leave', () => {
    const desc = recomputeStage({ ...filled, direction: 'desc' }, filled.tracks.filter((t) => t.id !== 'y'))
    expect(ids(desc)).toEqual(['z', 'anchor', 'x'])
    expect(desc.spreadBpm).toBe(4)
    expect(desc.totalMs).toBe(9 * MIN)
    expect(desc.shortfallMs).toBe(51 * MIN)
  })

  it('floors the spread at 3 BPM', () => {
    const out = recomputeStage(filled, [pool[0]])
    expect(out.spreadBpm).toBe(3)
    expect(out.shortfallMs).toBe(57 * MIN)
  })

  it('re-reads the center from the anchor’s current BPM', () => {
    const anchor = { ...pool[0], bpm: 153 }
    const out = recomputeStage(filled, [anchor, pool[1], pool[2], pool[3]])
    expect(out.centerBpm).toBe(153)
    expect(out.spreadBpm).toBe(7)
  })

  it('keeps the previous center if the anchor has no BPM', () => {
    const out = recomputeStage(filled, [{ ...pool[0], bpm: null }, pool[1]])
    expect(out.centerBpm).toBe(150)
  })

  it('throws when the anchor is missing', () => {
    expect(() => recomputeStage(filled, [pool[1], pool[2]])).toThrow(/anchor/)
  })
})
