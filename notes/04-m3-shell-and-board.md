---
id: "04"
title: "M3 shared shell and responsive board"
blocked_by: ["03"]
status: blocked
branch: "V2/04-m3-shell-and-board"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 04: M3 shared shell and responsive board

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/04-m3-shell-and-board` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A coherent M3 top app bar and public board using the existing data behavior.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The current root width, non-wrapping header, pixel typography, and yellow cards are not the approved V2 direction and have compact-layout risks.

## 2. Blocked By

- [ ] [03: Material Design 3 tokens and accessible primitives](03-m3-design-system.md)

**Directly unblocks:** [05](05-account-and-search-forms.md), [12](12-server-side-discovery.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Layout must adapt to available space; visual migration must not silently change the meaning of existing data.

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

- Migrate shared shell/navigation and board/filter/card styling to the new primitives and semantic tokens.
- Add viewport metadata, fluid gutters/container sizing, wrapping content, and accessible navigation/menu behavior.
- Preserve #/ and #/terminal compatibility and original apply links; isolate the legacy terminal until its form migration.
- Display only currently supported fields and clearly label scraped/discovered time; leave query/eligibility corrections to their tickets.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `frontend/src/App.tsx, App.css, index.css`
- `frontend/src/components/SketchHeader.tsx/.css, JobBoard.tsx/.css`
- `frontend/index.html`
- `design.md`

### Design impact

Implements §8.1–8.3 appearance without pretending verification or matching is available. Remove sketch styling on migrated surfaces.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Board and shell use M3 roles consistently and route behavior remains compatible.
- [ ] 320/390/768/1440px widths and 200% zoom have no clipped navigation, overflowing card text, or inaccessible menus.
- [ ] Labels, keyboard focus, apply-link semantics, reduced motion, loading/empty presentation, and content contrast are verified.
- [ ] No fake fit/verified badge or unsupported data field is introduced by the redesign.

## 8. Verification Plan

- Mocked browser navigation/filter/render tests and screenshots at required widths.
- Long title/location/employer and missing-field fixtures.
- Accessibility checks, build/lint/type tests, and legacy terminal smoke test.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

New eligibility algorithms, changing server filtering, or restyling future private pages before their data model exists.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
