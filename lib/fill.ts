// Pure fill algorithm: stage specs + the playlist's tracks → filled, ordered
// stages. No I/O, no React, no server imports — client components import this
// file and re-run it on every Build, so it has to stay cheap and deterministic.

// Generic over the minimum shape the algorithm needs — no import of
// Track/TrackWithBpm, so fixtures stay tiny. Callers get their own objects back.
export interface FillTrack {
  id: string
  durationMs: number
  bpm: number | null
}

export interface StageSpec {
  id: string
  durationMs: number
  anchorTrackId: string
  // Co-anchors: always included in the stage, whatever their BPM. Only the
  // anchor sets the tempo. Absent = none.
  pinnedTrackIds?: string[]
}

export type Direction = 'asc' | 'desc' | 'peak' | 'valley'

export interface FilledStage<T extends FillTrack> {
  id: string
  anchorTrackId: string
  pinnedTrackIds: string[] // co-anchors, in run order
  targetMs: number
  centerBpm: number // = anchor BPM
  rangeBpm: [number, number] // (lower, upper] — may be ±Infinity
  spreadBpm: number // synthetic tolerance (F6)
  direction: Direction
  tracks: T[] // in play order
  totalMs: number
  shortfallMs: number // max(0, targetMs − totalMs)
}

export type StageProblemReason =
  | 'invalid-duration'
  | 'anchor-missing'
  | 'anchor-no-bpm'
  | 'pinned-missing'
  | 'pinned-no-bpm'
  | 'duplicate-anchor' // also a track repeated across anchors and pinned lists
  | 'equal-contiguous-anchors'
  | 'duplicate-stage-id'
  | 'duplicate-pool-id'

export interface StageProblem {
  // null when the problem isn't about one stage (duplicate pool IDs).
  stageId: string | null
  reason: StageProblemReason
  // false only for equal contiguous anchors: F5 shows a notice and merges them
  // with mergeEqualContiguous rather than disabling Build.
  blocking: boolean
  // The offending track, for duplicate-pool-id.
  trackId?: string
}

// Below this the spread is too tight to be a useful synthetic tolerance.
const MIN_SPREAD_BPM = 3

/** null, NaN, ±Infinity, 0 and negatives all count as "no BPM". */
export function hasBpm<T extends FillTrack>(t: T): t is T & { bpm: number } {
  return t.bpm !== null && Number.isFinite(t.bpm) && t.bpm > 0
}

/**
 * Ranges are (lower, upper]: a track sitting exactly on a midpoint belongs to
 * the lower-BPM stage of the pair.
 */
export function inRange(bpm: number, [lower, upper]: [number, number]): boolean {
  return bpm > lower && bpm <= upper
}

// Code-unit comparison, not localeCompare: the result must not depend on the
// user's locale or the browser's ICU data.
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function indexById<T extends FillTrack>(pool: T[]): Map<string, T> {
  const byId = new Map<string, T>()
  // First occurrence wins; duplicates are reported by validateStages.
  for (const t of pool) if (!byId.has(t.id)) byId.set(t.id, t)
  return byId
}

function pinnedOf(stage: StageSpec): string[] {
  return stage.pinnedTrackIds ?? []
}

