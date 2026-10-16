# U2 — Co-anchors in the fill

Back to [PLAN.md](PLAN.md)

## Goal

Let a stage hold extra **pinned** songs besides its anchor, so two contiguous same-BPM anchors can both stay in the run: the first sets the tempo, the second (a **co-anchor**) is always included in the same stage. Pure `lib/` work, no UI.

## Model

- A co-anchor is the existing equal-contiguous merge, made visible. `mergeEqualContiguous` already folds stage B into stage A when their anchor BPMs are equal (A's anchor and name, durations summed). It now also keeps B's anchor (and B's own co-anchors) as A's co-anchors instead of dropping them back into the pool.
- Co-anchors are pinned regardless of their BPM. In practice they share the anchor's BPM, so they'd sit at distance 0 anyway; pinning makes inclusion certain even when the anchor alone meets the duration.
- A co-anchor is placed like a regular track for ordering (by its BPM and the stage's direction) and counts towards the stage's duration and spread.

## Scope

### `lib/fill.ts`

- `StageSpec` gains `pinnedTrackIds?: string[]` (absent = none). `FilledStage` gains `pinnedTrackIds: string[]`.
- `validateStages` — new blocking reasons:
  - `pinned-missing`: a pinned ID isn't in the pool;
  - `pinned-no-bpm`: a pinned track has no BPM (it can't have been placed by tempo);
  - `duplicate-anchor` extends to pinned tracks: a track may appear once across all anchors and pinned lists.
- `fillStages` — pinned tracks are excluded from allocation (like anchors) and added right after the anchor, before the greedy fill. Other stages never see them.
- `mergeEqualContiguous` — the merged stage's `pinnedTrackIds` = A's pinned + B's anchor + B's pinned, in run order.
- `recomputeStage` — keeps `pinnedTrackIds`; throws if a pinned track is missing, as it does for the anchor.
- Update `assertInvariants` in the tests: every stage contains its pinned tracks.

### `lib/editor.ts`

- `checkMove` refuses moving a pinned track out of its stage, like the anchor (refusal `'anchor'`; the UI says "anchors stay in their stage"). The user put it in the run on purpose; removing it is done on the Anchors view.

## Tests

- Fill: pinned track always included, even when the anchor alone meets the duration; never appears in another stage or in `unplaced`; ordered by direction.
- Validation: missing pinned, pinned without BPM, track pinned in two stages, track both anchor and pinned.
- Merge: a pair → B's anchor becomes A's co-anchor; a run of three → two co-anchors in order; B's own co-anchors carried over.
- `recomputeStage` without a pinned track → throws. `checkMove` refuses moving a pinned track out.
- Existing tests unchanged apart from the new `pinnedTrackIds: []` field in expected output.

## Acceptance

- `npm test` passes; the old merge tests now also assert the second anchor is kept as a co-anchor.
