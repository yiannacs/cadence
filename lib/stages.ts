import {
  fillStages,
  hasBpm,
  mergeEqualContiguous,
  validateStages,
  type Direction,
  type FilledStage,
  type StageProblem,
  type StageSpec,
} from './fill'
import type { TrackWithBpm } from './types'

// Client side of the stage builder (F5): the stages the user is drafting, the
// wording for F4's validation problems, the anchor picker's rules, and the
// Build step that turns drafts into a filled result. Pure apart from the
// storage and randomness helpers at the bottom; the builder page imports it.

export interface StageDraft {
  id: string
  name: string // optional; '' shows as "Stage n"
  durationMs: number // NaN while the duration field is empty or not a number
  anchorTrackId: string | null // null until the user picks one
}

// A filled build, as handed to the editor (F6) and export (F7).
export interface BuildResult {
  seed: number // re-running the same stages with this seed gives the same result
  stages: FilledStage<TrackWithBpm>[] // after merging equal contiguous anchors
  unplaced: TrackWithBpm[]
  labels: Record<string, string> // display name per result stage ID
  merged: string[][] // labels of each run of stages merged into one
  key: string // buildKey of the inputs, to tell when the stages changed since
  edited: boolean // set once the user moves a track (F6); rebuilding then asks first
}

const MINUTE_MS = 60_000

export const DEFAULT_STAGES: StageDraft[] = [
  { id: 'warmup', name: 'warmup', durationMs: 5 * MINUTE_MS, anchorTrackId: null },
  { id: 'build', name: 'build', durationMs: 10 * MINUTE_MS, anchorTrackId: null },
  { id: 'peak', name: 'peak', durationMs: 10 * MINUTE_MS, anchorTrackId: null },
  { id: 'cooldown', name: 'cooldown', durationMs: 5 * MINUTE_MS, anchorTrackId: null },
]

export function stageLabel(draft: StageDraft, index: number): string {
  return draft.name.trim() || `Stage ${index + 1}`
}

// ---- Drafts reducer ----

export type StagesAction =
  | { type: 'add'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; offset: -1 | 1 }
  | { type: 'rename'; id: string; name: string }
  | { type: 'set-duration'; id: string; durationMs: number }
  | { type: 'set-anchor'; id: string; trackId: string | null }

export function stagesReducer(state: StageDraft[], action: StagesAction): StageDraft[] {
  const update = (patch: Partial<StageDraft>) =>
    state.map((s) => (s.id === action.id ? { ...s, ...patch } : s))

  switch (action.type) {
    case 'add': {
      // A new stage starts at the last stage's duration — usually what the user wants next.
      const last = state[state.length - 1]
      const durationMs = last && Number.isFinite(last.durationMs) ? last.durationMs : 5 * MINUTE_MS
      return [...state, { id: action.id, name: '', durationMs, anchorTrackId: null }]
    }
    case 'remove':
      return state.filter((s) => s.id !== action.id)
    case 'move': {
      const from = state.findIndex((s) => s.id === action.id)
      const to = from + action.offset
      if (from < 0 || to < 0 || to >= state.length) return state
      const next = [...state]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    }
    case 'rename':
      return update({ name: action.name })
    case 'set-duration':
      return update({ durationMs: action.durationMs })
    case 'set-anchor': {
      // One song anchors one stage: picking it here takes it off any other stage.
      const trackId = action.trackId
      return state.map((s) =>
        s.id === action.id
          ? { ...s, anchorTrackId: trackId }
          : trackId !== null && s.anchorTrackId === trackId
            ? { ...s, anchorTrackId: null }
            : s
      )
    }
  }
}

/** Minutes typed into the duration field → ms; NaN when it isn't a number. */
export function minutesToMs(text: string): number {
  if (text.trim() === '') return NaN
  const minutes = Number(text)
  return Number.isFinite(minutes) ? Math.round(minutes * MINUTE_MS) : NaN
}

export function msToMinutes(ms: number): string {
  return Number.isFinite(ms) ? String(Math.round((ms / MINUTE_MS) * 100) / 100) : ''
}

