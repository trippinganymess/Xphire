---
id: "03"
title: "Material Design 3 tokens and accessible primitives"
blocked_by: []
status: ready
branch: "V2/03-m3-design-system"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 03: Material Design 3 tokens and accessible primitives

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/03-m3-design-system` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** One testable M3 light-theme token layer and reusable accessible control/card/status primitives.
**Status:** ready. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The active application has hardcoded colors and missing token families; building new pages now would perpetuate multiple visual systems.

## 2. Blocked By

- None (base concept — can start immediately).

**Directly unblocks:** [04](04-m3-shell-and-board.md), [21](21-m3-email-design.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Semantic color/type roles let many surfaces share one decision; accessible interaction is part of a control’s interface.

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

- Implement the color/type/spacing/shape/elevation/state roles specified in design.md in a centralized theme.
- Add explicit app-semantic success/warning/unknown roles with verified contrast; keep literals in the theme, not consumers.
- Implement filled/outlined/text buttons, outlined labeled fields/selects, cards, chips, and distinct loading/error/empty states using semantic React/HTML.
- Define keyboard focus, disabled/loading behavior, reduced motion, and documented examples/tests; use Roboto/system sans-serif fallbacks.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `frontend/src/index.css and new theme/primitives files`
- `frontend/src/components/ (shared M3 primitives)`
- `frontend/index.html`
- `design.md`

### Design impact

Implements §7–8 primitives. Do not silently restyle routed legacy surfaces; route migration belongs to 04/05. A UI library requires an explicit compatibility choice.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Primitives consume md-sys/app-semantic roles and do not depend on undefined sketch/neon variables.
- [ ] Type/shape/spacing/state variants match the approved design contract; font failure leaves readable content.
- [ ] Keyboard, explicit labels, error associations, focus visibility, contrast, and reduced motion pass checks.
- [ ] Existing routes remain usable until migrated, without accidental global CSS regressions.

## 8. Verification Plan

- Isolated primitive interaction tests and accessibility/contrast checks.
- Screenshot fixtures for all variants/states and fallback fonts.
- Build/lint/type checks plus smoke tests of unmigrated routes.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Redesigning every route, dark mode, a speculative component framework, or upgrading backend behavior.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
