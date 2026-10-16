'use client'

import { useState, type Dispatch } from 'react'
import type { StageProblem } from '@/lib/fill'
import {
  newStageId,
  problemMessage,
  totalDurationMs,
  type StageDraft,
  type StagesAction,
} from '@/lib/stages'
import type { Playlist, TrackWithBpm } from '@/lib/types'
import { formatDuration } from './format'
import StageRow from './stage-row'
import TrackTable from './track-table'

// UX step 3: stages in run order, each a duration and an anchor song, then
// Build. The playlist's tracks are listed below.
export default function AnchorView({
  tracks,
  failed,
  resolving,
  stages,
  dispatch,
  problems,
  buildable,
  built,
  onBuild,
}: {
  playlist: Playlist
  tracks: TrackWithBpm[]
  failed: Record<string, string> // lookup error per track ID
  resolving: boolean
  stages: StageDraft[]
  dispatch: Dispatch<StagesAction>
  problems: StageProblem[]
  buildable: boolean
  built: boolean // a result exists, so Build replaces it
  onBuild: () => void
}) {
  // The one stage whose anchor picker is open.
  const [picking, setPicking] = useState<string | null>(null)
  const unpicked = stages.filter((s) => s.anchorTrackId === null).length
  const general = problems.filter((p) => p.stageId === null)

  return (
    <div className="flex flex-col gap-6">
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
            onClick={() => {
              setPicking(null)
              onBuild()
            }}
            className="rounded bg-[#1DB954] px-4 py-1.5 text-sm font-semibold text-black hover:bg-[#1ed760] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {built ? 'Build again' : 'Build'}
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
          {buildable && built && (
            <span className="text-sm text-zinc-500">Each build re-rolls which stage gets songs that fit more than one.</span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-50">Tracks</h2>
        <TrackTable tracks={tracks} failed={failed} resolving={resolving} />
      </section>
    </div>
  )
}
