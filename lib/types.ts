import type { BpmSource } from './bpm/types'
import type { BuildResult, StageDraft } from './stages'

// Kept free of server-only imports: client components import this file.

export interface Track {
  id: string // Spotify track ID — also the BPM cache key
  uri: string // spotify:track:… — needed for export
  name: string
  artists: string[]
  durationMs: number
}

export interface TrackWithBpm extends Track {
  // bpmSource null means "not resolved yet" (or the lookup errored);
  // bpmSource 'api' with bpm null means "looked up, no match".
  bpm: number | null
  bpmSource: BpmSource | null
}

// The source playlist as the client sees it.
export interface Playlist {
  id: string
  name: string
  trackCount: number | null
  imageUrl: string | null
}

// Run state for one build, held on the client. F3 fills `tracks`; the stage
// builder (F5) adds the stage drafts and the filled result, which the editor
// (F6) then changes.
export interface BuildState {
  playlist: Playlist
  tracks: TrackWithBpm[]
  stages: StageDraft[]
  result: BuildResult | null // null until the first Build
}
