import Link from 'next/link'
import type { PlaylistSummary } from '@/lib/spotify/api'
import { loadPlaylists } from './playlists'

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

export default async function PickPlaylist() {
  const result = await loadPlaylists()

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-300">
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Pick a source playlist</h1>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
            cadence
          </Link>
        </div>

        {!result.ok ? (
          <p className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">
            {result.message}
          </p>
        ) : result.playlists.length === 0 ? (
          <p className="text-zinc-500">No playlists in your library yet. Create one in Spotify, then reload.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {result.playlists
                .filter((p) => p.isOwn)
                .map((p) => (
                  <Row key={p.id} playlist={p} />
                ))}
            </ul>
            {result.playlists.some((p) => !p.isOwn) && (
              <section className="flex flex-col gap-2">
                <p className="text-sm text-zinc-500">
                  Spotify only lets this app read playlists you own.
                </p>
                <ul className="flex flex-col gap-1">
                  {result.playlists
                    .filter((p) => !p.isOwn)
                    .map((p) => (
                      <Row key={p.id} playlist={p} />
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
