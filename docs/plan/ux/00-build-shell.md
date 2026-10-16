# U0 — Build-page shell

Back to [PLAN.md](PLAN.md)

## Goal

Restructure `/build/[playlistId]` into a shell with three views (Anchors, Fill, Arrange), so U3, U4 and U5 can each build one view in parallel without touching the same files. **Behaviour-preserving**: after U0 the app does what it does today, just arranged in views.

## Scope

### 1. Lift build state — `app/build/[playlistId]/use-build.ts`

Move the state and handlers out of `stage-builder.tsx` into a hook, unchanged in behaviour:

- `stages` + `dispatch` (the `stagesReducer`, loaded from and saved to `localStorage`);
- `problems`, `buildable`, `stale`, `result`;
- `build()` (with the "replaces your changes" confirm), `move(trackId, to)` (the synthetic-write queue and `saveError`).

`builder.tsx` calls `useTrackList` and `useBuild` and passes slices to the views.

### 2. Views — one file each, fixed props

| File | Props | U0 content |
|---|---|---|
| `anchor-view.tsx` | `{ playlist, tracks, failed, resolving, stages, dispatch, problems, buildable, built, onBuild }` (`built`: a result exists, so the button reads "Build again") | Today's stage list (`StageRow`, `AnchorPicker`), Build button and `TrackTable`, moved here unchanged |
| `fill-view.tsx` | `{ result, onMove }` | Placeholder line ("coming soon"); U4 builds it |
| `arrange-view.tsx` | `{ result, onMove }` | Today's `StageEditor`, minus the notices moved to the shell |

`onMove: (trackId: string, to: Container) => void` is `useBuild().move`. Views never call the API themselves.

### 3. Shell — `builder.tsx`

- Page uses the full width (`max-w-none`, side padding). Header: playlist name, back link, the BPM resolution status (summary, progress bar, stop message, Retry) — visible in every view.
- **View tabs**: Anchors · Fill · Arrange. Fill and Arrange are disabled until there's a result. Build switches to Fill. The current view is component state (not persisted, not in the URL).
- **Result notices** move out of `StageEditor` into the shell, shown above Fill and Arrange: the stale-build notice, merged-stages notice and synthetic-save error.
- `ExportPanel` renders below the Fill and Arrange views.
- Views below the header get the remaining viewport height (`flex-1 min-h-0` down from a `h-dvh` column), so U3/U4 can make their panes scroll independently. Single-pane views simply scroll the page.

### 4. Shared drag-and-drop pieces — `app/build/[playlistId]/dnd.tsx`

Extract from `stage-editor.tsx`, no behaviour change:

- `droppableId` / `containerOf`, `collisionDetection` (pointer first, then rect intersection), `containerStepper(order)` (arrow keys jump between containers);
- `TrackRow` with a `badge?: 'anchor' | 'co-anchor'` prop (replacing `anchor: boolean`), `DraggableTrack`, `DropZone` + `DropHint`;
- `trackAnnouncements(result, label)` — the announcement builder, so every view announces the same way.
- Move `formatDuration` and `SourceBadge` out of `track-table.tsx` into `format.tsx`, so U3 can delete `track-table.tsx` without breaking U4/U5.

### 5. Docs

Update the "UX flow" section of `docs/CADENCE.md` to the flow in [PLAN.md](PLAN.md) ("What changes"). Steps 3 and 5 change; the core model doesn't.

## Notes

- Keep `StageBuilder`'s comments where the code moves; delete `stage-builder.tsx` once empty.
- Prop names above are the contract for wave 2 — if one turns out wrong, change it in U0 before wave 2 starts.

## Acceptance

- `npm test`, `tsc`, `eslint` and `next build` pass.
- The full MVP flow works through the tabs: pick anchors → Build (lands on Fill) → Arrange tab drags work exactly as before → export.
- The Fill and Arrange tabs are disabled before the first Build; the resolution status stays visible in every view.
