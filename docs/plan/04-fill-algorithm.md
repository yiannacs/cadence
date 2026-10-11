# F4 — Fill algorithm

Back to [PLAN.md](PLAN.md)

## Goal

A pure, deterministic function implementing "plateau + sort" from CADENCE.md. No I/O, no React — so it can be unit-tested exhaustively and run on the client for instant re-fills.

## Scope

1. **Add Vitest** (`npm i -D vitest`, `"test": "vitest"` script). First tests in the repo.
2. **`lib/stages/fill.ts`**

```ts
interface StageSpec {
  id: string
  durationMs: number
  anchorTrackId: string
}

interface FilledStage {
  id: string
  centerBpm: number          // = anchor BPM
  spreadBpm: number          // used as synthetic tolerance in F6
  tracks: TrackWithBpm[]     // sorted ascending by BPM
  totalMs: number
  shortfallMs: number        // > 0 if the pool ran dry
}

function fillStages(stages: StageSpec[], pool: TrackWithBpm[]): {
  stages: FilledStage[]
  unplaced: TrackWithBpm[]   // includes all no-BPM tracks
}
```

3. **Algorithm** (per CADENCE.md, plus the edge cases it implies):
   1. **Reserve all anchors up front.** Otherwise stage 1 can greedily consume stage 3's anchor and break the "anchor is always in its own stage" guarantee.
   2. For each stage in order: candidates = pool − used − reserved anchors − tracks with `bpm === null`.
   3. Start the selection with the anchor. Sort candidates by `|bpm − anchorBpm|`; tie-break deterministically (e.g. by track ID) so results are stable between runs.
   4. Add until `totalMs ≥ durationMs`.
   5. Sort the selection by BPM ascending (tie-break by ID). Mark all as used.
   6. `unplaced` = everything not used, including no-BPM tracks.
4. **`spreadBpm` definition** — pick one and document it: half the BPM range of the stage's tracks (`(max − min) / 2`) is the most natural "tolerance" around the center. Fall back to a small constant (e.g. 3) for single-track stages.
5. **`recomputeStage(stage)`** helper — recompute totals, center, spread and sort after a manual edit in F6 (center stays = anchor BPM).

## Edge cases to test

- Anchor has no BPM → caller must prevent this (F5), but `fillStages` should throw a clear error rather than silently misbehave.
- Same track chosen as anchor for two stages → error.
- Pool exhausted before duration met → stage returned with `shortfallMs > 0`, no crash.
- Anchor alone already exceeds the duration → stage = just the anchor.
- Two anchors with identical BPM → both stages still fill, no track reused.
- Output order across stages forms a staircase when anchors ascend.

## Acceptance

- `npm test` passes with the cases above.
- Function is deterministic: same input → identical output.
