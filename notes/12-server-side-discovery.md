---
id: "12"
title: "Consistent server-filtered and paginated discovery"
blocked_by: ["04", "08", "09", "10", "11"]
status: blocked
branch: "V2/12-server-side-discovery"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 12: Consistent server-filtered and paginated discovery

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/12-server-side-discovery` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** One catalog query contract with filters before pagination, stable ordering, and honest board/digest states.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The board filters only the newest 1,000 fetched rows, and cache filters freshers after an earlier limit. Fetch failures masquerade as no matches.

## 2. Blocked By

- [ ] [04: M3 shared shell and responsive board](04-m3-shell-and-board.md)
- [ ] [08: Evidence-based fresher eligibility](08-fresher-eligibility.md)
- [ ] [09: Role families and country-scoped location eligibility](09-role-and-location-eligibility.md)
- [ ] [10: Verified open-job lifecycle and truthful timestamps](10-open-job-lifecycle.md)
- [ ] [11: Candidate-controlled employer preferences and factual risks](11-employer-policy.md)

**Directly unblocks:** [15](15-job-details-and-evidence.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Filtering a limited sample is not filtering the catalog; no matching rows and a failed query are different outcomes.

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

- Push supported role/location/eligibility/employer/freshness filters into safe parameterized Supabase queries before limit/page selection.
- Use stable tie-breaking pagination and documented ordering; cache and board reuse the same predicate semantics.
- Provide recent-posted versus verified-open views, explicit unknown-eligibility handling, source filters, clear/reset controls and usable result counts.
- Separate initial loading, background refresh, no matches, stale results, and fetch error with retry; avoid fetching the full catalog every minute.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `frontend/src/components/JobBoard.tsx and catalog query module`
- `workers/worker_email.py cache/query adapter`
- `Supabase query/index/view or RPC migration`
- `discovery filter UI/tests`

### Design impact

M3 filter controls/chips and separate feedback states; readable, responsive results rather than a client-only bulk list.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] An eligible job outside the former top 1,000/latest sample is discoverable by filtered query.
- [ ] Filtering precedes board/cache pagination; no 60-row post-filter starvation in digests.
- [ ] Stable pagination avoids duplicate/missing rows on equal timestamps; keyword inputs are safely encoded/parameterized and trimmed.
- [ ] Database failures show retryable error state, not no matches; background updates preserve focus and useful previous results.
- [ ] Board/digest predicates agree for role, experience, location, employer policy, and lifecycle.

## 8. Verification Plan

- Local database fixtures exceeding former limits; pagination/tie/combined-filter tests.
- Mocked browser error/loading/refresh/unknown/empty and clear-filter tests.
- Query performance/explain checks at representative fixture volume, build/lint/type checks.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

A personalized fit score before 14, loading all rows into the browser, or inventing reliable realtime behavior without deployment configuration.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
