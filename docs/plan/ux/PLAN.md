# cadence — UX rework plan

Follows the MVP plan ([`../PLAN.md`](../PLAN.md)), which is fully implemented. Source of truth for *what* to build stays [`../../CADENCE.md`](../../CADENCE.md); U0 updates its "UX flow" section to match this plan. This file covers *how*: the order of the work and links to one spec per feature.

## What changes

- The window title is `cadence`, and the playlist picker and the song list each get a search box.
- The build page is split into three views: **Anchors** (pick anchors), **Fill** (add unplaced songs to stages) and **Arrange** (move songs between stages). Export sits below the two result views.
- **Anchors:** two panes. Left: every song in the playlist, sorted by ascending BPM once lookups finish, no-BPM songs at the bottom. Right: the run. Dragging a song with a BPM to the right pane makes it a stage's anchor. A song with the same BPM as a neighbouring stage's anchor joins that stage as a **co-anchor**: it shows on the right pane and is always included in the stage, but only the first song sets the tempo.
- **Fill:** two panes. Left: Unplaced. Right: every stage, compact enough that all of them fit on screen (song lists truncated). Dropping an unplaced song on a stage adds it.
- **Arrange:** one pane, every song of every stage visible, plus the Unplaced bin. Picking a song up collapses all stages to their headers, so the destination is a short move away.

## Features

| # | Feature | Depends on | Spec |
|---|---|---|---|
| U0 | Build-page shell: views, lifted state, shared drag-and-drop pieces | — | [00-build-shell.md](00-build-shell.md) |
| U1 | Window title + playlist search | — | [01-title-and-search.md](01-title-and-search.md) |
| U2 | Co-anchors in the fill | — | [02-co-anchors.md](02-co-anchors.md) |
| U3 | Anchors view (two-pane anchor board) | U0, U1, U2 | [03-anchors-view.md](03-anchors-view.md) |
| U4 | Fill view (unplaced → stages) | U0, U2 | [04-fill-view.md](04-fill-view.md) |
| U5 | Arrange view (collapse on pickup) | U0, U2 | [05-arrange-view.md](05-arrange-view.md) |

```
wave 1          wave 2
U0 ──────────┬─► U3   (also needs U1, U2)
U1 ──────────┤
U2 ──────────┼─► U4   (needs U0, U2)
             └─► U5   (needs U0, U2)
```

**Wave 1** — U0, U1 and U2 are independent and run in parallel: U0 touches only `app/build/[playlistId]/*` and `CADENCE.md`, U1 only `app/layout.tsx`, `app/build/page.tsx` and a new `lib/search.ts`, and U2 only `lib/fill.ts` and `lib/editor.ts` (+ tests).

**Wave 2** — U3, U4 and U5 run in parallel. U0 gives each view its own file and fixes the props it receives, so each feature edits only its own view file plus the files it owns:

| Feature | Owns |
|---|---|
| U3 | `anchor-view.tsx`, `lib/stages.ts`, `package.json` (`@dnd-kit/sortable`); removes `stage-row.tsx`, `anchor-picker.tsx`, `track-table.tsx` |
| U4 | `fill-view.tsx` |
| U5 | `arrange-view.tsx`; removes `stage-editor.tsx` |

Shared pieces in `dnd.tsx` (from U0) are used as is. If a wave-2 feature needs to change them, it adds an option rather than changing existing behaviour, and says so in its commit.

## Cross-cutting decisions

- **No model changes beyond co-anchors.** Ranges, directions, overlap allocation, synthetic BPM and export work as in the MVP. The co-anchor is the existing equal-contiguous merge, made visible: today's merge sums durations and drops the second anchor; with U2 the second anchor stays in the merged stage, pinned.
- **Same drag-and-drop stack.** `@dnd-kit/core` 6.3.1 everywhere. U3 adds `@dnd-kit/sortable` 10.0.0 (peer `@dnd-kit/core ^6.3.0`) for reordering the run. Every drag has a keyboard path (dnd-kit `KeyboardSensor`) and screen-reader announcements, as in the MVP editor.
- **Pure logic stays in `lib/`, unit-tested.** Views stay thin: anything worth testing (sorting, grouping, move rules) is a pure function in `lib/`.
- **Layout.** The build page uses the full window width. Two-pane views fill the viewport height below the page header and their panes scroll independently. Below the `lg` breakpoint the panes stack — this is a desktop tool, so narrow screens only need to work, not shine.
- **Next.js 16.** Read `node_modules/next/dist/docs/` before touching metadata, routing or layouts.

## Definition of done

Log in → search for and pick a playlist → drag anchors into the run (same-BPM songs join their neighbour as co-anchors), set durations → Build → add unplaced songs to stages in Fill → move songs between stages in Arrange, with the stages collapsing on pickup → export. The tab says `cadence` throughout.
