# F3 — Source playlist picker + bulk BPM resolution

Back to [PLAN.md](PLAN.md)

## Goal

UX step 2 and the BPM half of step 4: the user picks one of their playlists, the app loads its tracks and resolves BPM for each, showing which tracks have a BPM and which missed.

## Scope

1. **Playlist picker page** (e.g. `app/build/page.tsx`, Server Component) — lists `getMyPlaylists()` with name, track count, cover. Redirect to `/` if not logged in. Selecting one navigates to `/build/[playlistId]`.
   - Only playlists with `isOwn` are selectable (Spotify Dev Mode returns 403 for others). Show the rest disabled with a hint: "Spotify only lets this app read playlists you own".
2. **Route Handler `GET /api/playlists/[id]/tracks`** — returns `TrackWithBpm[]`:
   - fetch tracks via F1,
   - return immediately with whatever BPMs the cache already has,
   - so the UI can render fast; resolution of the rest happens in step 3.
3. **Resolution endpoint `POST /api/bpm/resolve`** — body: list of `{ id, artist, title }`; resolves via `getBpm` (F2) and returns results.
   - Long playlists + a rate-limited API = this can take a while. Stream progress (NDJSON / `ReadableStream` response) or have the client call in chunks of ~20 and update state as each returns. Chunked calls are simpler; prefer that unless it feels sluggish.
   - Flushes are coalesced inside the cache (F2 §6); nothing to do here.
   - All `/api/bpm/*` routes (this one and F6's `synthetic`) require the Spotify session cookie (`sp_rt` present) — `next dev -H 0.0.0.0` exposes them to the LAN, and anyone could burn the GetSongBPM hourly budget. Proxy skips these routes, so this is a presence check, not a refresh.
   - Per-track errors (rate block, outage) come back as "unresolved", not as a miss. If F2's circuit breaker trips, stop sending chunks and show the reason (e.g. "GetSongBPM key invalid", "rate limit — try again in an hour").
4. **Track list UI** — compact table: title, artist, duration, BPM, source badge (`api` / `manual` / `synthetic` / `—`). Summary line: "212 / 240 tracks have a BPM". Progress indicator while resolving.
5. Optional: small footer link "BPM data from GetSongBPM" (the README backlink already satisfies their terms).

## Notes

- Duplicate tracks within the source playlist: dedupe by track ID on load.
- This page becomes the host for the stage builder (F5) and editor (F6) — design the client state container now: `BuildState { playlist, tracks: TrackWithBpm[] }` in `lib/types.ts`, which F5 extends with `stages` and `result`.

## Acceptance

- Picking a 200+ track playlist shows the full list within a couple of seconds, then BPMs fill in progressively.
- Re-opening the same playlist resolves almost instantly (cache hits).
- `data/bpm-cache.json` contains entries for every track after one pass, except tracks whose lookup errored (those stay uncached and are retried next time).
