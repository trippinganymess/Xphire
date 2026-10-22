---
id: "01"
title: "Reproducible quality and regression foundation"
blocked_by: []
status: in_progress
branch: "V2/01-quality-foundation"
priority: P0
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 01: Reproducible quality and regression foundation

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/01-quality-foundation` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A clean-checkout development/test setup and CI checks that catch regressions without dispatching jobs or sending mail.
**Status:** in progress. Offline quality foundation implemented locally; PR and clean-snapshot verification being finalized. Product defects remain assigned to later tickets.

## 1. Core Motivation & Problem

**Why are we doing this?** The two existing Python tests cover retries and batch deduplication, while the screenshot script no longer matches the current routes/auth flow. Future changes need trustworthy offline checks.

## 2. Blocked By

- None (base concept — can start immediately).

**Directly unblocks:** [02](02-secure-dispatch.md), [06](06-normalized-job-catalog.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A passing test proves only the behavior it exercises; mocked side-effectful dependencies make verification repeatable.

**Discovery path:** Reproduce the stated problem, identify which facts the current interface lacks, implement the smallest complete behavior that exposes those facts safely, and verify it through the same interface that callers use.

<!-- When a learning session is requested, the user may enable /md-log for this note. No mirroring or quiz is claimed to have run. -->

## 4. Visual Model (If Needed)

<!-- Add a verified diagram only if it clarifies this ticket. No decorative/placeholder image is required. -->

## 5. Active Recall Checkpoint

- [ ] Explain the foundational fact using one concrete failure case.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Connect the outcome to downstream tickets.

Learning checkpoints are separate from implementation acceptance; publishing or merging this note does not mark them verified.

## 6. Implementation Scope

- Declare reproducible Python development/test dependencies and frontend test commands; preserve existing runtime requirements where appropriate.
- Add interface-level fixtures for Supabase, ATS, model, clock, and SMTP effects; replace global import stubs/unsafe UI flows as needed.
- Run build/type checks, lint, Python/frontend tests, and documentation checks in PR CI; review existing warnings and dependency advisories.
- Resolve or document reviewed dependency advisories, minimize lockfile churn, and make build-only commands avoid reinstalling packages.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `requirements.txt and new development dependency configuration`
- `tests/`
- `frontend/package.json, package-lock.json, verify_ui.cjs`
- `.github/workflows/ (new PR validation workflow)`

### Design impact

No redesign. Establish mocked browser checks that future M3 tickets can extend.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [x] Documented clean-checkout commands install development dependencies and run tests under the supported Python/Node versions.
- [x] Tests use no real accounts, API credentials, ATS traffic, paid model calls, SMTP delivery, or workflow dispatch.
- [x] Existing tests pass and fixtures can exercise the known fresher/location/lifecycle cases; unresolved defects are not silently blessed as expected behavior.
- [x] PR CI reports build/type, lint, and test failures; existing warnings/advisories have explicit disposition and no new unexplained failures.

## 8. Verification Plan

- Run the full documented setup in a clean environment.
- Verify CI definition and force a local failing assertion to confirm failures propagate, then restore it.
- Run frontend build/lint/tests, pytest, and dependency audit; record applicability of dev-tool advisories.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Fixing all product bugs in this ticket, upgrading every package indiscriminately, or adding pre-commit hooks without a separate decision.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- 2026-10-22: Started `V2/01-quality-foundation` from fetched `origin/main` (`587df22`). User approved carrying ticket 00's two documentation commits because PR #29 remains unmerged; this PR temporarily includes that baseline.
- Added hash-locked Python 3.11 development/runtime dependencies; real dependency imports replace global import stubs. Fail-closed network/credentials fixtures script Supabase, four ATS formats, JobSpy, Gemini, UTC/monotonic time, and SMTP.
- Added mocked Chromium board/auth/terminal/dispatch checks with an isolated strict-port server, fake credentials overriding local `.env`, intercepted realtime, and no real signup/apply/dispatch. Replaced unsafe `verify_ui.cjs` with test delegation.
- Added PR-only Python/frontend/documentation jobs, Node 24 deployment alignment, strict frontend warning handling, E9/F Python lint with no blanket ignores, and root commands that never install dependencies.
- Dependency review: npm's two affected packages patched narrowly (Vite 8.2.2 → 8.2.4; source-map-js 1.2.1 → 1.2.2); unrelated locked versions retained. Python lock audit and npm audit report no known vulnerabilities. Exact advisory IDs, warning disposition, limitations and setup are in [docs/quality.md](../docs/quality.md).
- Local Python 3.11.16 verification: `python -m pytest -q` → **36 passed, 10 xfailed**; `python -m ruff check .` → all checks passed; `python -m pip check` → no broken requirements; `python -m pip_audit --disable-pip -r requirements-dev.txt` → no known vulnerabilities.
- Local Node 24.22.1 verification (selected via `npx --package=node@24 -- ...` because default local Node is 26): `npm ci --ignore-scripts`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm audit`. Browser result: **4 ordinary passes + 4 expected failures** (Playwright reports eight passed overall). Build succeeded; no frontend lint warnings. Existing terminal duplicate-log-key console diagnostic is reviewed/deferred to ticket 05.
- Expected failures assert desired fresher, location/role, rediscovery/lifecycle semantics and identify tickets 08/09/10/12. Python assertion-only strict xfails and browser unexpected passes fail CI; they are not product acceptance evidence.
- Failure propagation checked by temporarily changing retry assertion `7.0` → `-1.0` and board count `2` → `99`: both commands exited 1. Temporarily making the known `10-12 Yrs` bug assertion pass also exited 1 (“Expected to fail, but passed”). All mutations restored.
- `actionlint` 1.7.12 validated new PR workflow and modified deploy workflow; `python scripts/check_docs.py` validated documentation links/ticket metadata; `git diff --check` passed.
- Clean Python venv installed all locked packages with `pip install --no-index --find-links /tmp/xphire-wheels --require-hashes -r requirements-dev.txt`, then tests/pip consistency passed. Direct PyPI downloads were exceptionally slow and timed out; a temporary SHA-256-verified wheelhouse was used for the clean-install check. Wheelhouse is not a repository requirement or committed artifact; normal documented install uses PyPI.
- Clean tracked-file snapshot verification passed at `/tmp/xphire-ticket01-snapshot.81KayJ`: locked npm install, Python tests/lint/pip consistency, documentation checks, Node 24 type/lint/build/browser tests, both audits, and actionlint. Snapshot excludes local `.env` and untracked files.
- Additional negative checks: strict Python lifecycle XPASS exited 1; a broken documentation link exited 1; an unmocked browser request inside an expected-failure test exited 1 after ensuring safety errors reset Playwright's expected status. All temporary mutations restored.
- PR: pending opening; remote CI not yet observed. No merge, deploy, live worker execution, account creation, workflow dispatch, or mail delivery performed.
