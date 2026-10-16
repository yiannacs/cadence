# U4 — Fill view (unplaced → stages)

Back to [PLAN.md](PLAN.md)

## Goal

A focused view for one job: put Unplaced songs into stages. Unplaced on the left, every stage on the right — all of them on screen at once, so any stage is one short drag away.

## Scope

### Layout

`fill-view.tsx` keeps its `FillViewProps` (`{ result, onMove }`). The shell renders the result notices (stale build, merged stages, save error) above the view and the Export panel below it, in a scrolling region the height of the rest of the viewport (`#build-view` in `builder.tsx`). The view takes `h-full` with a two-column grid (`lg:grid-cols-2`, stacked below `lg`) and panes that scroll on their own; Export is then reached by scrolling the region past the view.

### 1. Left pane — Unplaced

- `orderUnplaced(result.unplaced)` (no-BPM first, then by BPM), each row a `DraggableTrack` from `dnd.tsx` (an `<li>`, so inside an `<ol>`): title, artist, duration, BPM, source badge.
- Scrolls on its own. Header: count, "N without a BPM", and the hint that dropping a no-BPM song into a stage gives it that stage's tempo for next time.
- Empty: "Every song is in a stage."

### 2. Right pane — compact stages

- One `DropZone` per stage, in run order (`DropZone` renders an `<li>`, so the cards sit in an `<ol>`). **Priority is that every stage is visible**; song lists give way first.
- Card header, always visible: direction glyph, label, center BPM, track count, total / target duration, shortfall in amber.
- Below the header, the stage's songs as one-line rows (title · artist, BPM), **clipped**: the pane is a column of the viewport's height; each card is `flex: 1 1 0` with `min-height` = header height and `overflow: hidden`, with a bottom fade when clipped. A stage with more songs than fit just shows fewer; the count is in the header.
- If even headers don't fit (many stages, small window), the pane scrolls — the fallback, not the design target.
- Songs in the right pane are **not draggable** here; moving between stages is Arrange's job. Anchor/co-anchor badges as in `TrackRow` (`trackBadge(result, id)` gives a song's badge).

### 3. Dropping

- Drop on any part of a stage card → `onMove(trackId, stageId)`. All of today's rules apply via `lib/editor.ts`: synthetic BPM for no-BPM songs, re-order by direction, live totals.
- Hover feedback: the card's border highlights; the header shows the stage's range so the user sees whether the song fits (out-of-range drops are allowed, as in the MVP).
- After a drop, the dropped song briefly highlights in its card (scrolled into view within the card if the list is clipped).
- Keyboard: `containerStepper(order)` over the stage cards' `droppableId`s (Unplaced isn't a target here); announcements via `trackAnnouncements(result, label)`, with `label` naming a stage by `result.labels`.

## Notes

- Uses the `dnd.tsx` pieces as they are. Clipping is a CSS concern of this view; don't change `DropZone` for it — wrap it.
- Nothing new in `lib/`; no new tests beyond what the move logic already has. If a helper emerges (e.g. which songs fit), put it in `lib/editor.ts` with a test.

## Acceptance

- With 4–6 stages on a 1080p-tall window, every stage header is visible without scrolling, however long the stages are.
- Dragging an unplaced no-BPM song onto a stage writes a synthetic entry (as in the MVP) and the stage's totals update.
- Works with the keyboard alone.
