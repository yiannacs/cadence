# F2 — GetSongBPM client + `getBpm` resolver

Back to [PLAN.md](PLAN.md)

## Goal

Finish build-order step 2: `getBpm(trackId, artist, title)` that checks the cache → calls GetSongBPM on a miss → caches the result with `source: "api"`. Storage (`lib/bpm/cache.ts`) already exists, including the precedence rule and the 30-day miss TTL via `needsLookup()`.

## Scope

1. **`lib/bpm/getsongbpm.ts`** — server-only client.
   - Search by artist + title using `GETSONGBPM_API_KEY`. Confirm the current base URL, query syntax and response shape in GetSongBPM's API docs before coding (the API host has moved before).
   - Returns `{ bpm: number } | null`.
2. **Query normalisation** before sending — this is where most of the hit rate comes from:
   - strip ` - Remastered 2011`, ` - Live`, `(feat. …)`, `[Radio Edit]`, ` - Single Version`, etc. from the title;
   - use the primary (first) artist only;
   - keep the raw title as a fallback second query if the cleaned one misses.
3. **Result matching** — GetSongBPM may return several candidates. Pick the one whose normalised artist matches; reject results where neither artist nor title plausibly match rather than accepting a wrong BPM. A miss is better than a confident wrong number.
4. **`lib/bpm/index.ts` → `getBpm(trackId, artist, title)`**
   - `cache.get` → if `!needsLookup(entry)` return it.
   - Otherwise call the API, then `cache.set(trackId, { bpm, tolerance: null, source: 'api' })` — including `bpm: null` for misses so they aren't re-queried every run.
   - **Do not let an API miss overwrite a synthetic or manual value.** `set()` only blocks synthetic-over-real, so an api `{ bpm: null }` would clobber a synthetic guess if it were ever written. Today that can't happen because `needsLookup` returns false for any non-null bpm — add a test that locks it in.
   - Decide whether synthetic entries should be **re-queried after the miss TTL** so a real result can upgrade them (CADENCE.md allows api to overwrite synthetic). If yes: write the api result only when it's a hit; on a miss, leave the synthetic entry untouched (just bump a "last checked" timestamp or skip).
5. **Rate limiting** — a concurrency-limited queue (e.g. 2–4 in flight, small delay) shared across requests in the module. Check GetSongBPM's published limits.
6. **Batch flush** — `cache.set` flushes the whole file on every write. For a 300-track playlist that's 300 full rewrites. Add a `setMany` or debounce the flush so bulk resolution in [F3](03-playlist-and-bpm-resolution.md) writes once (or once per N).

## Notes

- GetSongBPM's free API terms require a visible backlink to getsongbpm.com — add a small "BPM data from GetSongBPM" link in the footer.
- Half-time / double-time errors (e.g. 87 vs 174) are common in BPM databases. Out of scope to fix automatically for MVP; the drag-and-drop editor is the escape hatch.

## Acceptance

- Unit tests (Vitest, see [F4](04-fill-algorithm.md)) for title normalisation and candidate matching, with a mocked `fetch`.
- Calling `getBpm` twice for the same track hits the network once.
- A miss is cached as `{ bpm: null, source: 'api' }` and re-tried only after the TTL.
- A track with a synthetic entry is never re-queried and never downgraded.
