# CADENCE.md 

Project context for Claude Code. Read this before writing anything.

## What we're building

cadence builds running playlists ordered by tempo. The user picks a song that *feels* right for each chunk of a run — warmup, build, peak, cooldown — and the app fills each chunk with tracks at a similar BPM, then exports the whole thing as one ordered playlist to the user's Spotify profile.

The point: the runner operates on vibes (pick a song that feels like the right pace), and the app does all the numeric BPM work. The user never types a BPM number.

## The single most important constraint

**Do NOT get BPM from Spotify.** Spotify deprecated its `audio-features` / `audio-analysis` endpoints on 2024-11-27; any app registered after that date gets a 403. There is no Spotify endpoint for tempo anymore.

BPM comes from **GetSongBPM** (free, name-based: send artist + title, get BPM + key back). The key is in `GETSONGBPM_API_KEY`. Matching is fuzzy — remixes, live versions, and obscure tracks will miss. That's expected; the app handles misses (see Synthetic BPM below).

## Core model

- The user defines `n` **stages**.
- Each stage has a **duration** `d_i` (target amount of music).
- Each stage has an **anchor song** `a_i`. The anchor's only job is to set the stage's target BPM — the user chooses by feel, never by number. anchor BPM → stage center BPM.
- Stages are in **run order**, which the user sets. Each stage owns a **BPM range** bounded by the midpoints between its anchor and its run-order neighbours' anchors: a neighbour with a higher BPM sets the upper bound, one with a lower BPM sets the lower bound; no neighbour on a side → unbounded on that side. Contiguous stages therefore never overlap; an anchor may sit at the edge of its own range.
- **Contiguous stages may not have equal anchor BPMs.** The app tells the user and merges them into one stage. Non-contiguous stages may share a BPM.
- Non-contiguous stages **can overlap** (e.g. warmup and cooldown both covering the slow end). Tracks in an overlap are allocated **randomly** (seeded, so a build is reproducible) to one of the stages covering them.
- The app fills each stage from its range with the nearest-BPM tracks until the stage's total track length ≥ `d_i`.
- A track used in one stage is **not reused** in another (dedupe across stages). The anchor is always included in its own stage.
- **Order within a stage** is derived from the neighbouring anchors — the user never tags stages as warmup/cooldown:
  - lower → this → higher: ascending; higher → this → lower: descending;
  - both neighbours lower (peak): up, then down; both higher (valley): down, then up;
  - first stage: towards the next anchor; last stage: continues the direction coming in; single stage: ascending.
- Net effect: each stage is a plateau around its anchor BPM, and ordering by direction makes the seams smooth — a stage ends near the boundary it shares with the next one. The output is a clean BPM profile the user can eyeball and re-drag in Spotify if they want.

### Fill algorithm (per stage)

1. Pool = the stage's anchor + source-playlist tracks with a known BPM (from cache: api / manual / synthetic) that fall in the stage's range (overlap tracks: only those allocated to this stage). Other stages' anchors are never in the pool.
2. Sort candidates by `|bpm − anchorBPM|` ascending.
3. Greedily add tracks until `sum(durationMs) ≥ d_i`. Always include the anchor.
4. If the range runs out first, the stage comes up short — it never borrows across a contiguous boundary. Overlap tracks a stage didn't need may go to another stage covering them that is still short.
5. For output order, order the chosen tracks by the stage's direction.
6. Tracks with no BPM are excluded from auto-fill but stay available for the user to drag in manually.

## BPM cache + provenance (build this carefully)

Cache BPM per Spotify **track ID**, in a JSON file for the MVP (e.g. `data/bpm-cache.json`; SQLite is a later upgrade).

Each entry:

```json
{ "bpm": 152, "tolerance": null, "source": "api", "updatedAt": "2026-06-17T..." }
```

`source` is one of `"api" | "manual" | "synthetic"`. `tolerance` is optional and mainly used by synthetic entries (null otherwise).

**Precedence rule, non-negotiable:** a real BPM always wins over a guess — `synthetic < api < manual`. Synthetic never overwrites an api or manual *value*, and api never overwrites manual. The one exception: a synthetic value may replace an api *miss* (`bpm: null`), since that's exactly the case synthetic exists for. A miss never erases a value. This keeps real data distinguishable from guesses so the cache doesn't rot into self-confirming nonsense.

### Synthetic BPM (how misses get resolved)

When a track has no BPM match, the user drags it into a stage. On drop, cache a **synthetic** entry for that track: `bpm` = the stage's center BPM, `tolerance` = the stage's BPM spread, `source` = `"synthetic"`. Next run, that track already has a usable value and slots into a similar-tempo stage automatically. A later real lookup or explicit manual entry may overwrite a synthetic value — never the reverse.

## Spotify integration

- **Auth:** OAuth Authorization Code flow. Keep the client secret server-side.
- **Scopes:** `playlist-read-private`, `playlist-modify-private`, `playlist-modify-public`.
- **Redirect URI:** `http://127.0.0.1:3000/api/callback` — must match the Spotify dashboard exactly (note: `127.0.0.1`, not `localhost`).
- **Reads:** the user's playlists; the tracks of the chosen playlist (id, name, artist(s), duration_ms). Under Spotify's Development Mode rules (Feb 2026), only playlists the user **owns** can be read.
- **Writes:** create a new playlist on the user's profile; add the staged tracks in order.
- **No playback.** Web Playback SDK is out of scope. Export only — the user plays in Spotify itself.

## Stack

- **Next.js (App Router) + TypeScript**, single app.
- **Route Handlers** (server) for Spotify OAuth and all GetSongBPM calls — keeps secrets off the client and avoids CORS.
- **React + @dnd-kit** for the stage editor (drag tracks between stages; synthetic-BPM caching fires on drop).
- **JSON file** for the BPM cache (MVP).
- Plain `fetch` against the Spotify and GetSongBPM REST APIs — thin wrappers are fine, no heavy SDKs needed.

## Environment

`.env.local` in the project root (already gitignored — the repo is public, never commit it):

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/callback
GETSONGBPM_API_KEY=...
```

## Build order

Start here, in this order — don't scaffold everything at once:

1. **Spotify OAuth handshake** — login button, redirect, callback route, token exchange, token storage (a simple server session/cookie is fine; single local user).
2. **BPM cache module** — read/write the JSON cache with the `source` provenance flag and precedence rule above; expose a `getBpm(trackId, artist, title)` that checks cache → GetSongBPM → caches the result.

Then, once those two work: pick a source playlist → fetch + cache BPM for its tracks → stage builder + fill algorithm → @dnd-kit editor + synthetic caching → export to Spotify.

## Out of scope for the MVP (do not build)

- In-app playback.
- Sources other than one user-chosen playlist (liked songs / whole catalog come later).
- "Find similar songs by attribute" / recommendations — Spotify killed those endpoints too.
- Catalog-wide BPM search — structurally impossible (you can't filter Spotify's catalog by tempo; you can only look up BPM for tracks you already hold). Don't attempt it.

## UX flow (MVP)

1. Log in with Spotify.
2. Pick a source playlist.
3. Define stages: for each, set a duration and pick an anchor song from the playlist.
4. App fetches/caches BPM and fills each stage (nearest-to-anchor, sorted, deduped, until duration met).
5. Show the staged result; user can drag any/unmatched tracks between stages (synthetic BPM cached on drop). Stages are re-ordered by their direction after each drop.
6. Export → saves the ordered playlist to Spotify.

---

Keep the UI minimal and legible — this is a personal tool, not a product. Clarity over polish.