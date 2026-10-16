import type { TrackWithBpm } from '@/lib/types'

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function SourceBadge({ track }: { track: TrackWithBpm }) {
  // A miss has a source ('api') but no value; it shows as unsourced.
  if (track.bpm === null || track.bpmSource === null) return <span className="text-zinc-600">—</span>
  return (
    <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">{track.bpmSource}</span>
  )
}
