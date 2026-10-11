# F7 — Export to Spotify

Back to [PLAN.md](PLAN.md)

## Goal

UX step 6: save the staged result as one new playlist on the user's Spotify profile, in exactly the order shown (stage 1 in its play order, then stage 2, …). Unplaced tracks are not exported.

## Scope

1. **Export panel** — playlist name input (default e.g. `cadence · <source name> · <date>`), public/private toggle (default private), "Export" button, total duration + track count.
2. **Route Handler `POST /api/export`** — body: `{ name, public, uris: string[], description? }`.
   - Create the playlist via F1's `createPlaylist` (`POST /me/playlists`; it always sends `public`, because Spotify defaults to public).
   - Add tracks via `addTracks` (`POST /playlists/{id}/items`) in **chunks of 100** (Spotify's per-request limit), sequentially so order is preserved.
   - Description: a short summary, e.g. `warmup 150 · build 160 · peak 172 · cooldown 145 — made with cadence`.
3. **Result** — on success, show a link to the new playlist (`external_urls.spotify`). On partial failure (playlist created, some chunks failed), report how far it got rather than silently leaving a half playlist.
4. Guard against double-clicks creating two playlists (disable the button while in flight).

## Acceptance

- The exported playlist in Spotify matches the editor's order track-for-track, including for >100 tracks.
- Private by default; works with only the three scopes already requested in `lib/spotify/auth.ts`.
