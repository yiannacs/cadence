'use client'

import { useState, type Dispatch } from 'react'
import type { StageProblem } from '@/lib/fill'
import {
  minutesToMs,
  msToMinutes,
  problemMessage,
  stageLabel,
  type StageDraft,
  type StagesAction,
} from '@/lib/stages'
import type { TrackWithBpm } from '@/lib/types'
import AnchorPicker from './anchor-picker'

// Keeps its own text so half-typed values ("", "2.") survive; the stage gets
// the parsed ms (NaN while the field isn't a number, which validation flags).
function DurationInput({ durationMs, onChange }: { durationMs: number; onChange: (ms: number) => void }) {
  const [text, setText] = useState(() => msToMinutes(durationMs))
  return (
    <label className="flex shrink-0 items-baseline gap-1.5 text-sm text-zinc-500">
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(minutesToMs(e.target.value))
        }}
        aria-label="Duration in minutes"
        className="w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-zinc-50 tabular-nums focus:border-zinc-500 focus:outline-none"
      />
      min
    </label>
  )
}

const iconButton =
  'rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30'

export default function StageRow({
  draft,
  index,
  stages,
  tracks,
  problems,
  pickerOpen,
  onTogglePicker,
  dispatch,
}: {
  draft: StageDraft
  index: number
  stages: StageDraft[]
  tracks: TrackWithBpm[]
  problems: StageProblem[]
  pickerOpen: boolean
  onTogglePicker: (open: boolean) => void
  dispatch: Dispatch<StagesAction>
}) {
  const anchor = draft.anchorTrackId === null ? undefined : tracks.find((t) => t.id === draft.anchorTrackId)
  // An unpicked anchor already reads as a prompt on the anchor button.
  const shown = problems.filter((p) => !(p.reason === 'anchor-missing' && draft.anchorTrackId === null))

  return (
    <li className="flex flex-col gap-2 rounded border border-zinc-800 px-3 py-3">
      <div className="flex items-center gap-3">
        <span className="w-5 shrink-0 text-right text-sm text-zinc-600 tabular-nums">{index + 1}</span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => dispatch({ type: 'rename', id: draft.id, name: e.target.value })}
          placeholder={stageLabel({ ...draft, name: '' }, index)}
          aria-label="Stage name"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-zinc-50 placeholder:text-zinc-600 hover:border-zinc-800 focus:border-zinc-500 focus:outline-none"
        />
        <DurationInput
          durationMs={draft.durationMs}
          onChange={(durationMs) => dispatch({ type: 'set-duration', id: draft.id, durationMs })}
        />
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className={iconButton}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'move', id: draft.id, offset: -1 })}
            aria-label="Move earlier in the run"
            title="Move earlier in the run"
          >
            ↑
          </button>
          <button
            type="button"
            className={iconButton}
            disabled={index === stages.length - 1}
            onClick={() => dispatch({ type: 'move', id: draft.id, offset: 1 })}
            aria-label="Move later in the run"
            title="Move later in the run"
          >
            ↓
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={() => dispatch({ type: 'remove', id: draft.id })}
            aria-label="Remove stage"
            title="Remove stage"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex items-baseline gap-3 pl-8 text-sm">
        <span className="shrink-0 text-zinc-500">Anchor</span>
        <button
          type="button"
          onClick={() => onTogglePicker(!pickerOpen)}
          aria-expanded={pickerOpen}
          className="min-w-0 truncate rounded px-2 py-0.5 text-left hover:bg-zinc-900"
        >
          {anchor ? (
            <>
              <span className="text-zinc-50">{anchor.name}</span>
              <span className="text-zinc-500"> · {anchor.artists.join(', ')}</span>
            </>
          ) : draft.anchorTrackId ? (
            <span className="text-zinc-500">Unknown song</span>
          ) : (
            <span className="text-zinc-500 underline">Pick a song that feels right…</span>
          )}
        </button>
        {anchor?.bpm != null && (
          <span className="shrink-0 text-xs text-zinc-600 tabular-nums">{Math.round(anchor.bpm)} BPM</span>
        )}
      </div>

      {pickerOpen && (
        <div className="pl-8">
          <AnchorPicker
            stageId={draft.id}
            stages={stages}
            tracks={tracks}
            selectedId={draft.anchorTrackId}
            onPick={(trackId) => {
              dispatch({ type: 'set-anchor', id: draft.id, trackId })
              onTogglePicker(false)
            }}
            onClose={() => onTogglePicker(false)}
          />
        </div>
      )}

      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-8 text-sm">
          {shown.map((p, i) => (
            <li key={`${p.reason}-${i}`} className={p.blocking ? 'text-red-400' : 'text-amber-300'}>
              {problemMessage(p, draft, tracks)}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
