# F4 — Fill algorithm

Back to [PLAN.md](PLAN.md)

## Goal

A pure, deterministic function that turns stage specs + the playlist's tracks into filled, ordered stages. No I/O, no React, no imports from server code — so it can be unit-tested exhaustively and run on the client for instant re-fills.

## Model

### Stage ranges

Stages are in **run order** (the user arranges them in F5). For stage `i` with anchor BPM `a_i`, look only at its **run-order neighbours** `i−1` and `i+1`:

- **upper bound** = the smallest midpoint `(a_i + a_j) / 2` over neighbours with `a_j > a_i`; `+∞` if none.
- **lower bound** = the largest midpoint over neighbours with `a_j < a_i`; `−∞` if none.

So contiguous stages never overlap — the midpoint between their anchors separates them. (Whether the midpoint itself belongs to the lower or the upper stage doesn't matter; pick one — lower — and be consistent.) An anchor may end up at the edge of its stage's range; that's fine.

Example — warmup 150, build 160, peak 172, cooldown 145:

| Stage | Anchor | Neighbours | Range |
|---|---|---|---|
| warmup | 150 | 160 | (−∞, 155] |
| build | 160 | 150, 172 | (155, 166] |
| peak | 172 | 160, 145 | (166, +∞) |
| cooldown | 145 | 172 | (−∞, 158.5] |

### Equal contiguous anchors

Two **contiguous** stages with the **same** anchor BPM are not allowed. `validateStages` reports it; F5 tells the user and **merges** them into one stage (the first one's anchor; duration = sum of both — assumption, revisit if wrong). Non-contiguous stages may share a BPM.

### Overlap between non-contiguous stages

Non-contiguous stages can overlap (above: warmup and cooldown both cover everything ≤ 155). A track whose BPM falls in more than one stage's range is **randomly allocated** to one of them, using a seeded RNG so a given build is reproducible.

### Fill (per stage)

1. Pool = the stage's anchor + tracks allocated to this stage (must have a valid BPM; other stages' anchors are never in it).
2. Sort by `|bpm − anchorBpm|`, tie-break by track ID (code-unit comparison, not `localeCompare`).
3. Take the anchor, then add tracks in that order until `totalMs ≥ durationMs`. Overshoot is at most one track — intended per spec.
4. If the stage's range runs out first, the stage comes up **short** (`shortfallMs > 0`). It never borrows across a contiguous boundary.
5. **Rebalance overlaps:** after all stages fill, any overlap track that its randomly chosen stage didn't need goes to another eligible stage that is still short (nearest-to-anchor first).
6. Everything not placed → `unplaced`, in pool order. No-BPM tracks always end up here.

### Direction (order within a stage)

Derived from the anchor BPMs of the run-order neighbours — the user never tags stages:

| Before → this → after | Order |
|---|---|
| lower → this → higher | ascending |
| higher → this → lower | descending |
| lower → this → lower (peak) | up, then down |
| higher → this → higher (valley) | down, then up |
| first stage | towards the next anchor |
| last stage | continues the direction coming in from the previous stage |
| single stage | ascending |

Up-then-down (and the reverse): sort the stage's tracks by BPM and deal them alternately into the rising and falling halves, so both halves span the stage's range. Ties broken by ID.

## API

```ts
// Generic over the minimum shape the algorithm needs — no import of Track/TrackWithBpm,
// so this module is client-safe and test fixtures stay tiny. Callers get their own objects back.
export interface FillTrack { id: string; durationMs: number; bpm: number | null }

export interface StageSpec { id: string; durationMs: number; anchorTrackId: string }

export type Direction = 'asc' | 'desc' | 'peak' | 'valley'

export interface FilledStage<T extends FillTrack> {
  id: string
  anchorTrackId: string
  targetMs: number
  centerBpm: number          // = anchor BPM
  rangeBpm: [number, number] // may be ±Infinity
  spreadBpm: number          // synthetic tolerance (F6)
  direction: Direction
  tracks: T[]                // in play order
  totalMs: number
  shortfallMs: number        // max(0, targetMs − totalMs)
}

export function validateStages(stages: StageSpec[], pool: FillTrack[]): StageProblem[]
export function fillStages<T extends FillTrack>(stages: StageSpec[], pool: T[], seed: number):
  { stages: FilledStage<T>[]; unplaced: T[] }
export function recomputeStage<T extends FillTrack>(stage: FilledStage<T>, tracks: T[]): FilledStage<T>
```

- `hasBpm(t) = Number.isFinite(t.bpm) && t.bpm > 0` — used everywhere; `null`, `NaN`, `0`, negatives all count as "no BPM".
- `validateStages` returns `{ stageId, reason }[]` so F5 can show per-stage problems and disable Build: duration not finite or ≤ 0; anchor missing from the pool; anchor without a BPM; the same track anchoring two stages; contiguous anchors with equal BPM; duplicate stage IDs; duplicate pool IDs. `fillStages` throws on the same checks (except equal contiguous anchors, which F5 merges before calling).
- **Never mutate inputs** (they're React state). Copy before sorting.
- `spreadBpm = max(3, max |bpm − centerBpm|)` over the stage's tracks with a BPM. The center is the anchor, not the midpoint of the stage, so half the range would understate it.
- `recomputeStage` (F6 calls it after every drop): pure; returns a new object; throws if the anchor is missing; re-reads the center from the anchor's current BPM; keeps `direction` and `rangeBpm`; orders tracks by `direction`, placing no-BPM tracks as if their BPM were the center; spread ignores no-BPM tracks; recomputes totals and shortfall from `targetMs`. F6 sets a dropped track's synthetic BPM on its copy *before* calling it.

## Tests (Vitest, from the [F0](00-foundation.md) harness)

A shared `assertInvariants(input, output)` runs in every test:
- each pool ID appears exactly once across stages + `unplaced`;
- no-BPM tracks appear only in `unplaced`;
- every stage contains its anchor;
- every non-anchor track in a stage lies within that stage's range;
- every stage's order matches its direction;
- `totalMs` / `shortfallMs` correct; overshoot bound holds (total before the last added track < target).

Cases:
- The example table above: ranges as listed; no track in build is ≤ 155 or > 166.
- Close anchors (150, 155): a 153 track goes to the 155 stage, never the 150 stage.
- An anchor sitting at its stage's edge (e.g. 150 next to 150.5).
- Non-contiguous overlap: same seed → identical output; different seeds can differ; rebalance gives a short stage the overlap tracks the other didn't need.
- Short range → `shortfallMs > 0`, no borrowing across a contiguous boundary.
- Direction for every row of the direction table, including first/last/single stage and the alternating split.
- Validation: non-finite or ≤ 0 duration, NaN/0/negative BPM, anchor not in pool, anchor without BPM, duplicate anchors, contiguous equal anchors, duplicate stage IDs, duplicate pool IDs.
- Empty `stages` → `{ stages: [], unplaced: pool }`; empty pool.
- Inputs not mutated (frozen fixtures); output unchanged when the pool is shuffled (same seed).
- `recomputeStage` with a no-BPM track; without the anchor → throws.

## Acceptance

- `npm test` passes with the cases above.
- Same input + same seed → identical output.
