# F2 — GetSongBPM client + `getBpm` resolver

Back to [PLAN.md](PLAN.md)

## Goal

Finish build-order step 2: `getBpm(trackId, artist, title)` that checks the cache → calls GetSongBPM on a miss → caches the result with `source: "api"`.

Storage (`lib/bpm/cache.ts`) exists, but its **precedence rule is wrong and must be fixed here first** (§4b): today it refuses a synthetic write over a cached API *miss*, so once F2 caches misses, F6 can never store a synthetic BPM for the tracks synthetic exists for.

## Facts verified 2026-10-11 (live probes + docs snapshot)

- Base URL **`https://api.getsong.co`** (since docs v1.2, 2024-09-25). The old `api.getsongbpm.com` returns a Cloudflare challenge page (403 HTML).
- Endpoint **`GET /search/`** — the trailing slash is required (`/search` → 404).
- Query: `type=both&lookup=song:<title> artist:<artist>`, optional `limit` (default 10).
- Auth: `X-API-KEY` header (or `api_key` query param).
- **Hit:** 200 `{"search":[{ id, title, tempo: "123", artist: { name, … }, album: {…}, … }]}` — **`tempo` is a string**, `artist` is an object.
- **Miss:** 200 **`{"search":{"error":"no result"}}`** — `search` is an object, not `[]`.
- **Errors:** 401 `{"error":"API Key is missing."}` / `{"error":"Invalid API Key, or inactive."}`, served as `text/html`.
- **Rate limit:** 3000 requests/hour; exceeding it **blocks the key for 1 hour**. No rate-limit headers.
- Search is substring-based: `song:sandman artist:metallica` returns "Enter Sandman".
- Terms: a public backlink to getsongbpm.com is **mandatory** (on the registered site) or the account is suspended. The README has it — keep it.

## Scope

### 1. Client — `lib/bpm/getsongbpm.ts` (server-only)

- `GET https://api.getsong.co/search/` with `URLSearchParams` (`&` in titles only works encoded), `type=both`, `limit=5`, `X-API-KEY` header, `cache: 'no-store'`, `AbortSignal.timeout(10_000)`.
- Parse via `res.text()` + `JSON.parse` — don't trust content-type.
- Returns `{ kind: 'hit', bpm, match: { id, title, artist } } | { kind: 'miss' }`.
  - `bpm = Number(tempo)`; reject (→ treat candidate as non-matching) unless finite and within 40–250.
- **Throws** a typed `GetSongBpmError` on: non-200, non-JSON, unexpected error payloads, network failure, timeout. **Only `hit` and `miss` are ever cached.** Otherwise a bad key, a rate block or an outage would store a 30-day "no BPM" for every track.

### 2. Query normalisation

- NFKC; fold `’‘“”–—` to ASCII; collapse whitespace. (A curly `’` turns "Don't Stop Me Now" from a hit into a miss.)
- Primary (first) artist only.
- Cut a ` - …` suffix, and strip `( )` / `[ ]` groups, **only** when they contain tempo-preserving keywords: remaster, version, edit, mono/stereo, feat./ft./with, from, bonus, deluxe, explicit, live.
- **Never strip** remix / mix / sped up / slowed / nightcore — those change the tempo; a miss beats inheriting the original's BPM.
- 2nd query (only if the 1st misses): ` - …` suffix removed but parentheticals kept; skip if identical to the 1st. **Max 2 requests per track.** No title-only fallback (common titles return dozens of wrong artists).
- Optional during implementation: probe whether titles containing `:` confuse the `song:` / `artist:` parser.

### 3. Result matching

Normalise both sides: lowercase, strip accents (the server ignores them; the client must too), `&` → "and", drop punctuation and a leading "the".

- Accept a candidate only if **both** the artist (equal, or whole-word contained) **and** the title (equal after cleaning) match.
- If several candidates pass with tempos more than 3 BPM apart (ignoring exact ×2 / ÷2 relationships) → treat as a miss.
- A miss is better than a confident wrong number.

### 4. Resolver + cache fixes

