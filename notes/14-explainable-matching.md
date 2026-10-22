---
id: "14"
title: "Hard-filtered, explainable candidate matching"
blocked_by: ["08", "09", "10", "11", "13"]
status: blocked
branch: "V2/14-explainable-matching"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 14: Hard-filtered, explainable candidate matching

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/14-explainable-matching` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Deterministic mandatory eligibility outcomes and a transparent evidence-backed ranking for eligible/uncertain jobs.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Company stars and generic keyword overlap do not answer whether this candidate qualifies; unknown restrictions must not silently become matches.

## 2. Blocked By

- [ ] [08: Evidence-based fresher eligibility](08-fresher-eligibility.md)
- [ ] [09: Role families and country-scoped location eligibility](09-role-and-location-eligibility.md)
- [ ] [10: Verified open-job lifecycle and truthful timestamps](10-open-job-lifecycle.md)
- [ ] [11: Candidate-controlled employer preferences and factual risks](11-employer-policy.md)
- [ ] [13: Private evidence-backed candidate profile and preferences](13-private-candidate-profile.md)

**Directly unblocks:** [15](15-job-details-and-evidence.md), [20](20-reliable-digests-and-reminders.md), [22](22-quality-evaluation.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Ranking cannot repair a failed mandatory condition; only after hard checks should preferences and evidence coverage affect order.

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

- Apply experience, degree/batch, role, country/remote/work eligibility, employment/availability, open status, and explicit compensation restrictions where facts exist.
- Distinguish failed, passed, and unknown conditions; keep required versus preferred skills separate.
- Normalize skill aliases with a versioned taxonomy and calculate a documented breakdown from candidate-supported evidence, preferences, and freshness.
- Store private match results keyed to profile/job/rule versions; avoid stale scores and replace company-star-first digest ranking.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `new matching module and skill taxonomy`
- `supabase private match-result migrations/RLS`
- `workers/worker_email.py ranking`
- `profile/catalog matching adapter`

### Design impact

Fit is separate from company metadata and generic fresher eligibility; display score components/reasons, not just an opaque percentage.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Failed mandatory condition excludes recommendation regardless of employer prestige or optional-skill coverage.
- [ ] Unknown restrictions remain visibly unknown; required/preferred skill and missing-evidence/absent-skill cases differ.
- [ ] Matched/missing terms and each score component derive from stored JD/candidate evidence; deterministic weights/rule version are recorded.
- [ ] Profile/job changes invalidate stale matches; cross-user match results are isolated.
- [ ] Daily digest and personal discovery can consume the same eligible-job ranking without arbitrary company-star dominance.

## 8. Verification Plan

- Curated JD/profile positive, negative, ambiguous, restriction, and skill-alias matrix.
- Scoring determinism/version invalidation and hard-filter precedence tests.
- RLS and board/digest ranking adapter integration tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Fabricating missing skills, a black-box LLM fit verdict, assuming unspecified compensation/work authorization, or auto-submission.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
