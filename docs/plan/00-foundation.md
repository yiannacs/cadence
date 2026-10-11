# F0 — Foundation (shared prerequisites)

Back to [PLAN.md](PLAN.md)

## Goal

One small commit on `main` **before** F1, F2 and F4 branch off, so the parallel branches don't fight over `package.json`, the lockfile, or where shared types live.

## Scope

1. **Test harness (Vitest)**
   - `npm i -D vitest @types/node@^22` — plain `npm i -D vitest` fails today (vitest 5's optional peer `@types/node ^22 || >=24` conflicts with the project's `^20`; local Node is v22 so bumping is safe). Consider `--save-exact`.
   - `vitest.config.mts`: `{ resolve: { tsconfigPaths: true }, test: { environment: 'node', passWithNoTests: true } }`. Vite 8 supports the `@/` alias natively via `resolve.tsconfigPaths`; fall back to `vite-tsconfig-paths` if that doesn't work at runtime.
   - Alias `server-only` to an empty stub in the Vitest config (Next handles that import internally; it isn't installed as a package, so Vitest can't resolve it).
   - Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
   - No jsdom / React Testing Library yet — Next's Vitest guide sets those up for component tests, which nothing needs so far.
   - Import `describe/it/expect` from `vitest` explicitly (no `globals: true`); `next build` type-checks test files too.
2. **Shared types** — `lib/types.ts` with `Track` and `TrackWithBpm` (see PLAN.md), importing only `type { BpmSource } from './bpm/types'`. Lives outside `lib/spotify/*` and `lib/bpm/{index,cache}.ts` because client components (F5, F6) import it and must never pull in `node:fs`.
3. **`.gitignore`** — add `/data/`. The BPM cache (and stray `.tmp` files) must never be committed; the repo is public.

## Acceptance

- `npm test` exits 0 with no test files.
- `npm run build` still passes.
- `git check-ignore data/bpm-cache.json` matches.
