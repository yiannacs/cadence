import type { ApiErrorBody } from './resolution'
import type { BuildResult } from './stages'

// Export (F7): the wire contract of POST /api/export, the request the export
// panel builds from the edited result, and the chunked create-then-add run
// the route performs. Kept free of server-only imports — the export panel
// imports this file, and the route hands in the Spotify calls.

// Spotify's limit on URIs per "add items" request.
export const EXPORT_CHUNK_SIZE = 100
// Spotify caps a playlist at 10,000 items.
export const MAX_EXPORT_URIS = 10_000
export const MAX_NAME_LENGTH = 100
// Spotify's own limit on playlist descriptions.
export const MAX_DESCRIPTION_LENGTH = 300

const TRACK_URI = /^spotify:track:[0-9A-Za-z]{1,64}$/

export interface ExportRequest {
  name: string
  public: boolean
  uris: string[] // in play order
  description?: string
}

export interface ExportedPlaylist {
  id: string
  url: string // external_urls.spotify
}

// 200: every track was added.
export interface ExportResponse {
  playlist: ExportedPlaylist
  added: number
  total: number
}

// Non-2xx after the playlist was created: the playlist holds the first
// `added` of `total` tracks, in order, and `error` says why it stopped.
export interface ExportPartialBody extends ApiErrorBody, ExportResponse {}

// ---- Building the request (client) ----

/** The URIs to export: stage 1 in play order, then stage 2, … Unplaced tracks are left out. */
export function exportUris(result: BuildResult): string[] {
  return result.stages.flatMap((s) => s.tracks.map((t) => t.uri))
}

/** Track count and total length of what would be exported. */
export function exportTotals(result: BuildResult): { tracks: number; durationMs: number } {
  let tracks = 0
  let durationMs = 0
  for (const stage of result.stages) {
    for (const t of stage.tracks) {
      tracks++
      durationMs += t.durationMs
    }
  }
  return { tracks, durationMs }
}

/** Local date as YYYY-MM-DD. */
function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** e.g. "cadence · Running mix · 2026-10-12", cut to fit Spotify's name field. */
export function defaultPlaylistName(sourceName: string, date: Date): string {
  const suffix = ` · ${isoDate(date)}`
  const room = MAX_NAME_LENGTH - 'cadence · '.length - suffix.length
  const source = sourceName.trim()
  const fitted = source.length > room ? `${source.slice(0, room - 1).trimEnd()}…` : source
  return `cadence · ${fitted}${suffix}`
}

/** e.g. "warmup 150 · build 160 · peak 172 · cooldown 145 — made with cadence". */
export function exportDescription(result: BuildResult): string {
  const tail = ' — made with cadence'
  const stages = result.stages
    .map((s) => `${result.labels[s.id] ?? s.id} ${Math.round(s.centerBpm)}`)
    .join(' · ')
  const room = MAX_DESCRIPTION_LENGTH - tail.length
  return `${stages.length > room ? `${stages.slice(0, room - 1).trimEnd()}…` : stages}${tail}`
}

/** The request body for the edited result, or null when no stage holds a track. */
export function buildExportRequest(
  result: BuildResult,
  name: string,
  isPublic: boolean
): ExportRequest | null {
  const uris = exportUris(result)
  if (uris.length === 0) return null
  return { name: name.trim(), public: isPublic, uris, description: exportDescription(result) }
}

// ---- Validating the request (route) ----

/**
 * Strict check of the route's body: exactly name, public, uris and an
 * optional description. Null when anything is off.
 */
export function parseExportRequest(body: unknown): ExportRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const keys = Object.keys(body)
  const allowed = ['name', 'public', 'uris', 'description']
  if (!keys.every((k) => allowed.includes(k)) || !['name', 'public', 'uris'].every((k) => keys.includes(k))) {
    return null
  }
  const { name, public: isPublic, uris, description } = body as Record<string, unknown>

  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null
  if (typeof isPublic !== 'boolean') return null
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_EXPORT_URIS) return null
  if (!uris.every((u) => typeof u === 'string' && TRACK_URI.test(u))) return null
  if (description !== undefined && (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH)) {
    return null
  }

  return {
    name: trimmed,
    public: isPublic,
    uris: uris as string[],
    ...(description !== undefined && description.trim() ? { description: description.trim() } : {}),
  }
}

// ---- Running the export (route) ----

/** Splits `items` into consecutive chunks of at most `size`, keeping order. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface ExportCalls {
  createPlaylist: (opts: { name: string; isPublic: boolean; description?: string }) => Promise<ExportedPlaylist>
  addTracks: (playlistId: string, uris: string[]) => Promise<unknown>
}

export interface ExportOutcome extends ExportResponse {
  // Why adding stopped early; undefined when every track was added.
  error?: unknown
}

/**
 * Creates the playlist, then appends the URIs in chunks of 100, one request
 * at a time so Spotify keeps them in order. Stops at the first failed chunk —
 * skipping it would put the later tracks in the wrong places — and reports
 * how many tracks made it. A failed create throws: there's no playlist yet.
 */
export async function runExport(req: ExportRequest, calls: ExportCalls): Promise<ExportOutcome> {
  const playlist = await calls.createPlaylist({
    name: req.name,
    isPublic: req.public,
    ...(req.description !== undefined ? { description: req.description } : {}),
  })
  const total = req.uris.length
  let added = 0
  for (const part of chunk(req.uris, EXPORT_CHUNK_SIZE)) {
    try {
      await calls.addTracks(playlist.id, part)
    } catch (error) {
      return { playlist, added, total, error }
    }
    added += part.length
  }
  return { playlist, added, total }
}

// ---- Calling the route (client) ----

export type ExportResult =
  | { status: 'done'; playlist: ExportedPlaylist; added: number; total: number }
  // The playlist exists but holds only the first `added` tracks.
  | { status: 'partial'; playlist: ExportedPlaylist; added: number; total: number; message: string }
  // Nothing was created.
  | { status: 'failed'; message: string }

function isPlaylist(value: unknown): value is ExportedPlaylist {
  const p = value as ExportedPlaylist | null
  return typeof p?.id === 'string' && typeof p?.url === 'string'
}

/** Interprets the route's response; never throws. */
export async function readExportResponse(res: Response): Promise<ExportResult> {
  let body: Partial<ExportPartialBody> | null = null
  try {
    body = await res.json()
  } catch {
    // Empty or non-JSON body; handled below.
  }
  const message = body?.error?.message || `Export failed (HTTP ${res.status}).`
  if (!isPlaylist(body?.playlist)) return { status: 'failed', message }
  const added = typeof body.added === 'number' ? body.added : 0
  const total = typeof body.total === 'number' ? body.total : added
  if (res.ok) return { status: 'done', playlist: body.playlist, added, total }
  return { status: 'partial', playlist: body.playlist, added, total, message }
}

export async function postExport(req: ExportRequest): Promise<ExportResult> {
  let res: Response
  try {
    res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
  } catch {
    // The request may or may not have reached Spotify; say so rather than guess.
    return {
      status: 'failed',
      message:
        'Could not reach the cadence server. Check Spotify before exporting again — the playlist may have been created.',
    }
  }
  return readExportResponse(res)
}
