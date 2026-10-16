# cadence — implementation plan

Source of truth for *what* to build: [`../CADENCE.md`](../CADENCE.md). This file covers *how*: the order of the work and links to one spec per feature.

## Current state (as of `42edd20`)

The MVP is implemented: F0–F7 are all done, and tests, type-check, lint and `next build` pass. The next round of work is the UX rework in [`ux/PLAN.md`](ux/PLAN.md).

| Feature | Where |
|---|---|
| F0 Foundation | `vitest.config.mts`, `test/stubs/`, `lib/types.ts` |
| F1 Spotify session + client | `proxy.ts`, `lib/spotify/{session,auth,api,messages}.ts`, `app/api/{login,callback,logout}` |
| F2 GetSongBPM + `getBpm` | `lib/bpm/{cache,getsongbpm,normalize,index,batch}.ts` |
| F3 Picker + bulk resolve | `app/build/page.tsx`, `app/api/playlists/[id]/tracks`, `app/api/bpm/resolve`, `lib/resolution.ts` |
| F4 Fill algorithm | `lib/fill.ts` |
| F5 Stage builder | `lib/stages.ts`, `app/build/[playlistId]/{stage-builder,stage-row,anchor-picker}.tsx` |
| F6 Drag-and-drop editor | `lib/editor.ts`, `app/api/bpm/synthetic`, `app/build/[playlistId]/stage-editor.tsx` |
| F7 Export | `lib/export.ts`, `app/api/export`, `app/build/[playlistId]/export-panel.tsx` |

Not done:
- F1's optional `market=from_token` / `is_playable` filtering.
- Manual checks against live Spotify: the F1 refresh curl test, and the F7 >100-track export order check.
- Everything under [Future work](#future-work).

## Features

| # | Feature | Depends on | Spec |
|---|---|---|---|
| F0 | Foundation: Vitest harness, shared types, `.gitignore` | — | [00-foundation.md](00-foundation.md) |
| F1 | Spotify session + Web API client | F0 | [01-spotify-client.md](01-spotify-client.md) |
| F2 | GetSongBPM client + `getBpm` resolver, cache fixes | F0 | [02-getsongbpm-resolver.md](02-getsongbpm-resolver.md) |
| F3 | Source playlist picker + bulk BPM resolution | F1, F2 | [03-playlist-and-bpm-resolution.md](03-playlist-and-bpm-resolution.md) |
| F4 | Fill algorithm (pure, unit-tested) | F0 | [04-fill-algorithm.md](04-fill-algorithm.md) |
| F5 | Stage builder UI (durations + anchors) | F3, F4 | [05-stage-builder.md](05-stage-builder.md) |
| F6 | Drag-and-drop stage editor + synthetic BPM | F5 | [06-stage-editor-dnd.md](06-stage-editor-dnd.md) |
| F7 | Export to Spotify | F1, F6 | [07-export.md](07-export.md) |

```
      ┌─► F1 ─┐
      │       ├─► F3 ─┐
F0 ───┼─► F2 ─┘       ├─► F5 ─► F6 ─► F7
      │               │
      └─► F4 ─────────┘
```

F0 is one small commit on `main`. After it, F1, F2 and F4 are independent and can be done in parallel. F2 owns the `cache.ts` precedence fix that F6 depends on.

## Cross-cutting decisions

- **Server/client split.** All Spotify and GetSongBPM calls live in Route Handlers, Server Components or `proxy.ts` (token refresh). The browser never sees `SPOTIFY_CLIENT_SECRET` or `GETSONGBPM_API_KEY`, and never calls either API directly.
- **Run state lives on the client.** The chosen playlist, its tracks + BPMs, the stage definitions and the filled result are held in React state on one builder page (optionally mirrored to `localStorage` so a refresh doesn't lose work). The server holds only tokens (cookies) and the BPM cache (JSON file). No database.
- **One shared track type.** Lives in `lib/types.ts`, created in F0, used everywhere after:
  ```ts
  interface Track {
    id: string          // Spotify track ID — also the BPM cache key
    uri: string         // spotify:track:… — needed for export
    name: string
    artists: string[]
    durationMs: number
  }
  interface TrackWithBpm extends Track {
    bpm: number | null
    bpmSource: BpmSource | null
  }
  ```
  `bpmSource: null` means "not resolved yet" (or the lookup errored); `bpmSource: 'api'` with `bpm: null` means "looked up, no match".
- **Tests.** Vitest, set up once in F0; F2 and F4 only add test files.
- **Spotify Dev Mode (Feb 2026 rules).** Only playlists the user owns are readable; endpoints and field names changed. Details in [F1](01-spotify-client.md).
- **Next.js version.** This is Next 16 — read `node_modules/next/dist/docs/` before touching routing, cookies, or middleware (e.g. middleware is now `proxy`, see `01-app/01-getting-started/16-proxy.md`).
- **Out of scope** (per CADENCE.md): playback, sources other than one playlist, recommendations, catalog-wide BPM search.

## Future work

- **Wrong-octave API BPMs.** GetSongBPM often returns half or double the real tempo (live: "Don't Stop Me Now" → 80, commonly cited ≈156). Such a track lands in the wrong stage, and the MVP has no way to fix it: dragging only writes a synthetic BPM, which never overrides an API value. Not settled. Suggestions so far:
  - ×2 / ÷2 buttons on each track row in the editor, saved as `manual` (the user doesn't love this).
  - Octave-aware distance in the fill: treat `bpm`, `2·bpm` and `bpm/2` as candidates.
  - A manual BPM entry field (`source: 'manual'` is already supported by the cache).
- **More BPM sources.** GetSongBPM's coverage is poor. Spotify itself is no option: `audio-features`/`audio-analysis` and `preview_url` are gone for new apps, Web Playback SDK audio is DRM-protected (can't reach Web Audio), and its terms forbid analysing content. Proposed resolver chain, first hit wins:
  1. **Deezer `bpm`** — `GET https://api.deezer.com/track/isrc:{ISRC}`, no auth, ISRC from Spotify's `external_ids.isrc`. Often `0` (= miss). The same response carries `preview`, kept for step 3.
  2. **ReccoBeats** — free audio-features API keyed by Spotify track ID.
  3. **Deezer preview + essentia.js** — 30s MP3, analysed with `RhythmExtractor2013`. Preview URLs are signed and expire, so fetch at analysis time; Deezer sends no CORS headers, so server-side.
  4. **iTunes preview + essentia.js** — `itunes.apple.com/lookup?isrc=…` (or `/search`), `previewUrl` is a 30s AAC.
  5. **GetSongBPM** — last resort.

  Notes:
  - Unverified until implementation: field names, Deezer `bpm` accuracy, ReccoBeats coverage, and whether Spotify Dev Mode still returns `external_ids`. Benchmark the sources on 30–50 tracks with known BPM before fixing the order; if Deezer and ReccoBeats disagree beyond an octave, essentia can break the tie.
  - Every source is subject to the wrong-octave problem above: fold all results into one canonical range and store the raw value alongside.
  - Record which provider answered (e.g. `provider` next to `source: 'api'`) so one bad provider's entries can be re-resolved.
  - essentia.js is **AGPL-3.0**; fine for this personal tool, revisit if that changes.
  - Steps 3–4 cost ~1–3s and ~500KB per track: cap concurrent analyses in the bulk-resolve route.

## Definition of done (MVP)

Log in → pick a playlist → define stages by duration + anchor → see the filled BPM profile → drag tracks around (misses get synthetic BPM) → export → the playlist appears in Spotify in exactly the order shown.
