# F1 — Spotify session + Web API client

Back to [PLAN.md](PLAN.md)

## Goal

One place that answers "give me a valid access token for this request" and a thin typed wrapper over the handful of Spotify endpoints the app uses. Today `app/page.tsx` inlines both token handling and a raw `fetch('/v1/me')`; every later feature needs the same thing.

## Scope

1. **`lib/spotify/session.ts`** — reads `sp_at` / `sp_rt` / `sp_exp` cookies, calls the existing `getValidToken`, and **writes refreshed tokens back to the cookies**.
   - Gotcha: Server Components cannot set cookies. Refresh-and-write-back must happen in a Route Handler, Server Action, or `proxy.ts`. Recommended: do the refresh in `proxy.ts` for matched routes so every downstream handler/page sees a fresh `sp_at`. Read `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` first.
   - Cookie names/options are currently duplicated between callback and logout — centralise them here.
2. **`lib/spotify/api.ts`** — `spotifyFetch(token, path, init)` that:
   - prefixes `https://api.spotify.com/v1`,
   - maps 401 / 403 / 429 to typed errors (reuse the messages already written in `app/page.tsx`),
   - on 429 honours `Retry-After` once before giving up.
3. **Endpoint wrappers** (only what the MVP needs):
   - `getMe()` → `{ id, displayName }`
   - `getMyPlaylists()` → all pages of the current user's playlists `{ id, name, trackCount, imageUrl }`
   - `getPlaylistTracks(playlistId)` → all pages, mapped to `Track` (see PLAN.md). Skip local files, episodes, and `null` tracks (removed/unavailable).
   - `createPlaylist(...)`, `addTracks(...)` — signatures only here; implemented in [F7](07-export.md).
   - Pagination helper that follows `next` until null.
4. Refactor `app/page.tsx` to use `getMe()` from the new client.

## Notes / risks

- Spotify has changed Web API access for Development Mode apps more than once since late 2024 (playlist endpoints, Spotify-owned/editorial playlists returning 404 for new apps). **Check the current endpoint paths and field names in Spotify's docs before implementing** — don't trust memory. Surface a clear error if a chosen playlist can't be read.
- Request only the fields needed (`fields=` query param on playlist items) to keep payloads small for long playlists.

## Acceptance

- Logged-in home page still works, now via the client.
- An expired access token is transparently refreshed and the new cookies are set on the response.
- `getPlaylistTracks` returns every track of a >100-track playlist.
