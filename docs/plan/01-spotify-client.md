# F1 — Spotify session + Web API client

Back to [PLAN.md](PLAN.md)

## Goal

One place that answers "give me a valid access token for this request" and a thin typed wrapper over the handful of Spotify endpoints the app uses. Today `app/page.tsx` inlines both token handling and a raw `fetch('/v1/me')`, and refreshed tokens are thrown away because Server Components can't set cookies.

## Facts verified 2026-10-11

The app was registered after 2026-02-11, so Spotify's **February 2026 Development Mode rules** apply:

- Playlist contents: `GET /playlists/{id}/items` — **not** `/tracks` (403 for new apps). Each entry's `track` field is now `item`; on playlist objects `tracks` → `items` (count = `items.total`).
- `limit` max is **50** on `/me/playlists` and `/playlists/{id}/items`.
- Contents are only readable for playlists the user **owns** (or collaborates on). Anything else → 403, and `items` is absent from the playlist object. `GET /me/playlists` also returns followed playlists.
- Create playlist: `POST /me/playlists` (`/users/{id}/playlists` was removed). **`public` defaults to `true`** — always send it.
- Add items: `POST /playlists/{id}/items`, JSON `{ uris }`, max 100 per request.
- `/me` still has `id` and `display_name` (nullable); `country`, `email`, `product` etc. are gone.
- Refresh tokens **expire 6 months after the original authorization** (enforced since 2026-07-20); refreshing doesn't extend them. Expired/revoked → `invalid_grant` → user must log in again.
- 429s: `Retry-After` in seconds; Dev Mode users report values of 13–19 hours.
- A 403 can mean: not on the 5-user allowlist, app owner lacks Premium, playlist not owned, or a removed endpoint.

Sources: Spotify Web API reference pages, the Feb-2026 migration guide and changelog, the 2026-06-18 refresh-token-expiration blog post.

## Scope

### 1. Session — `proxy.ts` + `lib/spotify/session.ts`

Refresh happens **only** in the root `proxy.ts`. Verified on Next 16.2.9 — **order matters**:

```ts
request.cookies.set('sp_at', …)          // 1. forwarded request — so Route Handlers see it
request.cookies.set('sp_exp', …)          //    (and sp_rt if Spotify returned a new one)
const res = NextResponse.next({ request: { headers: request.headers } })  // 2. AFTER step 1
res.cookies.set('sp_at', …, opts)         // 3. response — so the browser stores it
```

Setting only the response cookie reaches Server Components but **not** Route Handlers (they'd 401 on the first call after expiry). Building `NextResponse.next(...)` before step 1 has the same bug.

- **Matcher** excludes routes that must not trigger a refresh: `['/((?!api/login|api/callback|api/logout|api/bpm|_next/static|_next/image|favicon.ico).*)']`. In particular the callback must never run behind a proxy refresh using the *old* refresh token.
- Return `NextResponse.next()` early if there's no `sp_rt` or the token is still valid for >60s.
- On `invalid_grant` (revoked / 6-month expiry): delete the cookies on request **and** response → the app shows "logged out".
- On network / 5xx failure: pass through unchanged — don't log the user out over a blip.
- `session.ts` exports: cookie names + options (one source for callback, logout and proxy — currently duplicated), `setTokens` / `clearTokens(req, res)` for proxy, and a read-only `getAccessToken()` (via `cookies()`) for pages and handlers. It never refreshes.
- `auth.ts`: `refreshAccessToken` throws a typed error that preserves Spotify's error code; `getValidToken` stops swallowing errors (or is removed in favour of the proxy logic).
- Next's docs note proxy isn't meant as a full session-management layer; for a single local user it's the right trade-off.

### 2. Client — `lib/spotify/api.ts`

`spotifyFetch(token, pathOrUrl, init)`:
- prefixes `https://api.spotify.com/v1` unless given an absolute URL (pagination `next` links are absolute);
- parses Spotify's `{ error: { status, message } }` body;
- one error type: `SpotifyError { status, kind, message, retryAfterSec? }` with `kind` ∈ `unauthorized | forbidden | playlist_not_owned | rate_limited | network | http`;
- on 429: if `Retry-After` ≤ 5s (absent → 1s), wait and retry once; otherwise throw `rate_limited` with `retryAfterSec` immediately;
- a `fetch` rejection becomes `kind: 'network'`.

User-facing wording stays in the UI layer; pass Spotify's message through rather than guessing the 403 cause.

### 3. Endpoint wrappers

- `getMe()` → `{ id, displayName }`
- `getMyPlaylists()` → `GET /me/playlists?limit=50`, all pages →
  `{ id, name, ownerId, isOwn: owner.id === me.id, trackCount: items?.total ?? tracks?.total ?? null, imageUrl: images[0]?.url ?? null }`.
  Only `isOwn` playlists are readable; F3 disables the rest. (Don't trust the `collaborative` flag — it doesn't prove the user is a collaborator.)
- `getPlaylist(playlistId)` → `GET /playlists/{id}` → `{ id, name, readable, trackCount, imageUrl }`, one request. `readable` is `items` being present (covers collaborative playlists); an old-shape response with only `tracks` falls back to `owner.id === me.id`. Used by the `/build/[playlistId]` page; 404 (and 400 for a malformed ID) → not found.
- `getPlaylistTracks(playlistId)` → `GET /playlists/{id}/items?limit=50`, all pages, mapped to `Track`. Read `entry.item ?? entry.track`; keep only non-null, `!is_local`, `uri` starting `spotify:track:` (drops episodes and local files). A 403 → `kind: 'playlist_not_owned'`.
- `createPlaylist({ name, isPublic = false, description })` → `POST /me/playlists`, **always** sending `public` → `{ id, url: external_urls.spotify }`.
- `addTracks(playlistId, uris)` → `POST /playlists/{id}/items` with JSON `{ uris }`, ≤100 per call (chunking is F7's job).
- Pagination helper follows the absolute `next` URL until null, with a hard page cap (e.g. 100 pages).
- **No `fields=` trimming** for the MVP (a 300-track playlist is 6 requests). If added later: list `next,total` explicitly and filter with `item(...)`, not `track(...)`.
- Image URLs expire within about a day — don't persist them in localStorage.

### 4. Refactor

`app/page.tsx` uses `getAccessToken()` + `getMe()`.

## Notes / risks

- **Smoke-test `createPlaylist` + `addTracks` by hand early** (one throwaway playlist). There's an unresolved community report of 403 on create in Dev Mode; if export can't work, the MVP is blocked, so find out before F3–F6.
- Optional, unverified: `market=from_token` + skip `is_playable === false` tracks, since unplayable tracks would be skipped in Spotify and shorten stages.
- Concurrent refreshes (parallel requests or prefetches with an expired token) each refresh once. Harmless unless Spotify invalidates the old refresh token on rotation (undocumented); a single-flight guard in proxy is optional.

## Acceptance

- With `sp_exp=0`, **both** `GET /` and one Spotify-backed Route Handler use a refreshed token in the same request, and the response sets new `sp_at` / `sp_exp`. Test with `curl -H 'Cookie: sp_rt=…; sp_exp=0'`.
- A revoked refresh token logs out cleanly; a network failure during refresh does not.
- `getPlaylistTracks` returns every track of a >100-track playlist (≥3 pages at limit 50).
- A followed-but-not-owned playlist yields a clear "only playlists you own" error.
