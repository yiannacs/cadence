'use client'

import { useEffect, useMemo, useReducer, useState } from 'react'
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
import StageResults from './stage-results'
import StageRow from './stage-row'
import { formatDuration } from './track-table'

// UX step 3: stages in run order, each a duration and an anchor song, then
// Build. Mounted only once the tracks have loaded — on the client, so the
// drafts can be read from localStorage on first render.
export default function StageBuilder({ playlist, tracks }: { playlist: Playlist; tracks: TrackWithBpm[] }) {
  const [stages, dispatch] = useReducer(stagesReducer, playlist.id, loadStages)
  const [result, setResult] = useState<BuildResult | null>(null)
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
    setResult(runBuild(stages, tracks, newSeed()))
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

      {result && <StageResults result={result} stale={stale} />}
    </>
  )
}
