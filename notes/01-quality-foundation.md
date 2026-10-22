---
id: "01"
title: "Reproducible quality and regression foundation"
blocked_by: []
status: ready
branch: "V2/01-quality-foundation"
priority: P0
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 01: Reproducible quality and regression foundation

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/01-quality-foundation` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A clean-checkout development/test setup and CI checks that catch regressions without dispatching jobs or sending mail.
**Status:** ready. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

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

- [ ] Documented clean-checkout commands install development dependencies and run tests under the supported Python/Node versions.
- [ ] Tests use no real accounts, API credentials, ATS traffic, paid model calls, SMTP delivery, or workflow dispatch.
- [ ] Existing tests pass and fixtures can exercise the known fresher/location/lifecycle cases; unresolved defects are not silently blessed as expected behavior.
- [ ] PR CI reports build/type, lint, and test failures; existing warnings/advisories have explicit disposition and no new unexplained failures.

## 8. Verification Plan

- Run the full documented setup in a clean environment.
- Verify CI definition and force a local failing assertion to confirm failures propagate, then restore it.
- Run frontend build/lint/tests, pytest, and dependency audit; record applicability of dev-tool advisories.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Fixing all product bugs in this ticket, upgrading every package indiscriminately, or adding pre-commit hooks without a separate decision.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
