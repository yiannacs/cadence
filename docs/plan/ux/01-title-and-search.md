# U1 — Window title + playlist search

Back to [PLAN.md](PLAN.md)

## Goal

The browser tab says `cadence`, and the playlist picker can be filtered by name. Also adds the shared text matcher that U3's song-list search uses.

## Scope

1. **Title** — `app/layout.tsx`: `metadata = { title: 'cadence', description: 'Running playlists ordered by tempo.' }` (replacing the create-next-app defaults). One title for every page; no per-page titles. Check `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` first.
2. **Matcher** — `lib/search.ts`, pure, client-safe:
   - `normalizeForSearch(text)`: NFD, strip combining marks, lowercase;
   - `matchesQuery(haystack, query)`: true when every whitespace-separated word of the query occurs in the haystack (so "queen stop" finds "Don't Stop Me Now · Queen"). Empty query matches everything.
   - Same rules as today's `filterTracks` in `lib/stages.ts`; U3 switches that to this module (U1 doesn't touch `stages.ts`, which U3 owns).
3. **Playlist picker search** — `app/build/page.tsx` stays a Server Component; the list moves into a client component (`app/build/playlist-list.tsx`) that gets the playlists as props.
   - Search input above the list, autofocused, filtering by playlist name with `matchesQuery`.
   - Filters both the owned list and the "only playlists you own" section; hides the section when nothing in it matches.
   - "No playlists match." when the filter empties both. Escape clears the input.

## Acceptance

- The tab reads `cadence` on `/`, `/build` and `/build/[id]`.
- Typing in the picker narrows the list as you type; accents and case don't matter.
- `lib/search.ts` has unit tests (multi-word, accents, empty query).
