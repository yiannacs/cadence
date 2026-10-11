# F5 — Stage builder UI

Back to [PLAN.md](PLAN.md)

## Goal

UX step 3: the user defines `n` stages, each with a duration and an anchor song chosen from the playlist — by feel, never by typing a BPM. Then the app runs the fill (F4) and shows the staged result.

## Scope

1. **Stage list** on the `/build/[playlistId]` page (client component, sits on top of F3's state):
   - add / remove / reorder stages; default template of four: *warmup, build, peak, cooldown*. **Order matters**: it's the run order, and F4 derives each stage's BPM range and direction from its run-order neighbours;
   - per stage: optional name, duration input in **minutes** (stored as ms);
   - per stage: anchor picker.
2. **Anchor picker** — searchable list (title/artist filter) of the playlist's tracks.
   - Only tracks **with a BPM** are selectable as anchors (an anchor's whole job is to supply a BPM). Show missed tracks greyed out with a short "no BPM — can't anchor" hint.
   - A track already used as another stage's anchor is disabled.
   - **Contiguous stages with equal anchor BPMs** aren't allowed. Show a notice on the pair ("same tempo as the previous stage — they'll be merged into one") and, on Build, merge them: the first stage's anchor, duration = sum of both. Non-contiguous stages may share a BPM.
   - Showing the BPM next to each option is fine as secondary info, but the UI should lead with title/artist — the user picks by feel.
3. **Validation** — run F4's `validateStages` on every change; show problems on the offending stage and disable Build while any remain (other than the equal-contiguous case, which is merged).
4. **"Build" button** → `fillStages(specs, tracks, seed)` client-side → hand the result to the editor (F6). Store the seed with the result so the build is reproducible; a fresh seed on each Build (or an optional "reshuffle" button) re-rolls overlap allocation. Re-building after changing specs replaces the result (warn if the user has made manual edits in F6).
5. **Result summary** per stage: center BPM, BPM range, direction (↗ ↘ ⋀ ⋁), track count, total vs target duration, and a shortfall warning when the stage's range didn't hold enough music.

## Notes

- Totals: show the overall run length (sum of durations) so the user can sanity-check against their planned run.
- Persist stage specs in `localStorage` keyed by playlist ID so a refresh doesn't lose them (wrap in try/catch).

## Acceptance

- User can go from a loaded playlist to a filled four-stage result without typing a BPM.
- Missing-BPM tracks cannot be chosen as anchors; duplicate anchors are impossible.
- Two contiguous stages with equal anchor BPMs produce a notice and are merged on Build.