/** Sum of the valid durations — the run length the user is planning. */
export function totalDurationMs(drafts: StageDraft[]): number {
  return drafts.reduce((sum, s) => (Number.isFinite(s.durationMs) && s.durationMs > 0 ? sum + s.durationMs : sum), 0)
}

// ---- Validation ----

export function toSpecs(drafts: StageDraft[]): StageSpec[] {
  // '' is never a track ID, so a missing anchor is reported as anchor-missing.
  return drafts.map((s) => ({ id: s.id, durationMs: s.durationMs, anchorTrackId: s.anchorTrackId ?? '' }))
}

/** F4's validateStages over the drafts, minus noise from stages with no anchor yet. */
export function validateDrafts(drafts: StageDraft[], tracks: TrackWithBpm[]): StageProblem[] {
  const unpicked = new Set(drafts.filter((s) => s.anchorTrackId === null).map((s) => s.id))
  // Every unpicked stage maps to '', which F4 would also see as one duplicated anchor.
  return validateStages(toSpecs(drafts), tracks).filter(
    (p) => !(p.reason === 'duplicate-anchor' && p.stageId !== null && unpicked.has(p.stageId))
  )
}

/** Build stays disabled while any of these remain; equal contiguous anchors are merged instead. */
export function canBuild(drafts: StageDraft[], problems: StageProblem[]): boolean {
  return drafts.length > 0 && !problems.some((p) => p.blocking)
}

/** User-facing wording for each of F4's problem codes. */
export function problemMessage(problem: StageProblem, draft: StageDraft | undefined, tracks: TrackWithBpm[]): string {
  switch (problem.reason) {
    case 'invalid-duration':
      return 'Set a duration longer than 0 minutes.'
    case 'anchor-missing':
      return draft?.anchorTrackId
        ? "The anchor song isn't in this playlist any more — pick another."
        : 'Pick an anchor song.'
    case 'anchor-no-bpm': {
      const anchor = tracks.find((t) => t.id === draft?.anchorTrackId)
      return anchor && anchor.bpmSource === null
        ? "Still looking up this song's BPM…"
        : "This song has no BPM, so it can't set the tempo — pick another."
    }
    case 'duplicate-anchor':
      return 'Another stage already uses this song as its anchor — pick another.'
    case 'equal-contiguous-anchors':
      return "Same tempo as the previous stage — they'll be merged into one."
    case 'duplicate-stage-id':
      return 'This stage is a duplicate — remove it and add a new one.'
    case 'duplicate-pool-id':
      return 'The playlist lists the same track twice — reload the page.'
  }
}

// ---- Anchor picker ----

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Tracks whose title or artists contain every word of `query`, case- and accent-insensitive. */
export function filterTracks<T extends TrackWithBpm>(tracks: T[], query: string): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return tracks
  return tracks.filter((t) => {
    const haystack = normalize(`${t.name} ${t.artists.join(' ')}`)
    return words.every((w) => haystack.includes(w))
  })
}

export interface AnchorOption {
  disabled: boolean
  hint: string | null // why it's disabled
}

/** Whether `track` can anchor stage `stageId`: it needs a BPM and mustn't anchor another stage. */
export function anchorOption(track: TrackWithBpm, stageId: string, drafts: StageDraft[]): AnchorOption {
  if (!hasBpm(track)) {
    return { disabled: true, hint: track.bpmSource === null ? 'BPM lookup pending' : "no BPM — can't anchor" }
  }
  const other = drafts.findIndex((s) => s.id !== stageId && s.anchorTrackId === track.id)
  if (other >= 0) return { disabled: true, hint: `anchors ${stageLabel(drafts[other], other)}` }
  return { disabled: false, hint: null }
}

// ---- Build ----

/**
 * Identifies the inputs of a build: the specs, the anchors' BPMs and how many
 * tracks have a BPM. A result whose key differs from the current one is stale.
 */
