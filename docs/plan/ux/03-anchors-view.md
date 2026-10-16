# U3 — Anchors view (two-pane anchor board)

Back to [PLAN.md](PLAN.md)

## Goal

Pick anchors by dragging songs from the playlist into the run, instead of opening a picker per stage. Left pane: every song. Right pane: the run, one card per stage.

## Scope

### 1. Draft model — `lib/stages.ts`

- `StageDraft` becomes `{ id, name, durationMs, songIds: string[] }`: `songIds[0]` is the anchor, the rest are co-anchors (U2). Never empty — a stage exists only because a song was dropped.
- `toSpecs` maps `songIds[0]` → `anchorTrackId`, the rest → `pinnedTrackIds`.
- Reducer actions (replacing `add` and `set-anchor`):
  - `place { trackId, index }` — drop a song into the gap before stage `index`. If the song's BPM equals the anchor BPM of the stage just before or just after the gap, the song joins that stage as a co-anchor (before wins if both match). Otherwise a new stage is inserted at `index`: name `''`, duration = the previous stage's (or 5 min).
  - `unplace { trackId }` — removes a song from its stage. If it was the anchor, the first co-anchor becomes the anchor. A stage left empty is removed.
  - `move { id, toIndex }` — reorder a stage (from the sortable drag or the ↑/↓ buttons).
  - `rename`, `set-duration` as today; `remove { id }` removes a stage and all its songs.
- **Grouping is kept up to date**: after every action, contiguous stages whose anchors have equal BPMs are merged (first stage's id and name, durations summed, songs concatenated). Every action carries `bpmById` (the tracks' current BPMs), so the reducer stays pure. `mergeEqualContiguous` at Build remains as a safety net (e.g. a BPM changed after placing).
- `validateDrafts` drops the "unpicked stage" noise filter (no stage is unpicked any more). `buildKey` includes every song ID.
- `problemMessage` already words U2's `pinned-missing` and `pinned-no-bpm`; adjust the wording to the board if needed (e.g. point at the card's co-anchor row).
- Default run: empty. The `warmup / build / peak / cooldown` template goes away — names are optional and stages appear as songs are dropped.
- `localStorage` version 2. A v1 value migrates: stages with an anchor become `songIds: [anchorTrackId]`; stages without one are dropped.
- `filterTracks` uses `matchesQuery` from `lib/search.ts` (U1).
- New `sortForBoard(tracks)`: ascending BPM, ties by title then ID; no-BPM tracks at the bottom in playlist order.

### 2. Left pane — the song list

- Replaces `TrackTable`: title, artist, duration, BPM, source badge, and the per-track lookup error as today.
- **Sort:** playlist order while BPM lookups are running; `sortForBoard` once the resolution pass finishes (the view's `resolving` prop turns false). Sorting mid-lookup would make rows jump under the cursor.
- Per-track lookup errors come from the `failed` prop (track ID → message).
- **Search** box at the top (title/artist via `filterTracks`).
- Songs with a BPM are draggable. No-BPM songs are greyed with "no BPM — can't anchor" (or "BPM lookup pending"), not draggable. Songs already in the run are marked with their stage's label and not draggable from the left (drag them on the right instead).
- Dropping a song from the right pane back onto the left pane = `unplace`.

### Layout

The shell gives the view a scrolling region the height of the rest of the viewport (`#build-view` in `builder.tsx`). The view takes `h-full` with a two-column grid (`lg:grid-cols-2`, stacked below `lg`), each pane `min-h-0 overflow-y-auto`, so the panes scroll independently and the region itself doesn't. The Anchors tab has no Export panel below it.

The view's props are fixed by U0: `{ playlist, tracks, failed, resolving, stages, dispatch, problems, buildable, built, onBuild }`. `built` (a result exists) makes the button read "Build again" and shows the re-roll hint; `onBuild` runs the Build and switches to Fill. The open-picker state in today's `anchor-view.tsx` goes away with the picker.

### 3. Right pane — the run

- One sortable card per stage (`@dnd-kit/sortable` 10.0.0, `verticalListSortingStrategy`), in run order, numbered.
- Card: name input, duration input (minutes), ↑/↓/✕ buttons (kept for keyboard and precision), the anchor song, and co-anchors listed under it with a "same tempo" badge. Each song row has its own handle; dragging it to the left pane unplaces it. The card shows the anchor's BPM as secondary text.
- **Dropping from the left:** the drop position between cards decides `index` (sortable's insertion index while dragging over the list; an empty run accepts a drop anywhere). Show an insertion line while hovering. If the song would join a neighbour as co-anchor, highlight that card instead of the gap.
- Per-stage problems and the "run length" total as today, the Build button at the bottom of the pane (sticky).

### 4. Keyboard

- Left pane: the handle picks a song up; arrow keys move the insertion point through the gaps of the run; Space/Enter drops; Escape cancels. Plus an "Add to run" button on each row (appends at the end) for a no-drag path.
- Right pane: sortable's keyboard coordinates for reordering stages.
- Announcements: "Picked up X", "X will start a new stage after Y", "X will join Y (same tempo)", "X removed from the run". These are the view's own `Announcements`; `trackAnnouncements` in `dnd.tsx` is for moves within a result and doesn't fit here.
- `TrackRow` (`dnd.tsx`) with `badge="anchor"` / `badge="co-anchor"` can render the song rows; `DropZone` and `droppableId` are keyed by result containers, so the board uses its own droppable IDs (e.g. `board`, `gap:<index>`).

### 5. Cleanup

Delete `stage-row.tsx`, `anchor-picker.tsx` and `track-table.tsx` once unused (`formatDuration` and `SourceBadge` already live in `format.tsx`, from U0).

## Tests (`lib/stages.test.ts`)

- `place`: new stage at start / middle / end; joins the stage before when BPMs match; joins after; before wins when both match.
- `unplace`: co-anchor removed; anchor removed → first co-anchor promoted; last song removed → stage gone.
- `move` making two equal-BPM stages contiguous → merged, durations summed.
- v1 → v2 storage migration; `sortForBoard` ordering.

## Acceptance

- Starting from an empty run, the user drags four songs into the right pane, sets durations, and builds — no picker, no typed BPM.
- Dragging a song whose BPM equals its neighbour's anchor shows both on the card; after Build that song is in the stage.
- The left pane is sorted by BPM (no-BPM at the bottom) once lookups finish, and doesn't reorder while they run.
- Every drag works from the keyboard.
