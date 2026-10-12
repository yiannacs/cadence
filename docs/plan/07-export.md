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

## Notes

- Request building, body validation, chunking and the create-then-add run live in `lib/export.ts` (pure, unit-tested; the route passes in F1's `createPlaylist` / `addTracks`). The UI is `app/build/[playlistId]/export-panel.tsx`, below the editor.
- The body must have exactly those keys: a non-blank `name` (≤ 100 chars, trimmed), a boolean `public`, 1–10,000 `spotify:track:` URIs and an optional `description` (≤ 300 chars), else `400`.
- Responses: `200 { playlist: { id, url }, added, total }`. A failed create returns the usual `{ error: { kind, message } }` (nothing was created). A failed chunk stops the run — later chunks would land out of order — and returns the Spotify error's status with `{ error, playlist, added, total }`, where `added` is how many tracks the playlist holds, in order; the panel shows that with the playlist link.
- A double-click guard (a ref, not just the disabled button) stops a second request before the first re-render. Exporting again after success deliberately creates another playlist.

## Acceptance

- The exported playlist in Spotify matches the editor's order track-for-track, including for >100 tracks.
- Private by default; works with only the three scopes already requested in `lib/spotify/auth.ts`.