export function buildKey(drafts: StageDraft[], tracks: TrackWithBpm[]): string {
  const bpmById = new Map(tracks.map((t) => [t.id, t.bpm]))
  return JSON.stringify([
    drafts.map((s) => [s.id, s.durationMs, s.anchorTrackId, bpmById.get(s.anchorTrackId ?? '') ?? null]),
    tracks.filter(hasBpm).length,
  ])
}

/**
 * Merges contiguous stages with equal anchor BPMs, then fills. Throws (from
 * fillStages) if a blocking problem remains — check canBuild first.
 */
export function runBuild(drafts: StageDraft[], tracks: TrackWithBpm[], seed: number): BuildResult {
  const { stages: specs, merged } = mergeEqualContiguous(toSpecs(drafts), tracks)
  const filled = fillStages(specs, tracks, seed)

  const labelById = new Map(drafts.map((s, i) => [s.id, stageLabel(s, i)]))
  const label = (id: string) => labelById.get(id) ?? id
  const labels: Record<string, string> = {}
  for (const spec of specs) labels[spec.id] = label(spec.id)
  for (const run of merged) labels[run[0]] = run.map(label).join(' + ')

  return {
    seed,
    stages: filled.stages,
    unplaced: filled.unplaced,
    labels,
    merged: merged.map((run) => run.map(label)),
    key: buildKey(drafts, tracks),
    edited: false,
  }
}

// ---- Result display ----

export const DIRECTION_GLYPH: Record<Direction, string> = { asc: '↗', desc: '↘', peak: '⋀', valley: '⋁' }

export const DIRECTION_LABEL: Record<Direction, string> = {
  asc: 'rising',
  desc: 'falling',
  peak: 'up, then down',
  valley: 'down, then up',
}

function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 10) / 10)
}

/** A stage's (lower, upper] BPM range, e.g. "155–166", "≤ 155", "> 166". */
export function formatRange([lower, upper]: [number, number]): string {
  const hasLower = Number.isFinite(lower)
  const hasUpper = Number.isFinite(upper)
  if (hasLower && hasUpper) return `${formatBpm(lower)}–${formatBpm(upper)}`
  if (hasUpper) return `≤ ${formatBpm(upper)}`
  if (hasLower) return `> ${formatBpm(lower)}`
  return 'any'
}

// ---- Persistence and randomness (impure) ----

const STORAGE_VERSION = 1

function storageKey(playlistId: string): string {
  return `cadence:stages:${playlistId}`
}

/** Parses stored drafts; null when the value is missing or unusable. */
export function parseStoredStages(raw: string | null): StageDraft[] | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const { version, stages } = (data ?? {}) as Record<string, unknown>
  if (version !== STORAGE_VERSION || !Array.isArray(stages)) return null

  const out: StageDraft[] = []
  const ids = new Set<string>()
  for (const item of stages) {
    const { id, name, durationMs, anchorTrackId } = (item ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || !id || ids.has(id)) continue
    ids.add(id)
    out.push({
      id,
      name: typeof name === 'string' ? name : '',
      // JSON turns NaN into null; either way the field shows empty.
      durationMs: typeof durationMs === 'number' ? durationMs : NaN,
      anchorTrackId: typeof anchorTrackId === 'string' && anchorTrackId ? anchorTrackId : null,
    })
  }
  return out
}

/** The playlist's saved drafts, or the default template. Browser only. */
export function loadStages(playlistId: string): StageDraft[] {
  try {
    return parseStoredStages(window.localStorage.getItem(storageKey(playlistId))) ?? DEFAULT_STAGES
  } catch {
    return DEFAULT_STAGES
  }
}

export function saveStages(playlistId: string, drafts: StageDraft[]): void {
  try {
    window.localStorage.setItem(storageKey(playlistId), JSON.stringify({ version: STORAGE_VERSION, stages: drafts }))
  } catch {
    // Storage full or blocked: the stages just won't survive a refresh.
  }
}

export function newStageId(): string {
  return `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A fresh 32-bit seed for each Build, so overlap allocation re-rolls. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x100000000)
}