export function validateStages(stages: StageSpec[], pool: FillTrack[]): StageProblem[] {
  const problems: StageProblem[] = []
  const byId = indexById(pool)

  const seenPool = new Set<string>()
  const reportedPool = new Set<string>()
  for (const t of pool) {
    if (seenPool.has(t.id) && !reportedPool.has(t.id)) {
      problems.push({ stageId: null, reason: 'duplicate-pool-id', blocking: true, trackId: t.id })
      reportedPool.add(t.id)
    }
    seenPool.add(t.id)
  }

  const seenStages = new Set<string>()
  const seenAnchors = new Set<string>()
  stages.forEach((stage, i) => {
    // Reported on every repeat after the first, so each offending row can be flagged.
    if (seenStages.has(stage.id)) {
      problems.push({ stageId: stage.id, reason: 'duplicate-stage-id', blocking: true })
    }
    seenStages.add(stage.id)

    if (!Number.isFinite(stage.durationMs) || stage.durationMs <= 0) {
      problems.push({ stageId: stage.id, reason: 'invalid-duration', blocking: true })
    }

    const anchor = byId.get(stage.anchorTrackId)
    if (!anchor) {
      problems.push({ stageId: stage.id, reason: 'anchor-missing', blocking: true })
    } else if (!hasBpm(anchor)) {
      problems.push({ stageId: stage.id, reason: 'anchor-no-bpm', blocking: true })
    }

    const pinned = pinnedOf(stage).map((id) => byId.get(id))
    if (pinned.some((t) => !t)) {
      problems.push({ stageId: stage.id, reason: 'pinned-missing', blocking: true })
    }
    if (pinned.some((t) => t && !hasBpm(t))) {
      problems.push({ stageId: stage.id, reason: 'pinned-no-bpm', blocking: true })
    }

    // A track may appear once across every anchor and pinned list; reported once per stage.
    let duplicate = false
    for (const id of [stage.anchorTrackId, ...pinnedOf(stage)]) {
      if (seenAnchors.has(id)) duplicate = true
      seenAnchors.add(id)
    }
    if (duplicate) problems.push({ stageId: stage.id, reason: 'duplicate-anchor', blocking: true })

    // Flagged on the later stage of the pair — that's the one that gets merged away.
    if (i > 0) {
      const prev = byId.get(stages[i - 1].anchorTrackId)
      if (anchor && prev && hasBpm(anchor) && hasBpm(prev) && anchor.bpm === prev.bpm) {
        problems.push({ stageId: stage.id, reason: 'equal-contiguous-anchors', blocking: false })
      }
    }
  })

  return problems
}

/**
 * Collapses each run of contiguous stages with equal anchor BPMs into one stage:
 * the first stage's ID and anchor, durations summed. The later stages' anchors
 * (and their own co-anchors) become the merged stage's co-anchors, in run
 * order. `merged` lists the stage IDs of each run that was collapsed, so F5
 * can tell the user.
 */
export function mergeEqualContiguous(
  stages: StageSpec[],
  pool: FillTrack[]
): { stages: StageSpec[]; merged: string[][] } {
  const byId = indexById(pool)
  const bpmOf = (stage: StageSpec): number | null => {
    const anchor = byId.get(stage.anchorTrackId)
    return anchor && hasBpm(anchor) ? anchor.bpm : null
  }

  const out: StageSpec[] = []
  const runs: string[][] = []
  for (const stage of stages) {
    const last = out[out.length - 1]
    const bpm = bpmOf(stage)
    if (last && bpm !== null && bpm === bpmOf(last)) {
      // `last` is always a copy we made below, so this doesn't touch the input.
      last.durationMs += stage.durationMs
      last.pinnedTrackIds = [...pinnedOf(last), stage.anchorTrackId, ...pinnedOf(stage)]
      runs[runs.length - 1].push(stage.id)
    } else {
      out.push({ ...stage })
      runs.push([stage.id])
    }
  }

  return { stages: out, merged: runs.filter((run) => run.length > 1) }
}

/** Bounds each stage by the midpoints to its run-order neighbours' anchors. */
function stageRange(centers: number[], i: number): [number, number] {
  let lower = -Infinity
  let upper = Infinity
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j >= centers.length) continue
    const mid = (centers[i] + centers[j]) / 2
    if (centers[j] > centers[i]) upper = Math.min(upper, mid)
    else if (centers[j] < centers[i]) lower = Math.max(lower, mid)
  }
  return [lower, upper]
}

function stageDirection(centers: number[], i: number): Direction {
  const c = centers[i]
  const hasPrev = i > 0
  const hasNext = i < centers.length - 1
  if (!hasPrev && !hasNext) return 'asc'
  // First stage heads towards the next anchor.
  if (!hasPrev) return centers[i + 1] > c ? 'asc' : 'desc'
  // Last stage keeps going the way the run was heading as it came in.
  if (!hasNext) return centers[i - 1] < c ? 'asc' : 'desc'
  if (centers[i - 1] < c) return centers[i + 1] > c ? 'asc' : 'peak'
  return centers[i + 1] > c ? 'valley' : 'desc'
}

