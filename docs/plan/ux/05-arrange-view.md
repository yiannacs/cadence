# U5 — Arrange view (collapse on pickup)

Back to [PLAN.md](PLAN.md)

## Goal

Move songs between stages with little mouse travel. One pane shows every song of every stage; picking a song up collapses all stages to their headers, so the destination is close by. Dropping (or cancelling) expands them again.

## Scope

### 1. Layout at rest

- Today's editor, one column: a `DropZone` per stage with header (glyph, label, center BPM, range, count, total / target, shortfall) and **every** song, then the Unplaced bin (collapsed by default to its header + count, expandable).
- Every song is draggable except anchors and co-anchors (U2), which are marked and can't leave their stage.

### 2. Collapse on pickup

- On drag start, render every stage (and Unplaced) as its header only — about one line each. The dragged song follows the pointer in the `DragOverlay`, so it stays visible while its source list collapses.
- **Keep the source under the pointer.** Collapsing shifts everything up. Right after the collapsed layout renders (`useLayoutEffect`), scroll so the source stage's header sits at the pointer's Y position (pointer Y from the activator event; for keyboard drags, keep the source header where the handle was). Clamp at the top of the page.
- **Measure after collapsing.** Droppable rects must reflect the collapsed layout: `DndContext measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}`. Without it, drops land on where stages *were*.
- On drop or cancel: expand, then scroll so the destination stage's header is where the pointer was (or `scrollIntoView({ block: 'nearest' })` if that's off-page). The moved song highlights briefly in its new place.
- Collapsed headers are the drop targets: border highlight when allowed, red with "Anchors stay in their stage" when refused, as today.
- A short transition on collapse/expand is fine, but measurement must run after it settles — prefer no animation over drops that miss.

### 3. Keyboard

- Space/Enter picks up → same collapse; arrow keys step through the collapsed headers (`containerStepper`); Space/Enter drops; Escape cancels and expands. Announcements via `trackAnnouncements`.

## Notes

- Delete `stage-editor.tsx` once this view replaces it.
- The collapse state is local to the view; `result` and `onMove` are untouched.
- If `MeasuringStrategy.Always` proves too slow with long stages, `measureDroppableContainers` (from `useDndContext`) right after the collapse is the alternative.
- Pure helpers (e.g. computing the scroll offset from the header's new rect and the pointer Y) go in `lib/editor.ts` with tests, if they're more than a line.

## Acceptance

- Grabbing a song in the last of five long stages and dropping it on the first stage needs a short mouse move, not a page-long drag.
- The song under the pointer at pickup is still under the pointer after the collapse.
- Drops land on the stage under the pointer in the collapsed layout (no off-by-one-stage drops).
- Escape restores the layout and scroll position; the keyboard path works end to end.
