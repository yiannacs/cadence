'use client'

import { useState } from 'react'
import { anchorOption, filterTracks, type StageDraft } from '@/lib/stages'
import type { TrackWithBpm } from '@/lib/types'

// Searchable list of the playlist's tracks for picking a stage's anchor. Leads
// with title and artist — the user picks by feel; the BPM is secondary.
export default function AnchorPicker({
  stageId,
  stages,
  tracks,
  selectedId,
  onPick,
  onClose,
}: {
  stageId: string
  stages: StageDraft[]
  tracks: TrackWithBpm[]
  selectedId: string | null
  onPick: (trackId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const matches = filterTracks(tracks, query)

  return (
    <div
      className="flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <input
        type="search"
        // Opened by an explicit click, so moving focus here is expected.
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or artist"
        aria-label="Search songs"
        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      {matches.length === 0 ? (
        <p className="px-2 py-1 text-sm text-zinc-500">No songs match.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto">
          {matches.map((t) => {
            const { disabled, hint } = anchorOption(t, stageId, stages)
            const selected = t.id === selectedId
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(t.id)}
                  className={`flex w-full items-baseline gap-3 rounded px-2 py-1 text-left text-sm ${
                    selected ? 'bg-zinc-800' : ''
                  } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-zinc-800'}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-zinc-50">{t.name}</span>
                    <span className="text-zinc-500"> · {t.artists.join(', ')}</span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                    {hint ?? `${Math.round(t.bpm as number)} BPM`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
