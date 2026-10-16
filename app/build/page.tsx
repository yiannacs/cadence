import Link from 'next/link'
import { PlaylistList } from './playlist-list'
import { loadPlaylists } from './playlists'

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
          <PlaylistList playlists={result.playlists} />
        )}
      </main>
    </div>
  )
}
