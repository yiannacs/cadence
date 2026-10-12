import 'server-only'
import type { Track } from '../types'

// Thin typed wrapper over the few Web API endpoints the app uses. Endpoint
// shapes follow Spotify's February 2026 Development Mode rules: playlist
// contents live under /items (each entry's track is `item`), and only
// playlists the user owns are readable.

const API_BASE = 'https://api.spotify.com/v1'

// A short Retry-After is worth waiting out once. Dev Mode can hand out
// Retry-After values of many hours; those go straight back to the caller.
const MAX_RETRY_WAIT_SEC = 5
const DEFAULT_RETRY_AFTER_SEC = 1

// Spotify caps a playlist at 10,000 items; at 50 per page that's 200 pages.
// Anything beyond means a `next` link is looping.
const MAX_PAGES = 200

const PAGE_LIMIT = 50
export const MAX_URIS_PER_ADD = 100

export type SpotifyErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'playlist_not_owned'
  | 'rate_limited'
  | 'network'
  | 'http'

/**
 * The one error type for Web API calls. `message` is Spotify's own wording
 * where it gave one — turning that into user-facing copy is the UI's job,
 * and a 403 has too many possible causes to guess at here.
 */
export class SpotifyError extends Error {
  constructor(
    readonly status: number, // 0 when the request never got a response
    readonly kind: SpotifyErrorKind,
    message: string,
    readonly retryAfterSec?: number
  ) {
    super(message)
    this.name = 'SpotifyError'
  }
}

function kindForStatus(status: number): SpotifyErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  return 'http'
}

// Spotify sends Retry-After in seconds. Absent or unparseable → 1s.
function retryAfterOf(res: Response): number {
  const raw = res.headers.get('retry-after')
  const seconds = raw === null ? NaN : Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SEC
}

async function errorFrom(res: Response): Promise<SpotifyError> {
  let message = `Spotify returned HTTP ${res.status}`
  try {
    const body = await res.json()
    // Web API errors are { error: { status, message } }.
    if (typeof body?.error?.message === 'string' && body.error.message) {
      message = body.error.message
    }
  } catch {
    // Empty or non-JSON body; keep the generic message.
  }
  const retryAfterSec = res.status === 429 ? retryAfterOf(res) : undefined
  return new SpotifyError(res.status, kindForStatus(res.status), message, retryAfterSec)
}

async function send(token: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (err) {
    throw new SpotifyError(0, 'network', `Could not reach Spotify: ${(err as Error).message}`)
  }
}

/**
 * Calls the Web API and returns the parsed JSON body (undefined for an empty
 * one). `pathOrUrl` is a path under /v1, or an absolute URL — pagination
 * `next` links come back absolute.
 *
 * A 429 with a short Retry-After is waited out and retried once; a long one
 * throws `rate_limited` straight away with `retryAfterSec` set.
 */
