'use client'

import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react'
import type { BpmSource } from '@/lib/bpm/types'
import {
  carryKey,
  locateTrack,
  moveTrack,
  postSynthetic,
  setResultTrackBpm,
  withTrackBpm,
  type Container,
  type SyntheticWrite,
} from '@/lib/editor'
import type { StageProblem } from '@/lib/fill'
import {
  buildKey,
  canBuild,
  loadStages,
  newSeed,
  runBuild,
  saveStages,
  stagesReducer,
  validateDrafts,
  type BuildResult,
  type StageDraft,
  type StagesAction,
} from '@/lib/stages'
import type { Playlist, TrackWithBpm } from '@/lib/types'

export interface Build {
  stages: StageDraft[]
  dispatch: Dispatch<StagesAction>
  problems: StageProblem[]
  buildable: boolean
  stale: boolean // the stages or BPMs changed since `result` was built
  result: BuildResult | null // null until the first Build
  saveError: string | null // why the last tempo guess couldn't be cached
  /** Runs a Build; false when the user kept their edited result instead. */
  build: () => boolean
  move: (trackId: string, to: Container) => void
}

// The run being built: stage drafts (UX step 3), the filled result and the
// editor's moves on it (UX step 5). Call it only once the tracks have loaded —
// on the client, so the drafts can be read from localStorage on first render.
export function useBuild({
  playlist,
  tracks,
  onBpmChange,
}: {
  playlist: Playlist
  tracks: TrackWithBpm[]
  // Records a BPM the editor set on the playlist's copy of a track.
  onBpmChange: (trackId: string, bpm: number | null, bpmSource: BpmSource | null) => void
}): Build {
  const [stages, dispatch] = useReducer(stagesReducer, playlist.id, loadStages)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Guesses are cached one at a time, in drop order, so the cache ends up with the last one.
  const saving = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => saveStages(playlist.id, stages), [playlist.id, stages])

  const problems = useMemo(() => validateDrafts(stages, tracks), [stages, tracks])
  const buildable = canBuild(stages, problems)
  const stale = result !== null && result.key !== buildKey(stages, tracks)

  function build(): boolean {
    if (result?.edited && !window.confirm('Building again replaces the changes you made to the result. Continue?')) {
      return false
    }
    setSaveError(null)
    setResult(runBuild(stages, tracks, newSeed()))
    return true
  }

  function move(trackId: string, to: Container) {
    if (!result) return
    const moved = moveTrack(result, trackId, to)
    if (moved.result === result) return
    const write = moved.synthetic
    if (!write) {
      setResult(moved.result)
      return
    }
    // The guess becomes the track's BPM everywhere at once, so the badge flips
    // to synthetic before the server answers and the next Build already uses it.
    const after = withTrackBpm(tracks, write.trackId, write.bpm, 'synthetic')
    setResult({ ...moved.result, key: carryKey(moved.result.key, stages, tracks, after) })
    onBpmChange(write.trackId, write.bpm, 'synthetic')
    saveGuess(write, locateTrack(result, trackId)?.track.name ?? 'this song')
  }

  function saveGuess(write: SyntheticWrite, name: string) {
    saving.current = saving.current.then(async () => {
      try {
        const stored = await postSynthetic(write)
        setSaveError(null)
        if (stored.bpmSource !== 'synthetic' || stored.bpm !== write.bpm) {
          // The cache already held a real BPM, which outranks the guess: use it here too.
          setResult((r) => r && setResultTrackBpm(r, write.trackId, stored.bpm, stored.bpmSource))
          onBpmChange(write.trackId, stored.bpm, stored.bpmSource)
        }
      } catch (err) {
        const reason = (err as Error).message.replace(/\.?$/, '.')
        setSaveError(
          `Couldn't save the tempo for “${name}”: ${reason} It's used in this build, but won't be remembered next time.`
        )
      }
    })
  }

  return { stages, dispatch, problems, buildable, stale, result, saveError, build, move }
}
