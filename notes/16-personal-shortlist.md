---
id: "16"
title: "Private saved jobs, dismissals, and relevance feedback"
blocked_by: ["13", "15"]
status: blocked
branch: "V2/16-personal-shortlist"
priority: P2
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 16: Private saved jobs, dismissals, and relevance feedback

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/16-personal-shortlist` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** User-owned save/dismiss actions, a shortlist view, and explicit feedback reasons.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Candidates must repeatedly re-read the same jobs because Xphire has no private shortlist or way to signal why a result is irrelevant.

## 2. Blocked By

- [ ] [13: Private evidence-backed candidate profile and preferences](13-private-candidate-profile.md)
- [ ] [15: Job details with eligibility and fit explanations](15-job-details-and-evidence.md)

**Directly unblocks:** [17](17-application-tracker.md), [20](20-reliable-digests-and-reminders.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A user action on a shared job is private state; hiding a job for one candidate must not erase it for everyone.

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

- Add private user/job shortlist and feedback records with unique keys, timestamps, and own-user RLS.
- Implement save/unsave/dismiss/undo and feedback such as wrong location, experience requirement, closed link, already applied, or other.
- Add personal shortlist browsing and propagate dismissals/preferences to that user’s recommendations/digests.
- Record feedback for evaluation without silently turning one report into global closure or inferred qualifications.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase saved/dismissed/feedback migrations`
- `frontend job actions and shortlist view`
- `personal query/digest adapters`
- `privacy tests`

### Design impact

M3 secondary/icon actions have labels and predictable optimistic/error/undo behavior; save is not application submission.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Save/dismiss operations are idempotent and user-isolated; anonymous visitors are prompted to authenticate.
- [ ] Undo/removal restores the user’s view without changing catalog availability for others.
- [ ] Feedback reasons are stored explicitly; dismissals affect that user’s shortlist/digest only.
- [ ] Failed writes revert optimistic state and show actionable errors; closed saved jobs retain history with honest status.

## 8. Verification Plan

- Two-user/anon RLS and duplicate-action concurrency tests.
- Browser save/dismiss/undo/failure and shortlist pagination tests.
- Digest exclusion/feedback isolation tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Auto-labeling a listing fraudulent/closed from one report, application submission, or opaque automatic preference changes.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
