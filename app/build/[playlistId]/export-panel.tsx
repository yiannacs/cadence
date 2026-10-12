'use client'

import { useRef, useState } from 'react'
import {
  MAX_NAME_LENGTH,
  buildExportRequest,
  defaultPlaylistName,
  exportTotals,
  postExport,
  type ExportResult,
} from '@/lib/export'
import type { BuildResult } from '@/lib/stages'
import type { Playlist } from '@/lib/types'
import { formatDuration } from './track-table'

function sentence(message: string): string {
  return message.replace(/\.?$/, '.')
}

// UX step 6: saves the result as shown — stage 1 in play order, then stage 2,
// … — as one new playlist on the user's profile. Unplaced tracks stay out.
export default function ExportPanel({ playlist, result }: { playlist: Playlist; result: BuildResult }) {
  const [name, setName] = useState(() => defaultPlaylistName(playlist.name, new Date()))
  const [isPublic, setIsPublic] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [outcome, setOutcome] = useState<ExportResult | null>(null)
  // State updates land after the next render; the ref stops a fast double-click
  // from sending two requests (and creating two playlists) before then.
  const inFlight = useRef(false)

  const totals = exportTotals(result)
  const named = name.trim().length > 0
  const canExport = !exporting && totals.tracks > 0 && named

  async function onExport() {
    const req = buildExportRequest(result, name, isPublic)
    if (!req || inFlight.current) return
    inFlight.current = true
    setExporting(true)
    setOutcome(null)
    try {
      setOutcome(await postExport(req))
    } finally {
      inFlight.current = false
      setExporting(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-50">Export</h2>
        <p className="text-sm text-zinc-500 tabular-nums">
          {totals.tracks} {totals.tracks === 1 ? 'track' : 'tracks'} ·{' '}
          <span className="text-zinc-300">{formatDuration(totals.durationMs)}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded border border-zinc-800 px-3 py-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Playlist name</span>
          <input
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            disabled={exporting}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-50 focus:border-[#1DB954] focus:outline-none disabled:opacity-60"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            disabled={exporting}
            className="accent-[#1DB954]"
          />
          Public
          <span className="text-zinc-500">· shown on your Spotify profile; private if unchecked</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canExport}
            onClick={onExport}
            className="rounded bg-[#1DB954] px-4 py-1.5 text-sm font-semibold text-black hover:bg-[#1ed760] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : outcome?.status === 'done' ? 'Export again' : 'Export to Spotify'}
          </button>
          <span className="text-sm text-zinc-500">
            {totals.tracks === 0
              ? 'Every stage is empty — drag songs into a stage to export them.'
              : !named
                ? 'Give the playlist a name.'
                : outcome?.status === 'done'
                  ? 'Exporting again creates another playlist.'
                  : 'Creates a new playlist in exactly this order. Unplaced songs are left out.'}
          </span>
        </div>
      </div>

      {outcome?.status === 'done' && (
        <p className="rounded border border-[#1DB954]/40 bg-[#1DB954]/10 px-4 py-3 text-sm text-zinc-300">
          Saved {outcome.added} {outcome.added === 1 ? 'track' : 'tracks'} to Spotify.{' '}
          <a
            href={outcome.playlist.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#1DB954] underline hover:text-[#1ed760]"
          >
            Open the playlist ↗
          </a>
        </p>
      )}

      {outcome?.status === 'partial' && (
        <p className="rounded border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          The playlist was created, but only the first {outcome.added} of {outcome.total} tracks were added:{' '}
          {sentence(outcome.message)}{' '}
          <a href={outcome.playlist.url} target="_blank" rel="noreferrer" className="underline hover:text-amber-200">
            Open it in Spotify ↗
          </a>{' '}
          to delete it before exporting again, or keep it as it is.
        </p>
      )}

      {outcome?.status === 'failed' && (
        <p className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          Export failed: {sentence(outcome.message)}
        </p>
      )}
    </section>
  )
}