// FNV-1a over the ID, keyed by the seed, then murmur3's finaliser to spread the
// bits. Hashing per track (rather than drawing from one RNG stream) makes a
// track's allocation independent of pool order and of every other track.
function hashUnit(seed: number, id: string): number {
  let h = 0x811c9dc5 ^ fmix32(seed | 0)
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (fmix32(h) >>> 0) / 0x100000000
}

function fmix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h
}

/**
 * Which of `eligibleCount` overlapping stages (in run order) a track is
 * allocated to for a given seed. Exported so tests can pick seeds on purpose.
 */
export function allocationIndex(seed: number, trackId: string, eligibleCount: number): number {
  return Math.floor(hashUnit(seed, trackId) * eligibleCount)
}

function byDistance<T extends FillTrack & { bpm: number }>(tracks: T[], center: number): T[] {
  return [...tracks].sort(
    (a, b) => Math.abs(a.bpm - center) - Math.abs(b.bpm - center) || compareIds(a.id, b.id)
  )
}

/**
 * Orders tracks for play. Tracks without a BPM (dragged in by hand in F6) sit
 * where a track at the center BPM would.
 */
function orderByDirection<T extends FillTrack>(tracks: T[], direction: Direction, center: number): T[] {
  const bpm = (t: T) => (hasBpm(t) ? t.bpm : center)
  const asc = [...tracks].sort((a, b) => bpm(a) - bpm(b) || compareIds(a.id, b.id))

  switch (direction) {
    case 'asc':
      return asc
    case 'desc':
      return [...tracks].sort((a, b) => bpm(b) - bpm(a) || compareIds(a.id, b.id))
    case 'peak':
    case 'valley': {
      // Deal alternately into two halves so both span the stage's whole range,
      // rather than putting all the slow tracks on one side.
      const even = asc.filter((_, i) => i % 2 === 0)
      const odd = asc.filter((_, i) => i % 2 === 1)
      return direction === 'peak' ? [...even, ...odd.reverse()] : [...even.reverse(), ...odd]
    }
  }
}

function buildStage<T extends FillTrack>(
  base: Pick<
    FilledStage<T>,
    'id' | 'anchorTrackId' | 'pinnedTrackIds' | 'targetMs' | 'centerBpm' | 'rangeBpm' | 'direction'
  >,
  tracks: T[]
): FilledStage<T> {
  let spreadBpm = MIN_SPREAD_BPM
  let totalMs = 0
  for (const t of tracks) {
    totalMs += t.durationMs
    // Measured from the anchor, not the range's midpoint: the anchor can sit
    // near one edge, so half the range would understate the spread.
    if (hasBpm(t)) spreadBpm = Math.max(spreadBpm, Math.abs(t.bpm - base.centerBpm))
  }
  return {
    ...base,
    pinnedTrackIds: [...base.pinnedTrackIds],
    rangeBpm: [base.rangeBpm[0], base.rangeBpm[1]],
    spreadBpm,
    tracks: orderByDirection(tracks, base.direction, base.centerBpm),
    totalMs,
    shortfallMs: Math.max(0, base.targetMs - totalMs),
  }
}

/**
 * Fills each stage with the nearest-BPM tracks from its range until it reaches
 * its target duration. Throws if validateStages reports anything — including
 * equal contiguous anchors, so callers run mergeEqualContiguous first.
 *
 * `seed` (an integer; only its low 32 bits count) decides which stage gets each
 * track that falls in more than one stage's range. Same input + same seed →
 * same output, whatever the order of `pool`. `unplaced` keeps `pool`'s order.
 */
