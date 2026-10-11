# F6 — Drag-and-drop stage editor + synthetic BPM

Back to [PLAN.md](PLAN.md)

## Goal

UX step 5: show the staged result as columns/rows per stage plus an "Unplaced" bin, let the user drag any track between them, and cache a **synthetic** BPM when a no-BPM track is dropped into a stage.

## Scope

1. **Install `@dnd-kit/core` + `@dnd-kit/sortable`.** Check current versions and their React 19 compatibility.
2. **Layout** — one container per stage (in run order) + one "Unplaced" container (no-BPM tracks first, then leftover tracks with BPM). Each track row: title, artist, duration, BPM + source badge.
3. **Drag behaviour**
   - Move between any two containers, including back to Unplaced.
   - After every drop, the affected stages are re-ordered by their **direction** (ascending / descending / up-then-down / down-then-up, fixed at build time) via `recomputeStage` (F4) — the user isn't hand-ordering *within* a stage; Spotify itself is where they fine-tune order if they want.
   - Dropping a track outside the stage's BPM range is allowed — it's a manual override.
   - The anchor is draggable within the UI but **cannot leave its own stage** (it's guaranteed to be included). Visually mark the anchor.
   - Dropped no-BPM tracks need a position: order them as if their BPM = stage center. Set the synthetic BPM on the client's copy of the track *before* calling `recomputeStage`.
4. **Synthetic caching on drop** — `POST /api/bpm/synthetic { trackId, bpm: centerBpm, tolerance: spreadBpm }` → `cache.set(..., source: 'synthetic')`.
   - Fire **only** when the track's current BPM is `null`, or its current source is already `synthetic` (re-dropping into a different stage updates the guess).
   - Never for `api` / `manual` tracks — the cache's precedence rule would reject it anyway, but don't send the request.
   - Update the client's copy of the track so the badge flips to `synthetic` immediately.
5. **Live totals** per stage (duration vs target) update as tracks move.

## Optional (nice to have, not required for MVP)

- Correcting wrong-octave API BPMs (e.g. half-time) is **not** in the MVP — see "Future work" in [PLAN.md](PLAN.md).
- Keyboard drag support (dnd-kit's `KeyboardSensor`).

## Acceptance

- Dragging a no-BPM track into the "peak" stage writes a synthetic entry with that stage's center + spread to `data/bpm-cache.json`.
- Reloading and rebuilding with the same stages auto-places that track in a similar-tempo stage.
- Dropping a track with an `api` BPM writes nothing to the cache.
