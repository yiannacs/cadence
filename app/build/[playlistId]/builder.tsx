'use client'

import Link from 'next/link'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { BpmSource } from '@/lib/bpm/types'
import { summarize } from '@/lib/resolution'
import type { Playlist, TrackWithBpm } from '@/lib/types'
import AnchorView from './anchor-view'
import ArrangeView from './arrange-view'
import ExportPanel from './export-panel'
import FillView from './fill-view'
import { useBuild } from './use-build'
import { useTrackList } from './use-track-list'

// Host for the whole build: the source playlist and its tracks, then the three
// views on top of them — Anchors (UX step 3), Fill and Arrange (UX step 5) —
// and export (UX step 6). Run state lives here, in useTrackList and useBuild,
// on the client.
export default function Builder({ playlist }: { playlist: Playlist }) {
  const list = useTrackList(playlist.id)
  const summary = summarize(list.tracks)
  const resolving = list.phase === 'resolving'

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 font-sans text-zinc-300">
      <header className="flex shrink-0 flex-col gap-3 px-6 pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-50">{playlist.name}</h1>
          <Link href="/build" className="shrink-0 text-sm text-zinc-500 hover:text-zinc-300">
            ← Playlists
          </Link>
        </div>

        {list.phase === 'loading' && <p className="text-zinc-500">Loading tracks…</p>}

        {list.phase === 'load-error' && (
          <p className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">
            {list.error}
          </p>
        )}

        {(list.phase === 'idle' || resolving) && (
          <div className="flex flex-col gap-2">
            <p className="text-zinc-50">
              {summary.withBpm} / {summary.total} tracks have a BPM
              {summary.misses > 0 && (
                <span className="text-zinc-500"> · {summary.misses} not found on GetSongBPM</span>
              )}
            </p>

            {resolving && (
              <div className="flex items-center gap-3 text-sm text-zinc-500">
                <progress
                  className="h-1.5 w-48 accent-[#1DB954]"
                  value={list.progress.done}
                  max={list.progress.total}
                />
                Looking up BPMs… {list.progress.done} / {list.progress.total}
              </div>
            )}

            {list.error && (
              <p className="rounded border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
                BPM lookups stopped: {list.error}
              </p>
            )}

            {!resolving && summary.pending > 0 && (
              <p className="text-sm text-zinc-500">
                {summary.pending} {summary.pending === 1 ? 'track has' : 'tracks have'} no BPM answer yet.{' '}
                <button type="button" onClick={list.retry} className="text-zinc-300 underline hover:text-zinc-50">
                  Retry
                </button>
              </p>
            )}
          </div>
        )}
      </header>

      {(list.phase === 'idle' || resolving) && (
        <Workspace
          playlist={playlist}
          tracks={list.tracks}
          failed={list.failed}
          resolving={resolving}
          onBpmChange={list.setBpm}
        />
      )}

      <footer className="mt-auto shrink-0 px-6 py-3 text-xs text-zinc-600">
        BPM data from{' '}
        <a href="https://getsongbpm.com" className="underline hover:text-zinc-400">
          GetSongBPM
        </a>
      </footer>
    </div>
  )
}

type View = 'anchors' | 'fill' | 'arrange'

const VIEWS: { id: View; label: string }[] = [
  { id: 'anchors', label: 'Anchors' },
  { id: 'fill', label: 'Fill' },
  { id: 'arrange', label: 'Arrange' },
]

// Mounted only once the tracks have loaded, so useBuild reads the drafts from
// localStorage on its first render.
function Workspace({
  playlist,
  tracks,
  failed,
  resolving,
  onBpmChange,
}: {
  playlist: Playlist
  tracks: TrackWithBpm[]
  failed: Record<string, string>
  resolving: boolean
  onBpmChange: (trackId: string, bpm: number | null, bpmSource: BpmSource | null) => void
}) {
  const run = useBuild({ playlist, tracks, onBpmChange })
  const { result } = run
  const [view, setView] = useState<View>('anchors')
  const tabs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({})
  const enabled = VIEWS.filter((v) => v.id === 'anchors' || result !== null).map((v) => v.id)

  function onBuild() {
    if (run.build()) setView('fill')
  }

  // Arrow keys move between the enabled tabs, as in the WAI-ARIA tabs pattern.
  function onTabKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = enabled[(enabled.indexOf(view) + step + enabled.length) % enabled.length]
    setView(next)
    tabs.current[next]?.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
      <div role="tablist" aria-label="Build views" className="flex shrink-0 gap-1 border-b border-zinc-800 px-6">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            ref={(el) => {
              tabs.current[v.id] = el
            }}
            type="button"
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls="build-view"
            tabIndex={view === v.id ? 0 : -1}
            disabled={!enabled.includes(v.id)}
            title={enabled.includes(v.id) ? undefined : 'Build first'}
            onClick={() => setView(v.id)}
            onKeyDown={onTabKey}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              view === v.id
                ? 'border-[#1DB954] text-zinc-50'
                : 'border-transparent text-zinc-400 enabled:hover:text-zinc-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view !== 'anchors' && result && (
        <div className="flex shrink-0 flex-col gap-2 px-6 empty:hidden">
          {run.stale && (
            <p className="rounded border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-400">
              The stages or BPMs changed since this build. Build again to update it.
            </p>
          )}
          {result.merged.map((merged) => (
            <p key={merged.join('|')} className="text-sm text-amber-300">
              Merged {merged.join(' + ')} into one stage: same tempo.
            </p>
          ))}
          {run.saveError && (
            <p className="rounded border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
              {run.saveError}
            </p>
          )}
        </div>
      )}

      {/* The rest of the viewport. Single-pane views scroll here; a two-pane
          view can take h-full and scroll its panes instead. */}
      <div
        id="build-view"
        role="tabpanel"
        aria-labelledby={`tab-${view}`}
        className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
      >
        {(view === 'anchors' || !result) && (
          <AnchorView
            playlist={playlist}
            tracks={tracks}
            failed={failed}
            resolving={resolving}
            stages={run.stages}
            dispatch={run.dispatch}
            problems={run.problems}
            buildable={run.buildable}
            built={result !== null}
            onBuild={onBuild}
          />
        )}
        {result && (
          // Hidden rather than unmounted on Anchors, so the export form keeps its state.
          <div hidden={view === 'anchors'} className="flex flex-col gap-6">
            {view === 'fill' && <FillView result={result} onMove={run.move} />}
            {view === 'arrange' && <ArrangeView result={result} onMove={run.move} />}
            <ExportPanel playlist={playlist} result={result} />
          </div>
        )}
      </div>
    </div>
  )
}
