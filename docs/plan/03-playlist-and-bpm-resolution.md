# F3 — Source playlist picker + bulk BPM resolution

Back to [PLAN.md](PLAN.md)

## Goal

UX steps 2 and 4a: the user picks one of their playlists, the app loads its tracks and resolves BPM for each, showing which tracks have a BPM and which missed.

## Scope

1. **Playlist picker page** (e.g. `app/build/page.tsx`, Server Component) — lists `getMyPlaylists()` with name, track count, cover. Redirect to `/` if not logged in. Selecting one navigates to `/build/[playlistId]`.
2. **Route Handler `GET /api/playlists/[id]/tracks`** — returns `TrackWithBpm[]`:
   - fetch tracks via F1,
   - return immediately with whatever BPMs the cache already has,
   - so the UI can render fast; resolution of the rest happens in step 3.
3. **Resolution endpoint `POST /api/bpm/resolve`** — body: list of `{ id, artist, title }`; resolves via `getBpm` (F2) and returns results.
   - Long playlists + a rate-limited API = this can take a while. Stream progress (NDJSON / `ReadableStream` response) or have the client call in chunks of ~20 and update state as each returns. Chunked calls are simpler; prefer that unless it feels sluggish.
   - Flush the cache once per chunk (see F2 batch flush).
4. **Track list UI** — compact table: title, artist, duration, BPM, source badge (`api` / `manual` / `synthetic` / `—`). Summary line: "212 / 240 tracks have a BPM". Progress indicator while resolving.

## Notes

- Duplicate tracks within the source playlist: dedupe by track ID on load.
- This page becomes the host for the stage builder (F5) and editor (F6) — design the client state container now: `{ playlist, tracks: TrackWithBpm[] }`.

## Acceptance

- Picking a 200+ track playlist shows the full list within a couple of seconds, then BPMs fill in progressively.
- Re-opening the same playlist resolves almost instantly (cache hits).
- `data/bpm-cache.json` contains entries for every track after one pass.
