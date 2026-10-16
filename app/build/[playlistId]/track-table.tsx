import type { TrackWithBpm } from '@/lib/types'
import { SourceBadge, formatDuration } from './format'

function BpmCell({ track, error, resolving }: { track: TrackWithBpm; error?: string; resolving: boolean }) {
  if (track.bpm !== null) return <>{Math.round(track.bpm)}</>
  if (track.bpmSource !== null) return <span className="text-zinc-600">—</span>
  if (error) {
    return (
      <span className="text-amber-400" title={error}>
        error
      </span>
    )
  }
  return <span className="text-zinc-600">{resolving ? '…' : '—'}</span>
}

export default function TrackTable({
  tracks,
  failed,
  resolving,
}: {
  tracks: TrackWithBpm[]
  failed: Record<string, string>
  resolving: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-4 font-normal">Title</th>
            <th className="py-2 pr-4 font-normal">Artist</th>
            <th className="py-2 pr-4 text-right font-normal">Time</th>
            <th className="py-2 pr-4 text-right font-normal">BPM</th>
            <th className="py-2 font-normal">Source</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr key={t.id} className="border-b border-zinc-900">
              <td className="max-w-64 truncate py-1.5 pr-4 text-zinc-50">{t.name}</td>
              <td className="max-w-48 truncate py-1.5 pr-4">{t.artists.join(', ')}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{formatDuration(t.durationMs)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">
                <BpmCell track={t} error={failed[t.id]} resolving={resolving} />
              </td>
              <td className="py-1.5">
                <SourceBadge track={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