**4a. `lib/bpm/index.ts` → `getBpm(trackId, artist, title)`**
- `cache.get` → if `!needsLookup(entry)` return it.
- Otherwise call the API and `cache.set(trackId, { bpm, tolerance: null, source: 'api' })`, with `bpm: null` for a `miss` (retried after the 30-day TTL). On a thrown error: cache nothing, rethrow.
- **In-flight dedupe** by `trackId` (`Map<trackId, Promise>`): React Strict Mode (on by default in the App Router) runs F3's resolve-on-mount effect twice in dev.
- Returns the entry **actually stored** — if `set()` refused the write, that's the existing entry.
- Synthetic entries are **not** re-queried in the MVP.

**4b. Value-aware precedence in `cache.set()`** — rank `synthetic 0 < api 1 < manual 2`. Reject the write when:

```ts
existing && existing.bpm !== null && (entry.bpm === null || rank(entry) < rank(existing))
```

So: synthetic may replace an API miss; a miss never erases a value; synthetic never overwrites api/manual; api never overwrites manual (that would undo a manual half-time fix). `set()` returns the stored entry. Enforce it in `set()` itself — `needsLookup` only guards the *start* of a lookup, and an F6 drop can land between `get()` and `set()` of an in-flight lookup.

**4c. `cache.ts` robustness**
- On load failure (bad JSON, permissions): reset `loading` so a fixed file recovers without a restart, and **fail loudly** — never fall back to an empty map, or the next flush would overwrite the user's manual/synthetic data.
- Unique temp filename per flush (`${pid}.tmp` collides across module instances).
- Cache path read lazily from `BPM_CACHE_PATH` (default `data/bpm-cache.json`) so tests use a temp file.
- Keep module state (`memory`, `loading`, `writeChain`, limiter, in-flight map) on `globalThis`: Turbopack server HMR re-creates route modules in dev, and an old instance can keep flushing a stale map.
- `__resetForTests` awaits `writeChain`.
- Document: stop the dev server before hand-editing `bpm-cache.json` (otherwise the next flush silently overwrites the edit).

### 5. Rate limiting

- 3 concurrent requests, no artificial delay, plus a rolling-hour counter capped around 2500 (headroom under the 3000/hour block).
- **Circuit breaker:** the first 401/403/404/429/5xx/non-JSON response stops the queue, rejects queued lookups and caches nothing. On 401, say the key is invalid or inactive.

### 6. Flushes

Coalesce in `scheduleFlush` — at most one running plus one queued flush (about 6 lines, no new API). This replaces the earlier `setMany`/debounce idea; 300 rewrites of a ~50 KB local file are cheap, and a debounce would weaken durability of user actions.

## Notes

- **Half-time / double-time** is common (live: "Don't Stop Me Now" → `80`; commonly cited ≈156). F2 stores the raw value. How the app corrects it is future work (see PLAN.md) — the drag-and-drop editor alone can't, since synthetic never overwrites api values.
- Client components must import `BpmSource` from `lib/bpm/types.ts` (or `lib/types.ts`), never from `lib/bpm/index.ts` / `cache.ts`, which pull in `node:fs`.
- The in-app "BPM data from GetSongBPM" link is optional (the README backlink satisfies the terms); if added, it belongs in F3's UI, not here — F2 is a server-only library.

## Acceptance

Vitest from the [F0](00-foundation.md) harness, with mocked `fetch` and a temp `BPM_CACHE_PATH`:

- Fixtures: hit, `{search:{error:'no result'}}`, string tempo, 401, HTML page, 404, timeout.
- Normalisation and matching unit tests (curly quotes, feat., remaster suffix, remix kept, accents, cover version rejected).
- `getBpm` twice for the same track hits the network once — **including when the two calls are concurrent**.
- A miss is cached as `{ bpm: null, source: 'api' }` and retried only after the TTL.
- Precedence (`set()` directly): synthetic over an API miss → accepted; a miss over synthetic or manual → refused; synthetic over api → refused; api over manual → refused.
- Errors (network, timeout, 401/404/429/5xx, non-JSON) are **not cached** and surface a typed error; the breaker stops further calls.
- A corrupt cache file gives a clear error, is never overwritten, and recovers without a restart once fixed.
