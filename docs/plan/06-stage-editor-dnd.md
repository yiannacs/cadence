# F6 — Drag-and-drop stage editor + synthetic BPM

Back to [PLAN.md](PLAN.md)

## Goal

UX step 5: show the staged result as columns/rows per stage plus an "Unplaced" bin, let the user drag any track between them, and cache a **synthetic** BPM when a no-BPM track is dropped into a stage.

## Scope

1. **Install `@dnd-kit/core`** (6.3.1; peer `react >=16.8`, works with React 19). `@dnd-kit/sortable` isn't needed: nobody hand-orders tracks within a stage (see 3).
2. **Layout** — one container per stage (in run order) + one "Unplaced" container (no-BPM tracks first, then leftover tracks with BPM). Each track row: title, artist, duration, BPM + source badge.
3. **Drag behaviour**
   - Move between any two containers, including back to Unplaced.
   - After every drop, the affected stages are re-ordered by their **direction** (ascending / descending / up-then-down / down-then-up, fixed at build time) via `recomputeStage` (F4) — the user isn't hand-ordering *within* a stage; Spotify itself is where they fine-tune order if they want.
   - Dropping a track outside the stage's BPM range is allowed — it's a manual override.
   - The anchor is draggable within the UI but **cannot leave its own stage** (it's guaranteed to be included). Visually mark the anchor.
   - Dropped no-BPM tracks need a position: order them as if their BPM = stage center. Set the synthetic BPM on the client's copy of the track *before* calling `recomputeStage`.
4. **Synthetic caching on drop** — `POST /api/bpm/synthetic { trackId, bpm: centerBpm, tolerance: spreadBpm }` → `cache.set(..., source: 'synthetic')`. Requires the session cookie, like all `/api/bpm/*` routes (see F3). The body must be exactly those three keys (base62 `trackId`, `0 < bpm ≤ 400`, `0 ≤ tolerance ≤ 400`), else `400`. Returns the entry the cache actually holds, `{ bpm, tolerance, bpmSource }`; when that's a real value that outranked the guess, the client uses it instead.
   - Fire **only** when the track's current BPM is `null`, or its current source is already `synthetic` (re-dropping into a different stage updates the guess).
   - Never for `api` / `manual` tracks — the cache's precedence rule would reject it anyway, but don't send the request.
   - Update the client's copy of the track so the badge flips to `synthetic` immediately — in the result and in the playlist's track list, so the next Build uses it too (the result's `key` is carried over, so this doesn't mark it stale).
   - Requests go out one at a time, in drop order, so the cache ends up with the last guess. A failed write leaves the guess in the current build and says it won't be remembered.
5. **Live totals** per stage (duration vs target) update as tracks move.

## Keyboard

Each track has a drag handle. dnd-kit's `KeyboardSensor` with a custom coordinate getter: Space/Enter picks the track up, the arrow keys jump it to the next / previous container, Space/Enter drops it, Escape cancels. Screen-reader announcements name the track and the stage.

## Notes

- Works on F5's `BuildResult` (`lib/stages.ts`) in place of F5's read-only result view, and sets `edited: true` on the first move so rebuilding asks before discarding it. The edited result stays in `StageBuilder`'s state, where F7 reads it; it isn't persisted.
- Move logic lives in `lib/editor.ts` (pure, unit-tested): `checkMove`, `moveTrack` (returns the new result plus the synthetic write to send, if any), `orderUnplaced`, and the route's body validation. The UI is `app/build/[playlistId]/stage-editor.tsx`.
- Unplaced order: no-BPM tracks first in the order they arrived, then the rest by BPM. A track moved back to Unplaced keeps its (synthetic) BPM; the cache has no delete.
- A track whose BPM lies outside its stage's range shows its BPM highlighted.
- Correcting wrong-octave API BPMs (e.g. half-time) is not in the MVP — see "Future work" in [PLAN.md](PLAN.md).

## Acceptance

- Dragging a no-BPM track into the "peak" stage writes a synthetic entry with that stage's center + spread to `data/bpm-cache.json`.
- Reloading and rebuilding with the same stages auto-places that track in a similar-tempo stage.
- Dropping a track with an `api` BPM writes nothing to the cache.
