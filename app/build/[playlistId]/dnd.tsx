'use client'

import type { ReactNode } from 'react'
import {
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  type Announcements,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { checkMove, locateTrack, type Container, type MoveRefusal } from '@/lib/editor'
import { hasBpm } from '@/lib/fill'
import type { BuildResult } from '@/lib/stages'
import type { TrackWithBpm } from '@/lib/types'
import { SourceBadge, formatDuration } from './format'

// Drag-and-drop pieces shared by the build views: droppable IDs for stages and
// the Unplaced bin, collision detection, keyboard stepping between containers,
// the track row with its handle, drop zones and screen-reader announcements.

export const UNPLACED = 'unplaced'

export function droppableId(container: Container): string {
  return container === null ? UNPLACED : `stage:${container}`
}

export function containerOf(id: UniqueIdentifier): Container {
  const s = String(id)
  return s === UNPLACED ? null : s.slice('stage:'.length)
}

// Pointer first, so a drop lands where the cursor is; the keyboard has no
// pointer, so it falls back to whichever container the dragged row overlaps.
export const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

const KEY_STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

/** Arrow keys jump the dragged row to the next / previous container instead of nudging it. */
export function containerStepper(order: string[]): KeyboardCoordinateGetter {
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

export type TrackBadge = 'anchor' | 'co-anchor'

/** Whether a track anchors (or co-anchors) a stage of `result`. */
export function trackBadge(result: BuildResult, trackId: string): TrackBadge | undefined {
  for (const stage of result.stages) {
    if (stage.anchorTrackId === trackId) return 'anchor'
    if (stage.pinnedTrackIds.includes(trackId)) return 'co-anchor'
  }
  return undefined
}

export function TrackRow({
  track,
  badge,
  outOfRange,
  handle,
}: {
  track: TrackWithBpm
  badge?: TrackBadge
  outOfRange: boolean
  handle: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-0.5 text-sm">
      {handle}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-zinc-50">{track.name}</span>
        <span className="text-zinc-500"> · {track.artists.join(', ')}</span>
        {badge && (
          <span className="ml-2 rounded border border-[#1DB954]/60 px-1.5 py-0.5 text-xs text-[#1DB954]">{badge}</span>
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

export function DraggableTrack({
  track,
  container,
  badge,
  outOfRange = false,
}: {
  track: TrackWithBpm
  container: Container
  badge?: TrackBadge
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
        badge={badge}
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
// red where it's refused (an anchor or co-anchor leaving its stage).
export type DropHint = 'allowed' | 'refused' | null

export function DropZone({ container, hint, children }: { container: Container; hint: DropHint; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: droppableId(container) })
  const border =
    hint === 'allowed' ? 'border-[#1DB954]' : hint === 'refused' ? 'border-red-500/70' : 'border-zinc-800'
  return (
    <li ref={setNodeRef} className={`flex min-h-16 flex-col gap-2 rounded border px-3 py-3 transition-colors ${border}`}>
      {children}
    </li>
  )
}

/**
 * Screen-reader announcements for dragging a track of `result` between
 * containers; `label` names a container (a stage, or Unplaced).
 */
export function trackAnnouncements(result: BuildResult, label: (container: Container) => string): Announcements {
  const name = (id: UniqueIdentifier) => locateTrack(result, String(id))?.track.name ?? 'The song'
  const refusal = (trackId: UniqueIdentifier, over: UniqueIdentifier): MoveRefusal | null =>
    checkMove(result, String(trackId), containerOf(over))

  return {
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
}
