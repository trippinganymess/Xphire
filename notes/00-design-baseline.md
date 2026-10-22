---
id: "00"
title: "Design baseline and V2 roadmap"
blocked_by: []
status: in_progress
branch: "V2/00-design-baseline"
priority: P0
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 00: Design baseline and V2 roadmap

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/00-design-baseline` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** An accurate current-state design/architecture record, an approved M3 target, and an executable ticket roadmap.
**Status:** in progress. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The current sketch UI, unused neon prototypes, and older M3 rules disagree. V2 needs one explicit contract before unrelated tickets add more inconsistencies.

## 2. Blocked By

- None (base concept — can start immediately).

**Directly unblocks:** No direct downstream blockers.

## 3. Derivation & Concept Notes

**Foundational fact:** A document can describe the shipped system and a future target separately; approving a target does not implement it.

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

- Record current routes, active versus legacy UI, tokens, architecture, expected schema, schedules, and known limitations in design.md.
- Define the approved M3 light-theme roles, type scale, responsive layouts, primitives, accessibility expectations, and migration rules.
- Publish one note per approved ticket plus a linked dependency/branch index; reserve live learning sections without pretending mirroring is active.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `design.md`
- `notes/README.md`
- `notes/00–22-*.md`

### Design impact

Documentation only. Preserve current runtime/UI; establish M3 as the V2 target, not as already shipped.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [x] design.md cites the baseline SHA and distinguishes inspected repository behavior from deployed assumptions and future proposals.
- [x] All 23 ticket notes have unique IDs/branches, explicit blockers, scope, acceptance criteria, and verification plans.
- [x] All roadmap links resolve; dependency graph is acyclic; ready/blocked statuses match dependencies.
- [x] No runtime code, migration, credential, or existing untracked user file is changed.

## 8. Verification Plan

- Validate Markdown links, IDs, branch-ref formats, and dependency graph.
- Run package-level frontend build/lint and existing Python tests without npm install or live workers.
- Inspect the staged diff and open a docs-only PR on V2/00-design-baseline.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Implementing any other ticket, changing production UI, applying migrations, or starting a learning session without user direction.

## 10. Execution Log

- 2026-10-22: Current-state design inspected; user selected M3 for V2 and approved the 00–22 ticket breakdown. Published design.md, 23 notes, and the dependency/branch index.
- Verification: all 25 Markdown files checked for local links; 23 unique IDs and valid branch refs; dependency graph acyclic; ready implementation frontier is 01 and 03.
- `npm --prefix frontend run build`: passed (includes TypeScript build).
- `npm --prefix frontend run lint`: exit 0; five existing App/SketchTerminal warnings remain, assigned to ticket 01.
- `pytest -q`: 2 passed.
- Mocked Playwright smoke: public board → terminal authentication menu passed; external requests/websockets blocked or mocked. No live accounts, dispatch, ATS requests, paid calls, or SMTP.
- No runtime code or database migrations changed. Existing untracked user files left untouched.
- PR: pending publication on `V2/00-design-baseline`. Do not mark done until merged.
