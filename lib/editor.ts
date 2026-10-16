import type { BpmSource } from './bpm/types'
import { hasBpm, recomputeStage } from './fill'
import { call } from './resolution'
import { buildKey, type BuildResult, type StageDraft } from './stages'
import type { TrackWithBpm } from './types'

// Client side of the stage editor (F6): moving tracks between a build's stages
// and its Unplaced bin, the synthetic BPM a no-BPM track takes on when it's
// dropped into a stage, and the wire contract of POST /api/bpm/synthetic.
// Pure apart from the fetch wrapper at the bottom; the builder page imports it.

// Where a track sits in a result: a stage's ID, or null for Unplaced.
export type Container = string | null

/** The track's container and current copy in `result`, or null when it isn't there. */
export function locateTrack(
  result: BuildResult,
  trackId: string
): { container: Container; track: TrackWithBpm } | null {
  for (const stage of result.stages) {
    const track = stage.tracks.find((t) => t.id === trackId)
    if (track) return { container: stage.id, track }
  }
  const track = result.unplaced.find((t) => t.id === trackId)
  return track ? { container: null, track } : null
}

export type MoveRefusal =
  | 'not-found' // no such track, or no such stage
  | 'same-container' // dropped where it already was
  | 'anchor' // an anchor or co-anchor never leaves its own stage

/** Why moving `trackId` to `to` would do nothing; null when the move is allowed. */
export function checkMove(result: BuildResult, trackId: string, to: Container): MoveRefusal | null {
  const at = locateTrack(result, trackId)
  if (!at) return 'not-found'
  if (to !== null && !result.stages.some((s) => s.id === to)) return 'not-found'
  if (at.container === to) return 'same-container'
  if (result.stages.some((s) => s.anchorTrackId === trackId || s.pinnedTrackIds.includes(trackId))) return 'anchor'
  return null
}

/**
 * True when dropping this track into a stage should give it the stage's
 * tempo as a synthetic BPM: it has none, or its current one is already a
 * guess. A real (api / manual) BPM is never replaced by a guess.
 */
export function takesSyntheticBpm(track: TrackWithBpm): boolean {
  return !hasBpm(track) || track.bpmSource === 'synthetic'
}

// Body of POST /api/bpm/synthetic: the guess to cache for one track.
export interface SyntheticWrite {
  trackId: string
  bpm: number // the stage's center BPM
  tolerance: number // the stage's BPM spread
}

/**
 * Moves a track to another stage or to Unplaced, re-ordering both stages by
 * their direction and recomputing their totals. A no-BPM (or synthetic) track
 * dropped into a stage takes the stage's center as a synthetic BPM first, so
 * it's ordered as if it had that tempo; `synthetic` is then the cache write to
 * send. Out-of-range drops are allowed — they're manual overrides.
 *
 * A refused move (see checkMove) returns `result` itself.
 */
export function moveTrack(
  result: BuildResult,
  trackId: string,
  to: Container
): { result: BuildResult; synthetic: SyntheticWrite | null } {
  if (checkMove(result, trackId, to) !== null) return { result, synthetic: null }
  const { container: from, track } = locateTrack(result, trackId)!
  const target = result.stages.find((s) => s.id === to)

  const moved: TrackWithBpm =
    target && takesSyntheticBpm(track) ? { ...track, bpm: target.centerBpm, bpmSource: 'synthetic' } : track

  const stages = result.stages.map((stage) => {
    if (stage.id === from) return recomputeStage(stage, stage.tracks.filter((t) => t.id !== trackId))
    if (stage.id === to) return recomputeStage(stage, [...stage.tracks, moved])
    return stage
  })
  const unplaced =
    from === null ? result.unplaced.filter((t) => t.id !== trackId) : to === null ? [...result.unplaced, moved] : result.unplaced

  const landed = stages.find((s) => s.id === to)
  const synthetic =
    landed && moved !== track ? { trackId, bpm: landed.centerBpm, tolerance: landed.spreadBpm } : null

  return { result: { ...result, stages, unplaced, edited: true }, synthetic }
}

/**
 * Sets a track's BPM wherever it sits in `result` and re-orders its stage —
 * for when the server stored something other than the guess that was sent
 * (the cache already had a real value). Not an edit by the user.
 */
export function setResultTrackBpm(
  result: BuildResult,
  trackId: string,
  bpm: number | null,
  bpmSource: BpmSource | null
): BuildResult {
  const at = locateTrack(result, trackId)
  if (!at || (at.track.bpm === bpm && at.track.bpmSource === bpmSource)) return result
  const swap = (t: TrackWithBpm) => (t.id === trackId ? { ...t, bpm, bpmSource } : t)
  if (at.container === null) return { ...result, unplaced: result.unplaced.map(swap) }
  return {
    ...result,
    stages: result.stages.map((s) => (s.id === at.container ? recomputeStage(s, s.tracks.map(swap)) : s)),
  }
}

/** The playlist's tracks with one track's BPM replaced. */
export function withTrackBpm(
  tracks: TrackWithBpm[],
  trackId: string,
  bpm: number | null,
  bpmSource: BpmSource | null
): TrackWithBpm[] {
  return tracks.map((t) => (t.id === trackId ? { ...t, bpm, bpmSource } : t))
}

/**
 * A result's key after the editor changed a BPM in the playlist too: a result
 * that was current stays current (it already reflects that BPM), a stale one
 * stays stale.
 */
export function carryKey(
  key: string,
  drafts: StageDraft[],
  before: TrackWithBpm[],
  after: TrackWithBpm[]
): string {
  return key === buildKey(drafts, before) ? buildKey(drafts, after) : key
}

/**
 * Display order of the Unplaced bin: tracks without a BPM first, in the order
 * they arrived, then the rest by BPM (ties by ID) so near-tempo candidates sit
 * together.
 */
export function orderUnplaced(tracks: TrackWithBpm[]): TrackWithBpm[] {
  const withBpm = tracks.filter(hasBpm)
  withBpm.sort((a, b) => a.bpm - b.bpm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...tracks.filter((t) => !hasBpm(t)), ...withBpm]
}

// ---- POST /api/bpm/synthetic ----

// Bounds on what the route accepts; generous for any real running tempo.
export const MAX_SYNTHETIC_BPM = 400
const TRACK_ID = /^[0-9A-Za-z]{1,64}$/

/** Validates a POST /api/bpm/synthetic body. Null when it's malformed or has extra keys. */
export function parseSyntheticWrite(body: unknown): SyntheticWrite | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const keys = Object.keys(body)
  if (keys.length !== 3 || !['trackId', 'bpm', 'tolerance'].every((k) => keys.includes(k))) return null
  const { trackId, bpm, tolerance } = body as Record<string, unknown>
  if (typeof trackId !== 'string' || !TRACK_ID.test(trackId)) return null
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0 || bpm > MAX_SYNTHETIC_BPM) return null
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > MAX_SYNTHETIC_BPM) {
    return null
  }
  return { trackId, bpm, tolerance }
}

// The entry the cache actually holds after the write: the guess, or the real
// value that outranked it.
export interface SyntheticResponse {
  bpm: number | null
  tolerance: number | null
  bpmSource: BpmSource
}

export function postSynthetic(write: SyntheticWrite): Promise<SyntheticResponse> {
  return call(
    '/api/bpm/synthetic',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(write) },
    'Saving the BPM guess'
  )
}
