---
status: in_progress
branch: "V2/performance-discovery"
blocked_by: ["01"]
---

# Public discovery performance slice

[Roadmap](README.md) · [Design contract](../design.md) · [Remaining V2 discovery scope](12-server-side-discovery.md)

## Approved scope and dependency exception

The user approved implementing loading performance independently of the full V2 redesign/eligibility chain: 50-job pages over the entire last-24-hour catalog, lazy terminal routing, and brief public-result caching with background revalidation. This is an explicitly extracted performance slice of ticket 12, not completion of 04 or 08–12.

Branch `V2/performance-discovery` starts at updated `origin/main` (`3262e1f`), which includes merged quality-foundation PR #30. The unfinished merge in the previous local quality branch was resolved separately with the user's permission; no unrelated untracked files are included.

## Implementation and acceptance

- [x] Each catalog request selects only the ten card fields, fetches at most 50 rows, and requests a filtered total count. No 1,000-row catalog cap remains.
- [x] Keyword, minimum rating, legacy fresher, and supported source predicates run before page selection. Keyword input is trimmed, escaped as a literal case-insensitive regex, and quoted for PostgREST grammar; punctuation cannot add query predicates. `*`, `%`, and `_` do not expand a keyword search.
- [x] Pages order by `scraped_at DESC, job_id DESC`, providing deterministic boundaries for equal timestamps. Changing filters resets the page; count shrink clamps to an available page. Failed pages expose Retry, Previous page, and First page recovery as applicable.
- [x] The 24-hour cutoff advances on every network fetch/revalidation. Source posting time and verification are not invented.
- [x] `#/terminal` uses a dynamic import with an accessible Suspense fallback. Guest navigation and direct restored-session access remain functional.
- [x] Public pages are fresh for 30 seconds, retained for stale-while-revalidate use for at most five minutes, and keyed by all query filters and page. The in-memory LRU cache retains at most 20 completed idle query pages; active/in-flight entries are protected until completion. This memory bound does not limit the catalog or reachable page count.
- [x] Same-key in-flight requests are shared across route/StrictMode remounts. Late responses populate their own cache entry, not a newer query. Cached route returns avoid a redundant request while fresh.
- [x] Visible boards revalidate on freshness expiry and stale focus/visibility changes. Hidden boards pause scheduled network fetching. Only the active query is refreshed; bulk minute polling and realtime-triggered bulk reloads are removed.
- [x] Initial loading, empty results, background refresh, retryable failure, and retained stale results are distinct. Background refresh preserves useful cards and search focus. Requests have a 15-second timeout; the store owns scheduled/manual retries instead of layering SDK retries on top.
- [x] Only the fixed public card projection is cached. No localStorage persistence, profiles, auth sessions, terminal responses, or private data enter this cache.
- [x] A manifest-based production build check fails if terminal JS or CSS joins the initial route's static dependency graph. It runs as part of `npm run build` and thus existing PR CI.

## Design impact

Preserve the current shell/cards until M3 ticket 04. Pagination/feedback controls use existing semantic paper/ink tokens, keyboard-visible focus, and wrapping layout rather than introducing a third visual system. The route-loading fallback is a status region. No verified/fit badges or new eligibility claims are introduced.

## Verification boundaries

User-approved seams: mocked Chromium UI with the real Supabase SDK at its HTTP boundary; production Vite manifest/chunks. Fixtures apply filtering, ordering, offsets, and limits rather than returning the entire catalog for every request. All remote traffic is fail-closed; no live auth, scraping, model, mail, or workflow effects.

Initial red checks reproduced 1,000 rendered jobs instead of 50, a redundant catalog request on route return, and eager terminal module loading. Additional regressions cover a 1,005-recent-job fixture with 21 pages, matches outside the former sample, timestamp ties, combined predicates, literal keyword punctuation/wildcards, rolling expiry, stale refresh, failures/retry, late responses, cache-key isolation, TTL/LRU expiry, hidden tabs, and page shrink/recovery.

Final commands/results and PR status are recorded below after verification.

## Explicit remaining limitations

- Legacy Fresher/0–1 substring semantics are deliberately retained, including the known `10-12 Yrs`/`0-2 Yrs`/internship defects. Ticket 08's evidence-based classification is not implemented here; its expected failures remain.
- Lifecycle, normalized role/location, employer-policy, M3 migration, new source/eligibility controls, and board/digest predicate parity remain with tickets 04 and 08–12. Python digest queries are unchanged.
- Offset pagination is deterministic for unchanged records/equal timestamps, not a database snapshot: insertions/deletions/timestamp changes between requests can shift page membership. Counts and displayed results update during revalidation. Snapshot/keyset semantics remain a separate design decision.
- Exact counts and escaped substring regex predicates still cost database work. Production index/query-plan performance and RLS behavior are not proven by mocked browser tests; no database schema or deployed setting is changed.
- An API out-of-range error retains retry/first-page recovery rather than being mislabeled no matches. Cached public rows can briefly lag the moving 24-hour boundary until revalidated; stale retained results are identified during refresh/failure.
- Avatar assets remain large. Route splitting defers terminal code/styles, not shared React/router/Supabase dependencies or images used by other surfaces.

## Execution log

- Implemented and verified the three requested features on the isolated performance branch; full ticket 12 remains blocked.
- No dependencies added or lockfile rewritten. No production migration, deploy, PR merge, live scraper/workflow dispatch, or email performed.
- Final verification (Node 24.22.1): `npm --prefix frontend run typecheck`, `run lint`, `run build`, and `test` all passed. Chromium: **23 ordinary passes + 4 retained expected failures** (Playwright reports 27 passed); no new lint warnings. Build runs the manifest-based route guard.
- Python 3.11.16: `/tmp/xphire-quality-py311/bin/python -m ruff check .` passed; `-m pytest -q` → **36 passed, 10 xfailed**. `python3 scripts/check_docs.py` → documentation checks passed (29 files; 23 original numbered ticket notes). `git diff --check` passed; `npm --prefix frontend audit` → zero vulnerabilities.
- Vite build measurement: initial JS **463.22 kB → 448.47 kB**, gzip **133.85 kB → 130.61 kB**; terminal JS **18.00 kB** and CSS **2.29 kB** are deferred. These are local bundle sizes, not a claimed production latency improvement.
- Negative guard verification: temporarily adding a static terminal edge to the generated (ignored) manifest made `check-route-chunks.mjs` exit 1 with “Terminal must not be statically imported by the initial board”; restoring the manifest made the same command pass. No mutation remains.
- PR: not opened yet.
