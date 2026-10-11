# cadence — implementation plan

Source of truth for *what* to build: [`../CADENCE.md`](../CADENCE.md). This file covers *how*: the order of the work and links to one spec per feature.

## Current state (as of `e6a24d0`)

| Area | Status | Where |
|---|---|---|
| Spotify OAuth (login / callback / logout, cookie tokens, refresh helper) | **Done** | `app/api/{login,callback,logout}`, `lib/spotify/auth.ts` |
| BPM cache storage (JSON file, provenance, miss TTL) | **Done, but buggy** — precedence rule blocks synthetic-over-miss; fixed in F2 | `lib/bpm/cache.ts`, `lib/bpm/types.ts` |
| GetSongBPM client + `getBpm()` resolver | Not started | → [F2](02-getsongbpm-resolver.md) |
| Everything after build-order step 2 | Not started | → F3–F7 |

Build-order step 1 is complete. Step 2 is half done: storage exists, but the network half (`getBpm(trackId, artist, title)`) does not.

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

- **Server/client split.** All Spotify and GetSongBPM calls live in Route Handlers or Server Components. The browser never sees `SPOTIFY_CLIENT_SECRET` or `GETSONGBPM_API_KEY`, and never calls either API directly.
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

## Open questions

- **F4 fill algorithm** — under discussion: partitioning BPM space between neighbouring anchors (midpoint thresholds), equal-BPM anchors, and per-stage direction (ascending / descending / ramp) derived from the surrounding anchors. F4's spec will be rewritten once settled.
- **Half-time / double-time API values** (e.g. "Don't Stop Me Now" → 80) — how the user corrects them.

## Definition of done (MVP)

Log in → pick a playlist → define stages by duration + anchor → see the filled BPM staircase → drag tracks around (misses get synthetic BPM) → export → the playlist appears in Spotify in exactly the order shown.
