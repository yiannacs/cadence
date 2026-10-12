'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
import {
  buildKey,
  canBuild,
  loadStages,
  newSeed,
  newStageId,
  problemMessage,
  runBuild,
  saveStages,
  stagesReducer,
  totalDurationMs,
  validateDrafts,
  type BuildResult,
} from '@/lib/stages'
import type { BuildState, Playlist, TrackWithBpm } from '@/lib/types'
import StageEditor from './stage-editor'
import StageRow from './stage-row'
import { formatDuration } from './track-table'

// UX step 3: stages in run order, each a duration and an anchor song, then
// Build; the result goes to the editor (UX step 5). Mounted only once the
// tracks have loaded — on the client, so the drafts can be read from
// localStorage on first render.
export default function StageBuilder({
  playlist,
  tracks,
  onBpmChange,
}: {
  playlist: Playlist
  tracks: TrackWithBpm[]
  // Records a BPM the editor set on the playlist's copy of a track.
  onBpmChange: (trackId: string, bpm: number | null, bpmSource: BpmSource | null) => void
}) {
  const [stages, dispatch] = useReducer(stagesReducer, playlist.id, loadStages)
  const [result, setResult] = useState<BuildResult | null>(null)
  // Why the last tempo guess couldn't be cached.
  const [saveError, setSaveError] = useState<string | null>(null)
  // Guesses are cached one at a time, in drop order, so the cache ends up with the last one.
  const saving = useRef<Promise<void>>(Promise.resolve())
  // The one stage whose anchor picker is open.
  const [picking, setPicking] = useState<string | null>(null)
  const build: BuildState = { playlist, tracks, stages, result }

  useEffect(() => saveStages(build.playlist.id, build.stages), [build.playlist.id, build.stages])

  const problems = useMemo(() => validateDrafts(stages, tracks), [stages, tracks])
  const buildable = canBuild(stages, problems)
  const unpicked = stages.filter((s) => s.anchorTrackId === null).length
  const general = problems.filter((p) => p.stageId === null)
  const stale = result !== null && result.key !== buildKey(stages, tracks)

  function onBuild() {
    if (result?.edited && !window.confirm('Building again replaces the changes you made to the result. Continue?')) {
      return
    }
    setPicking(null)
    setSaveError(null)
    setResult(runBuild(stages, tracks, newSeed()))
  }

  function onMove(trackId: string, to: Container) {
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

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-50">Stages</h2>
          <p className="text-sm text-zinc-500">
            In run order · run length{' '}
            <span className="text-zinc-300 tabular-nums">{formatDuration(totalDurationMs(stages))}</span>
          </p>
        </div>

        <ol className="flex flex-col gap-2">
          {stages.map((draft, i) => (
            <StageRow
              key={draft.id}
              draft={draft}
              index={i}
              stages={stages}
              tracks={tracks}
              problems={problems.filter((p) => p.stageId === draft.id)}
              pickerOpen={picking === draft.id}
              onTogglePicker={(open) => setPicking(open ? draft.id : null)}
              dispatch={dispatch}
            />
          ))}
        </ol>

        {general.map((p, i) => (
          <p key={`${p.reason}-${i}`} className="text-sm text-red-400">
            {problemMessage(p, undefined, tracks)}
          </p>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: 'add', id: newStageId() })}
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-50"
          >
            + Add stage
          </button>
          <button
            type="button"
            disabled={!buildable}
            onClick={onBuild}
            className="rounded bg-[#1DB954] px-4 py-1.5 text-sm font-semibold text-black hover:bg-[#1ed760] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {result ? 'Build again' : 'Build'}
          </button>
          {!buildable && (
            <span className="text-sm text-zinc-500">
              {stages.length === 0
                ? 'Add a stage to build.'
                : unpicked > 0
                  ? `Pick an anchor for ${unpicked === 1 ? '1 more stage' : `${unpicked} more stages`} to build.`
                  : 'Fix the problems above to build.'}
            </span>
          )}
          {buildable && result && (
            <span className="text-sm text-zinc-500">Each build re-rolls which stage gets songs that fit more than one.</span>
          )}
        </div>
      </section>

      {result && <StageEditor result={result} stale={stale} error={saveError} onMove={onMove} />}
    </>
  )
}
