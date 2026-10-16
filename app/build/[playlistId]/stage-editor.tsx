'use client'

import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { checkMove, locateTrack, orderUnplaced, type Container } from '@/lib/editor'
import { hasBpm, inRange, type FilledStage } from '@/lib/fill'
import { DIRECTION_GLYPH, DIRECTION_LABEL, formatRange, type BuildResult } from '@/lib/stages'
import type { TrackWithBpm } from '@/lib/types'
import {
  DraggableTrack,
  DropZone,
  TrackRow,
  UNPLACED,
  collisionDetection,
  containerStepper,
  droppableId,
  containerOf,
  trackAnnouncements,
  trackBadge,
  type DropHint,
} from './dnd'
import { formatDuration } from './format'

// UX step 5: the filled build as one drop target per stage plus an Unplaced
// bin. Any track can be dragged between them (anchors and co-anchors stay in
// their stage); each stage re-orders itself by its direction after a drop, so
// there's no ordering within a stage here. The move logic lives in lib/editor.ts.

function StageBox({ stage, label, hint }: { stage: FilledStage<TrackWithBpm>; label: string; hint: DropHint }) {
  return (
    <DropZone container={stage.id} hint={hint}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-medium text-zinc-50">
          <span className="mr-2 text-zinc-400" title={DIRECTION_LABEL[stage.direction]}>
            {DIRECTION_GLYPH[stage.direction]}
          </span>
          {label}
        </h3>
        <p className="text-sm text-zinc-500 tabular-nums">
          {Math.round(stage.centerBpm)} BPM · range {formatRange(stage.rangeBpm)} · {stage.tracks.length}{' '}
          {stage.tracks.length === 1 ? 'track' : 'tracks'} ·{' '}
          <span className={stage.shortfallMs > 0 ? 'text-amber-300' : 'text-zinc-300'}>
            {formatDuration(stage.totalMs)}
          </span>{' '}
          / {formatDuration(stage.targetMs)}
        </p>
      </div>

      {stage.shortfallMs > 0 && (
        <p className="text-sm text-amber-300">{formatDuration(stage.shortfallMs)} short of the target.</p>
      )}
      {hint === 'refused' && <p className="text-sm text-red-400">Anchors stay in their stage.</p>}

      <ol>
        {stage.tracks.map((t) => {
          const badge =
            t.id === stage.anchorTrackId ? 'anchor' : stage.pinnedTrackIds.includes(t.id) ? 'co-anchor' : undefined
          return (
            <DraggableTrack
              key={t.id}
              track={t}
              container={stage.id}
              badge={badge}
              outOfRange={badge === undefined && hasBpm(t) && !inRange(t.bpm, stage.rangeBpm)}
            />
          )
        })}
      </ol>
    </DropZone>
  )
}

function UnplacedBox({ tracks, hint }: { tracks: TrackWithBpm[]; hint: DropHint }) {
  const noBpm = tracks.filter((t) => !hasBpm(t)).length
  return (
    <DropZone container={null} hint={hint}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-medium text-zinc-50">Unplaced</h3>
        <p className="text-sm text-zinc-500 tabular-nums">
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          {noBpm > 0 && ` · ${noBpm} without a BPM`} · not exported
        </p>
      </div>
      {noBpm > 0 && (
        <p className="text-sm text-zinc-500">
          Drop a song without a BPM into a stage to give it that stage&apos;s tempo — it&apos;s remembered for the
          next build.
        </p>
      )}
      {hint === 'refused' && <p className="text-sm text-red-400">Anchors stay in their stage.</p>}
      {tracks.length === 0 ? (
        <p className="text-sm text-zinc-600">Every song is in a stage.</p>
      ) : (
        <ol>
          {tracks.map((t) => (
            <DraggableTrack key={t.id} track={t} container={null} />
          ))}
        </ol>
      )}
    </DropZone>
  )
}

export default function StageEditor({
  result,
  onMove,
}: {
  result: BuildResult
  onMove: (trackId: string, to: Container) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const order = useMemo(() => [...result.stages.map((s) => droppableId(s.id)), UNPLACED], [result.stages])
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so the handle still takes focus on click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: containerStepper(order) })
  )

  const totalMs = result.stages.reduce((sum, s) => sum + s.totalMs, 0)
  const targetMs = result.stages.reduce((sum, s) => sum + s.targetMs, 0)
  const unplaced = orderUnplaced(result.unplaced)
  const active = activeId === null ? null : locateTrack(result, activeId)

  const label = (container: Container) => (container === null ? 'Unplaced' : (result.labels[container] ?? container))

  function hintFor(container: Container): DropHint {
    if (activeId === null || overId !== droppableId(container)) return null
    const why = checkMove(result, activeId, containerOf(overId))
    return why === null ? 'allowed' : why === 'anchor' ? 'refused' : null
  }

  const announcements = trackAnnouncements(result, label)

  function reset() {
    setActiveId(null)
    setOverId(null)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-50">Result</h2>
        <p className="text-sm text-zinc-500 tabular-nums">
          {formatDuration(totalMs)} of music for a {formatDuration(targetMs)} run
        </p>
      </div>

      <p className="text-sm text-zinc-500">
        Drag songs between stages by their ⠿ handle (or focus it, press Space, use the arrow keys, Space again). Each
        stage re-orders itself by its direction.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To move a song, press Space or Enter. Use the arrow keys to go to another stage, Space or Enter to drop it there, or Escape to cancel.',
          },
        }}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
        onDragEnd={({ active, over }) => {
          reset()
          if (over) onMove(String(active.id), containerOf(over.id))
        }}
        onDragCancel={reset}
      >
        <ol className="flex flex-col gap-2">
          {result.stages.map((stage) => (
            <StageBox
              key={stage.id}
              stage={stage}
              label={result.labels[stage.id] ?? stage.id}
              hint={hintFor(stage.id)}
            />
          ))}
          <UnplacedBox tracks={unplaced} hint={hintFor(null)} />
        </ol>

        <DragOverlay>
          {active && (
            <div className="rounded border border-zinc-700 bg-zinc-900 px-3 shadow-lg">
              <TrackRow
                track={active.track}
                badge={trackBadge(result, active.track.id)}
                outOfRange={false}
                handle={<span className="shrink-0 px-1 text-zinc-300">⠿</span>}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  )
}
