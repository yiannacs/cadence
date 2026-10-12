'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { checkMove, locateTrack, orderUnplaced, type Container, type MoveRefusal } from '@/lib/editor'
import { hasBpm, inRange, type FilledStage } from '@/lib/fill'
import { DIRECTION_GLYPH, DIRECTION_LABEL, formatRange, type BuildResult } from '@/lib/stages'
import type { TrackWithBpm } from '@/lib/types'
import { SourceBadge, formatDuration } from './track-table'

// UX step 5: the filled build as one drop target per stage plus an Unplaced
// bin. Any track can be dragged between them (the anchor stays in its stage);
// each stage re-orders itself by its direction after a drop, so there's no
// ordering within a stage here. The move logic lives in lib/editor.ts.

const UNPLACED = 'unplaced'

function droppableId(container: Container): string {
  return container === null ? UNPLACED : `stage:${container}`
}

function containerOf(id: UniqueIdentifier): Container {
  const s = String(id)
  return s === UNPLACED ? null : s.slice('stage:'.length)
}

// Pointer first, so a drop lands where the cursor is; the keyboard has no
// pointer, so it falls back to whichever container the dragged row overlaps.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

const KEY_STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

/** Arrow keys jump the dragged row to the next / previous container instead of nudging it. */
function containerStepper(order: string[]): KeyboardCoordinateGetter {
  return (event, { context }) => {
    const step = KEY_STEP[event.code]
    if (!step) return undefined
    event.preventDefault()
    const from = context.over?.id ?? (context.active?.data.current?.from as string | undefined)
    const index = from === undefined ? -1 : order.indexOf(String(from))
    const next = order[Math.min(order.length - 1, Math.max(0, index + step))]
    const rect = next === undefined ? undefined : context.droppableRects.get(next)
    return rect ? { x: rect.left + 8, y: rect.top + 8 } : undefined
  }
}

function TrackRow({
  track,
  anchor,
  outOfRange,
  handle,
}: {
  track: TrackWithBpm
  anchor: boolean
  outOfRange: boolean
  handle: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-0.5 text-sm">
      {handle}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-zinc-50">{track.name}</span>
        <span className="text-zinc-500"> · {track.artists.join(', ')}</span>
        {anchor && (
          <span className="ml-2 rounded border border-[#1DB954]/60 px-1.5 py-0.5 text-xs text-[#1DB954]">anchor</span>
        )}
      </span>
      <span className="shrink-0 text-zinc-500 tabular-nums">{formatDuration(track.durationMs)}</span>
      <span
        className={`w-10 shrink-0 text-right tabular-nums ${outOfRange ? 'text-amber-300' : 'text-zinc-400'}`}
        title={outOfRange ? "Outside this stage's BPM range" : undefined}
      >
        {hasBpm(track) ? Math.round(track.bpm) : '—'}
      </span>
      <span className="w-20 shrink-0">
        <SourceBadge track={track} />
      </span>
    </div>
  )
}

function DraggableTrack({
  track,
  container,
  anchor = false,
  outOfRange = false,
}: {
  track: TrackWithBpm
  container: Container
  anchor?: boolean
  outOfRange?: boolean
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: track.id,
    data: { from: droppableId(container) },
  })
  return (
    <li ref={setNodeRef} className={isDragging ? 'opacity-30' : undefined}>
      <TrackRow
        track={track}
        anchor={anchor}
        outOfRange={outOfRange}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move ${track.name}`}
            className="shrink-0 cursor-grab touch-none rounded px-1 text-zinc-600 hover:text-zinc-300 focus-visible:text-zinc-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#1DB954] active:cursor-grabbing"
          >
            ⠿
          </button>
        }
      />
    </li>
  )
}

// Highlight for the container under a drag: green where the drop will land,
// red where it's refused (an anchor leaving its stage).
type DropHint = 'allowed' | 'refused' | null

function DropZone({ container, hint, children }: { container: Container; hint: DropHint; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: droppableId(container) })
  const border =
    hint === 'allowed' ? 'border-[#1DB954]' : hint === 'refused' ? 'border-red-500/70' : 'border-zinc-800'
  return (
    <li ref={setNodeRef} className={`flex min-h-16 flex-col gap-2 rounded border px-3 py-3 transition-colors ${border}`}>
      {children}
    </li>
  )
}

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
      {hint === 'refused' && <p className="text-sm text-red-400">The anchor stays in its own stage.</p>}

      <ol>
        {stage.tracks.map((t) => {
          const anchor = t.id === stage.anchorTrackId
          return (
            <DraggableTrack
              key={t.id}
              track={t}
              container={stage.id}
              anchor={anchor}
              outOfRange={!anchor && hasBpm(t) && !inRange(t.bpm, stage.rangeBpm)}
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
      {hint === 'refused' && <p className="text-sm text-red-400">The anchor stays in its own stage.</p>}
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
  stale,
  error,
  onMove,
}: {
  result: BuildResult
  stale: boolean
  error: string | null // why the last tempo guess couldn't be saved
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
  const name = (id: UniqueIdentifier) => locateTrack(result, String(id))?.track.name ?? 'The song'
  const refusal = (trackId: UniqueIdentifier, over: UniqueIdentifier): MoveRefusal | null =>
    checkMove(result, String(trackId), containerOf(over))

  function hintFor(container: Container): DropHint {
    if (activeId === null || overId !== droppableId(container)) return null
    const why = refusal(activeId, overId)
    return why === null ? 'allowed' : why === 'anchor' ? 'refused' : null
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) => {
      if (!over) return `${name(active.id)} is not over a stage.`
      return refusal(active.id, over.id) === 'anchor'
        ? `${name(active.id)} is an anchor and can't leave its stage.`
        : `${name(active.id)} is over ${label(containerOf(over.id))}.`
    },
    onDragEnd: ({ active, over }) =>
      over && refusal(active.id, over.id) === null
        ? `${name(active.id)} moved to ${label(containerOf(over.id))}.`
        : `${name(active.id)} stays where it was.`,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  }

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

      <p className="text-sm text-zinc-500">
        Drag songs between stages by their ⠿ handle (or focus it, press Space, use the arrow keys, Space again). Each
        stage re-orders itself by its direction.
      </p>

      {error && (
        <p className="rounded border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">{error}</p>
      )}

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
                anchor={result.stages.some((s) => s.anchorTrackId === active.track.id)}
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
