---
id: "05"
title: "Accessible account, search, and settings forms"
blocked_by: ["02", "04"]
status: blocked
branch: "V2/05-account-and-search-forms"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 05: Accessible account, search, and settings forms

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/05-account-and-search-forms` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Working M3 account and discovery forms with session-correct logout and real authenticated dispatch.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Auth/search/scheduling require terminal prompts; the header’s sign-out only clears UI state, and legacy form components simulate execution.

## 2. Blocked By

- [ ] [02: Authenticated, bounded workflow dispatch](02-secure-dispatch.md)
- [ ] [04: M3 shared shell and responsive board](04-m3-shell-and-board.md)

**Directly unblocks:** [13](13-private-candidate-profile.md), [19](19-alert-cadence.md)

## 3. Derivation & Concept Notes

**Foundational fact:** User-visible state must reflect the authoritative session and server outcome, not local simulation.

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

- Add accessible sign-in/sign-up/confirmation and search/configuration flows using the secured dispatch interface.
- Make logout sign out of Supabase from every entry point; test session restore/expiry and handle unavailable profile data honestly.
- Retain terminal compatibility as optional advanced access; do not mount the mock WorkflowFilters implementation.
- Provide structured settings surfaces for later cadence/profile work; do not promise six-hour scheduling before 19 is implemented.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `frontend/src/App.tsx`
- `frontend/src/components/SketchTerminal.tsx, SketchHeader.tsx`
- `frontend/src/lib/userService.ts`
- `new account/search/settings route modules`

### Design impact

M3 outlined labeled fields and clear primary actions; browsing stays public and personal actions require authentication.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Account creation/sign-in/confirmation/expired-session/error paths have correct accessible feedback.
- [ ] All sign-out paths clear the Supabase session; refresh does not restore a supposedly signed-out session.
- [ ] Search sends validated authorized parameters through 02 and distinguishes acceptance from completed worker/email execution.
- [ ] Public browsing and existing deep links work; no timed mock completion or fake run ID is used.

## 8. Verification Plan

- Mocked auth/session/browser tests including header and terminal logout.
- Dispatch acceptance/rejection and keyboard form tests.
- Responsive/accessibility screenshots and build/lint/type checks.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Profile evidence storage, run-status tracking, changing schedule cadence, or inventing an account table/RLS policy without schema verification.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
