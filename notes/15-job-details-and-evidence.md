---
id: "15"
title: "Job details with eligibility and fit explanations"
blocked_by: ["12", "14"]
status: blocked
branch: "V2/15-job-details-and-evidence"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 15: Job details with eligibility and fit explanations

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/15-job-details-and-evidence` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A readable M3 detail view and evidence-first card hierarchy that makes application decisions fast.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** A card with title/stars does not explain why a role is suitable, which requirement blocks the user, or whether its dates/link are trustworthy.

## 2. Blocked By

- [ ] [12: Consistent server-filtered and paginated discovery](12-server-side-discovery.md)
- [ ] [14: Hard-filtered, explainable candidate matching](14-explainable-matching.md)

**Directly unblocks:** [16](16-personal-shortlist.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A recommendation should be inspectable against its source facts; unknown and missing qualifications are not interchangeable.

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

- Add detail navigation/deep-link behavior and safe rendering of normalized JD/source evidence.
- Show fresher eligibility, mandatory checks, matched/missing required/preferred skills, degree/batch/availability restrictions, and unknowns.
- Show source-posted/discovered/verified timestamps and known deadline separately; original employer apply link remains clear.
- Personalize only authenticated private sections; public viewers see public job facts without leaking another user’s profile/match data.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `frontend job card/detail route/view modules`
- `catalog/private match query adapters`
- `frontend safe rich/plain JD rendering`
- `design.md card/detail behavior`

### Design impact

Implements §8.3 hierarchy with M3 surfaces, visible evidence, readable body text, and responsive detail layout.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Every displayed eligibility/match reason traces to a job/candidate fact or an explicit unknown.
- [ ] Public view exposes no private evidence; authenticated match explanations use only that user’s results.
- [ ] JD HTML/links are rendered safely, long content wraps, and missing dates/compensation/deadline are honest.
- [ ] Apply link works only for a valid known original target and never marks the job submitted.

## 8. Verification Plan

- Mocked detail/deep-link/navigation/missing-job and hostile-content fixtures.
- Public/authenticated cross-user view tests.
- Responsive/accessibility screenshots plus date-label and match-evidence integration tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Saving/applying state before its tickets, embedding untrusted HTML, or displaying invented posting/deadline facts.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