export function fillStages<T extends FillTrack>(
  stages: StageSpec[],
  pool: T[],
  seed: number
): { stages: FilledStage<T>[]; unplaced: T[] } {
  const problems = validateStages(stages, pool)
  if (problems.length > 0) {
    const detail = problems.map((p) => `${p.stageId ?? p.trackId}: ${p.reason}`).join(', ')
    throw new Error(`fillStages: invalid stages (${detail})`)
  }

  const byId = indexById(pool)
  // Validation guarantees every anchor and pinned track exists and has a BPM.
  const anchors = stages.map((s) => byId.get(s.anchorTrackId) as T & { bpm: number })
  const pinned = stages.map((s) => pinnedOf(s).map((id) => byId.get(id) as T & { bpm: number }))
  const anchorIds = new Set(stages.flatMap((s) => [s.anchorTrackId, ...pinnedOf(s)]))
  const centers = anchors.map((a) => a.bpm)
  const ranges = stages.map((_, i) => stageRange(centers, i))

  // Allocate every non-anchor, non-pinned track with a BPM to one stage whose range holds it.
  const allocated: (T & { bpm: number })[][] = stages.map(() => [])
  const overlapEligible = new Map<string, number[]>()
  for (const t of pool) {
    if (anchorIds.has(t.id) || !hasBpm(t)) continue
    const eligible = ranges.flatMap((range, i) => (inRange(t.bpm, range) ? [i] : []))
    if (eligible.length === 0) continue
    allocated[eligible[allocationIndex(seed, t.id, eligible.length)]].push(t)
    if (eligible.length > 1) overlapEligible.set(t.id, eligible)
  }

  // Greedy fill: anchor and pinned tracks first, then nearest-to-anchor until
  // the target is met. Overshoot is at most the last track added.
  const chosen: T[][] = []
  const totals: number[] = []
  const placed = new Set<string>()
  stages.forEach((stage, i) => {
    const picked: T[] = [anchors[i], ...pinned[i]]
    let total = picked.reduce((sum, t) => sum + t.durationMs, 0)
    for (const t of byDistance(allocated[i], centers[i])) {
      if (total >= stage.durationMs) break
      picked.push(t)
      total += t.durationMs
    }
    picked.forEach((t) => placed.add(t.id))
    chosen.push(picked)
    totals.push(total)
  })

  // Rebalance: an overlap track its stage didn't need may go to another stage
  // covering it that is still short. Short stages take their turn in run order,
  // each taking the leftovers nearest its own anchor first.
  const leftovers = pool.filter(
    (t): t is T & { bpm: number } => hasBpm(t) && overlapEligible.has(t.id) && !placed.has(t.id)
  )
  stages.forEach((stage, i) => {
    if (totals[i] >= stage.durationMs) return
    const candidates = leftovers.filter((t) => !placed.has(t.id) && overlapEligible.get(t.id)!.includes(i))
    for (const t of byDistance(candidates, centers[i])) {
      if (totals[i] >= stage.durationMs) break
      chosen[i].push(t)
      totals[i] += t.durationMs
      placed.add(t.id)
    }
  })

  return {
    stages: stages.map((stage, i) =>
      buildStage(
        {
          id: stage.id,
          anchorTrackId: stage.anchorTrackId,
          pinnedTrackIds: pinnedOf(stage),
          targetMs: stage.durationMs,
          centerBpm: centers[i],
          rangeBpm: ranges[i],
          direction: stageDirection(centers, i),
        },
        chosen[i]
      )
    ),
    unplaced: pool.filter((t) => !placed.has(t.id)),
  }
}

/**
 * Rebuilds a stage after F6 moves tracks in or out: re-reads the center from
 * the anchor's current BPM, re-orders by the stage's (fixed) direction and
 * recomputes spread and totals. Range and direction are kept from the build.
 *
 * If the anchor has lost its BPM the previous center is kept — the stage
 * still needs a center to order around, and F6 never clears a real BPM.
 */
export function recomputeStage<T extends FillTrack>(stage: FilledStage<T>, tracks: T[]): FilledStage<T> {
  const anchor = tracks.find((t) => t.id === stage.anchorTrackId)
  if (!anchor) {
    throw new Error(`recomputeStage: anchor ${stage.anchorTrackId} missing from stage ${stage.id}`)
  }
  const missing = stage.pinnedTrackIds.find((id) => !tracks.some((t) => t.id === id))
  if (missing !== undefined) {
    throw new Error(`recomputeStage: pinned track ${missing} missing from stage ${stage.id}`)
  }
  return buildStage(
    {
      id: stage.id,
      anchorTrackId: stage.anchorTrackId,
      pinnedTrackIds: stage.pinnedTrackIds,
      targetMs: stage.targetMs,
      centerBpm: hasBpm(anchor) ? anchor.bpm : stage.centerBpm,
      rangeBpm: stage.rangeBpm,
      direction: stage.direction,
    },
    tracks
  )
}
