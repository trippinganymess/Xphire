---
id: "17"
title: "Manual-confirmation application tracker"
blocked_by: ["16"]
status: blocked
branch: "V2/17-application-tracker"
priority: P2
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 17: Manual-confirmation application tracker

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/17-application-tracker` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Private application records, explicit manual confirmation, status history, and duplicate warnings.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Candidates need to remember submissions and outcomes, but opening an apply link is not proof that an employer received an application.

## 2. Blocked By

- [ ] [16: Private saved jobs, dismissals, and relevance feedback](16-personal-shortlist.md)

**Directly unblocks:** No direct downstream blockers.

## 3. Derivation & Concept Notes

**Foundational fact:** A submitted status needs submission evidence or explicit human confirmation; preparation and navigation are not submission.

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

- Add private applications and append-only/user-owned status events with source/time and optional confirmation reference.
- Allow candidate-confirmed submission, manual entries for external applications, and interview/assessment/rejected/offer/withdrawn/closed updates.
- Warn on duplicate user/requisition submissions without blocking legitimate explicit reapplications; retain original source details.
- Provide notes/history and account-data deletion behavior; do not claim inbox integration or automated ATS submission.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase applications/events migrations and RLS`
- `frontend tracker/status/confirmation UI`
- `shortlist/application interfaces`
- `privacy and transition tests`

### Design impact

M3 tracking states are text/icon labeled; explicit confirm action, history, and correction paths prevent accidental status changes.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Opening/saving/generating an artifact never creates submitted status.
- [ ] Explicit manual confirmation records user/source/time; every status change retains history.
- [ ] Duplicate warnings refer to canonical user/requisition identity and allow documented correction/reapplication.
- [ ] Applications/notes/events are inaccessible across users and are removed according to account-deletion policy.

## 8. Verification Plan

- State transition, confirmation, duplicate, external-entry, correction, and delete fixtures.
- Two-user/anon RLS tests and append/history constraints.
- Mocked browser confirmation/status/history tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

ATS auto-fill/submission, resume generation, Gmail/IMAP integration, or treating recruiter receipts as offers.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