export async function spotifyFetch<T>(
  token: string,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<T> {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${API_BASE}${pathOrUrl}`

  let res = await send(token, url, init)
  if (res.status === 429) {
    const wait = retryAfterOf(res)
    if (wait > MAX_RETRY_WAIT_SEC) throw await errorFrom(res)
    await new Promise((resolve) => setTimeout(resolve, wait * 1000))
    res = await send(token, url, init)
  }

  if (!res.ok) throw await errorFrom(res)

  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

interface Page<T> {
  items: T[]
  next: string | null
}

/** Follows `next` links until null and returns every item. */
export async function getAllPages<T>(token: string, firstPath: string): Promise<T[]> {
  const items: T[] = []
  let next: string | null = firstPath
  for (let page = 0; next; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(`Spotify pagination exceeded ${MAX_PAGES} pages at ${firstPath}`)
    }
    const body: Page<T> = await spotifyFetch<Page<T>>(token, next)
    items.push(...body.items)
    next = body.next
  }
  return items
}

// ---- Raw response shapes (only the fields we read) ----

interface RawImage {
  url: string
}

interface RawPlaylist {
  id: string
  name: string
  owner: { id: string }
  images: RawImage[] | null
  // `items` on Feb-2026 responses; `tracks` on older ones. Absent entirely
  // for playlists the user can't read.
  items?: { total: number } | null
  tracks?: { total: number } | null
}

interface RawTrack {
  type?: string
  id: string | null
  uri: string
  name: string
  duration_ms: number
  is_local?: boolean
  artists: { name: string }[]
}

interface RawPlaylistEntry {
  is_local?: boolean
  // `item` on Feb-2026 responses; `track` on older ones. Null for tracks
  // that have been removed from Spotify.
  item?: RawTrack | null
  track?: RawTrack | null
}

// ---- Endpoint wrappers ----

export interface Me {
  id: string
  displayName: string | null
}

export async function getMe(token: string): Promise<Me> {
  const me = await spotifyFetch<{ id: string; display_name: string | null }>(token, '/me')
  return { id: me.id, displayName: me.display_name ?? null }
}

export interface PlaylistSummary {
  id: string
  name: string
  ownerId: string
  // Only the user's own playlists are readable under Dev Mode rules. The
  // `collaborative` flag doesn't prove the user is a collaborator, so it's
  // not consulted.
  isOwn: boolean
  trackCount: number | null
  // Spotify's image URLs expire within about a day; don't persist them.
  imageUrl: string | null
}

export function toPlaylistSummary(raw: RawPlaylist, meId: string): PlaylistSummary {
  return {
    id: raw.id,
    name: raw.name,
    ownerId: raw.owner.id,
    isOwn: raw.owner.id === meId,
    trackCount: raw.items?.total ?? raw.tracks?.total ?? null,
    imageUrl: raw.images?.[0]?.url ?? null,
  }
}

/** Every playlist in the user's library, owned and followed alike. */
export async function getMyPlaylists(token: string): Promise<PlaylistSummary[]> {
  const [me, raw] = await Promise.all([
    getMe(token),
    getAllPages<RawPlaylist | null>(token, `/me/playlists?limit=${PAGE_LIMIT}`),
  ])
  return raw
    .filter((p): p is RawPlaylist => p !== null)
    .map((p) => toPlaylistSummary(p, me.id))
}

export interface PlaylistDetail {
  id: string
  name: string
  // Whether the user can read the contents: their own playlists and ones
  // they collaborate on.
  readable: boolean
  trackCount: number | null
  // Spotify's image URLs expire within about a day; don't persist them.
  imageUrl: string | null
}

/** One playlist's metadata. A 404 comes through as SpotifyError kind 'http'. */
export async function getPlaylist(token: string, playlistId: string): Promise<PlaylistDetail> {
  const raw = await spotifyFetch<RawPlaylist>(token, `/playlists/${encodeURIComponent(playlistId)}`)
  // Spotify leaves `items` off playlists the user can't read. An old-shape
  // response (`tracks` only) doesn't say, so fall back to an ownership check.
  const readable =
    raw.items != null || (raw.tracks != null && raw.owner.id === (await getMe(token)).id)
  return {
    id: raw.id,
    name: raw.name,
    readable,
    trackCount: raw.items?.total ?? raw.tracks?.total ?? null,
    imageUrl: raw.images?.[0]?.url ?? null,
  }
}

/**
 * Maps one playlist entry to a Track, or null for anything that can't go in
 * an exported playlist: removed tracks, local files, podcast episodes.
 */
export function toTrack(entry: RawPlaylistEntry): Track | null {
  const t = entry.item ?? entry.track
  if (!t || entry.is_local || t.is_local) return null
  if (!t.id || !t.uri?.startsWith('spotify:track:')) return null
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    durationMs: t.duration_ms,
  }
}

/** Throws SpotifyError kind 'playlist_not_owned' for playlists the user can't read. */
export async function getPlaylistTracks(token: string, playlistId: string): Promise<Track[]> {
  let entries: RawPlaylistEntry[]
  try {
    entries = await getAllPages<RawPlaylistEntry>(
      token,
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=${PAGE_LIMIT}`
    )
  } catch (err) {
    if (err instanceof SpotifyError && err.kind === 'forbidden') {
      throw new SpotifyError(err.status, 'playlist_not_owned', err.message)
    }
    throw err
  }
  return entries.map(toTrack).filter((t): t is Track => t !== null)
}

export interface CreatedPlaylist {
  id: string
  url: string
}

export async function createPlaylist(
  token: string,
  { name, isPublic = false, description }: { name: string; isPublic?: boolean; description?: string }
): Promise<CreatedPlaylist> {
  const created = await spotifyFetch<{ id: string; external_urls: { spotify: string } }>(
    token,
    '/me/playlists',
    {
      method: 'POST',
      // `public` defaults to true on Spotify's side, so it's always sent.
      body: JSON.stringify({
        name,
        public: isPublic,
        ...(description !== undefined ? { description } : {}),
      }),
    }
  )
  return { id: created.id, url: created.external_urls.spotify }
}

/**
 * Appends up to 100 tracks in one request; splitting longer lists is the
 * caller's job. Returns the playlist's new snapshot ID.
 */
export async function addTracks(
  token: string,
  playlistId: string,
  uris: string[]
): Promise<string> {
  if (uris.length > MAX_URIS_PER_ADD) {
    throw new RangeError(`addTracks takes at most ${MAX_URIS_PER_ADD} URIs, got ${uris.length}`)
  }
  const res = await spotifyFetch<{ snapshot_id: string }>(
    token,
    `/playlists/${encodeURIComponent(playlistId)}/items`,
    { method: 'POST', body: JSON.stringify({ uris }) }
  )
  return res.snapshot_id
}
