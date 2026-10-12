'use client'

import Link from 'next/link'
import { summarize } from '@/lib/resolution'
import type { BuildState, Playlist } from '@/lib/types'
import TrackTable from './track-table'
import { useTrackList } from './use-track-list'

// Host for the whole build: the source playlist and its tracks now, the stage
// builder and editor later. Run state lives here, on the client.
export default function Builder({ playlist }: { playlist: Playlist }) {
  const list = useTrackList(playlist.id)
  const build: BuildState = { playlist, tracks: list.tracks }
  const summary = summarize(build.tracks)
  const resolving = list.phase === 'resolving'

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-300">
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
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
          <>
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

            <TrackTable tracks={build.tracks} failed={list.failed} resolving={resolving} />
          </>
        )}

        <footer className="text-xs text-zinc-600">
          BPM data from{' '}
          <a href="https://getsongbpm.com" className="underline hover:text-zinc-400">
            GetSongBPM
          </a>
        </footer>
      </main>
    </div>
  )
}
