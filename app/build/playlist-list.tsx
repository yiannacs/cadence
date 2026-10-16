'use client'

import Link from 'next/link'
import { useState } from 'react'
import { matchesQuery } from '@/lib/search'
import type { PlaylistSummary } from '@/lib/spotify/api'

function Cover({ url }: { url: string | null }) {
  if (!url) return <div className="h-12 w-12 shrink-0 rounded bg-zinc-800" />
  // Spotify image URLs come from several CDNs and expire within a day, so
  // next/image's optimiser (and its remotePatterns allowlist) buys nothing.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
}

function trackCountLabel(count: number | null): string {
  if (count === null) return ''
  return count === 1 ? '1 track' : `${count} tracks`
}

function Row({ playlist }: { playlist: PlaylistSummary }) {
  const body = (
    <>
      <Cover url={playlist.imageUrl} />
      <div className="min-w-0">
        <p className="truncate text-zinc-50">{playlist.name}</p>
        <p className="text-sm text-zinc-500">{trackCountLabel(playlist.trackCount)}</p>
      </div>
    </>
  )
  if (!playlist.isOwn) {
    return (
      <li className="flex items-center gap-3 rounded px-3 py-2 opacity-40">
        {body}
      </li>
    )
  }
  return (
    <li>
      <Link
        href={`/build/${encodeURIComponent(playlist.id)}`}
        className="flex items-center gap-3 rounded px-3 py-2 transition-colors hover:bg-zinc-900"
      >
        {body}
      </Link>
    </li>
  )
}

/** The playlist picker's list, filtered by name as the user types. */
export function PlaylistList({ playlists }: { playlists: PlaylistSummary[] }) {
  const [query, setQuery] = useState('')
  const shown = playlists.filter((p) => matchesQuery(p.name, query))
  const own = shown.filter((p) => p.isOwn)
  const others = shown.filter((p) => !p.isOwn)

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
        }}
        autoFocus
        placeholder="Search playlists"
        aria-label="Search playlists"
        className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      {shown.length === 0 ? (
        <p className="text-zinc-500">No playlists match.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {own.map((p) => (
              <Row key={p.id} playlist={p} />
            ))}
          </ul>
          {others.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-sm text-zinc-500">Spotify only lets this app read playlists you own.</p>
              <ul className="flex flex-col gap-1">
                {others.map((p) => (
                  <Row key={p.id} playlist={p} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}
