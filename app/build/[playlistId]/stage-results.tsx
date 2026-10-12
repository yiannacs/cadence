import { hasBpm, type FilledStage } from '@/lib/fill'
import { DIRECTION_GLYPH, DIRECTION_LABEL, formatRange, type BuildResult } from '@/lib/stages'
import type { TrackWithBpm } from '@/lib/types'
import { formatDuration } from './track-table'

// Read-only view of a filled build. The drag-and-drop editor (F6) takes over
// from here, working on the same BuildResult.

function StageSummary({ stage, label }: { stage: FilledStage<TrackWithBpm>; label: string }) {
  return (
    <li className="flex flex-col gap-2 rounded border border-zinc-800 px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-medium text-zinc-50">
          <span className="mr-2 text-zinc-400" title={DIRECTION_LABEL[stage.direction]}>
            {DIRECTION_GLYPH[stage.direction]}
          </span>
          {label}
        </h3>
        <p className="text-sm text-zinc-500 tabular-nums">
          {Math.round(stage.centerBpm)} BPM · range {formatRange(stage.rangeBpm)} · {stage.tracks.length}{' '}
          {stage.tracks.length === 1 ? 'track' : 'tracks'} · {formatDuration(stage.totalMs)} /{' '}
          {formatDuration(stage.targetMs)}
        </p>
      </div>

      {stage.shortfallMs > 0 && (
        <p className="text-sm text-amber-300">
          {formatDuration(stage.shortfallMs)} short — the playlist doesn&apos;t have enough songs in this tempo range.
        </p>
      )}

      <ol className="text-sm">
        {stage.tracks.map((t) => (
          <li key={t.id} className="flex items-baseline gap-3 py-0.5">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-zinc-50">{t.name}</span>
              <span className="text-zinc-500"> · {t.artists.join(', ')}</span>
              {t.id === stage.anchorTrackId && (
                <span className="ml-2 rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">anchor</span>
              )}
            </span>
            <span className="shrink-0 text-zinc-500 tabular-nums">{formatDuration(t.durationMs)}</span>
            <span className="w-10 shrink-0 text-right text-zinc-400 tabular-nums">
              {hasBpm(t) ? Math.round(t.bpm) : '—'}
            </span>
          </li>
        ))}
      </ol>
    </li>
  )
}

export default function StageResults({ result, stale }: { result: BuildResult; stale: boolean }) {
  const totalMs = result.stages.reduce((sum, s) => sum + s.totalMs, 0)
  const targetMs = result.stages.reduce((sum, s) => sum + s.targetMs, 0)
  const noBpm = result.unplaced.filter((t) => !hasBpm(t)).length

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-50">Result</h2>
        <p className="text-sm text-zinc-500 tabular-nums">
          {formatDuration(totalMs)} of music for a {formatDuration(targetMs)} run
        </p>
      </div>

      {stale && (
        <p className="rounded border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-400">
          The stages or BPMs changed since this build. Build again to update it.
        </p>
      )}

      {result.merged.map((run) => (
        <p key={run.join('|')} className="text-sm text-amber-300">
          Merged {run.join(' + ')} into one stage: same tempo.
        </p>
      ))}

      <ol className="flex flex-col gap-2">
        {result.stages.map((stage) => (
          <StageSummary key={stage.id} stage={stage} label={result.labels[stage.id] ?? stage.id} />
        ))}
      </ol>

      {result.unplaced.length > 0 && (
        <p className="text-sm text-zinc-500">
          {result.unplaced.length} {result.unplaced.length === 1 ? 'track' : 'tracks'} not placed
          {noBpm > 0 && ` (${noBpm} without a BPM)`}.
        </p>
      )}
    </section>
  )
}
