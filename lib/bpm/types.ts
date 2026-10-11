export type BpmSource = 'api' | 'manual' | 'synthetic'

export interface BpmEntry {
  // null means "we looked it up and GetSongBPM had no match" — a negative
  // result worth remembering so we don't re-query a miss on every run.
  bpm: number | null
  // BPM spread of the stage a synthetic entry came from; null otherwise.
  tolerance: number | null
  source: BpmSource
  updatedAt: string // ISO 8601
}

// Keyed by Spotify track ID.
export type BpmCacheFile = Record<string, BpmEntry>
