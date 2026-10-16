'use client'

import type { Container } from '@/lib/editor'
import type { BuildResult } from '@/lib/stages'
import StageEditor from './stage-editor'

// Moves songs between stages and the Unplaced bin.
export default function ArrangeView({
  result,
  onMove,
}: {
  result: BuildResult
  onMove: (trackId: string, to: Container) => void
}) {
  return <StageEditor result={result} onMove={onMove} />
}
