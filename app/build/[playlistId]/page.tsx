import Link from 'next/link'
import { loadPlaylist } from '../playlists'
import Builder from './builder'

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-300">
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
        <p className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          {children}
        </p>
        <Link href="/build" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to playlists
        </Link>
      </main>
    </div>
  )
}

export default async function BuildPage({ params }: PageProps<'/build/[playlistId]'>) {
  const { playlistId } = await params
  const result = await loadPlaylist(playlistId)
  if (!result.ok) return <Notice>{result.message}</Notice>

  const { readable, ...playlist } = result.playlist
  if (!readable) {
    return <Notice>Spotify only lets this app read playlists you own.</Notice>
  }

  // Keyed so switching playlists starts from a fresh track list.
  return <Builder key={playlist.id} playlist={playlist} />
}
