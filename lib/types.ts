import type { BpmSource } from './bpm/types'

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
