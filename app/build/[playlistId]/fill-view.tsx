'use client'

import type { Container } from '@/lib/editor'
import type { BuildResult } from '@/lib/stages'

export interface FillViewProps {
  result: BuildResult
  onMove: (trackId: string, to: Container) => void
}

// Adds unplaced songs to stages: Unplaced on the left, every stage on the right.
// Placeholder until U4; takes its final props so the shell doesn't change then.
export default function FillView({ result }: FillViewProps) {
  return (
    <p className="text-zinc-500">
      The Fill view is coming soon — {result.unplaced.length} unplaced songs. Use Arrange to move songs for now.
    </p>
  )
}
