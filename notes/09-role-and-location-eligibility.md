---
id: "09"
title: "Role families and country-scoped location eligibility"
blocked_by: ["07"]
status: blocked
branch: "V2/09-role-and-location-eligibility"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 09: Role families and country-scoped location eligibility

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/09-role-and-location-eligibility` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Normalized role/country/city/work-arrangement facts and conservative location eligibility.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Remote-US and missing locations pass the India filter, Kochi can fail, and generic backend searches accept unrelated QA roles.

## 2. Blocked By

- [ ] [07: Full JD ingestion and efficient resilient connectors](07-evidence-ingestion.md)

**Directly unblocks:** [12](12-server-side-discovery.md), [14](14-explainable-matching.md)

## 3. Derivation & Concept Notes

**Foundational fact:** “Remote” describes an arrangement, not permission to work from any country; an unknown location is not India.

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

- Normalize country/city/multi-location/work arrangement and allowed remote countries with provenance.
- Define a versioned role-family taxonomy and aliases for backend/frontend/QA/data/infrastructure and appropriate entry-level variants.
- Replace keyword-overlap bypass and India-city regex assumptions; keep ambiguous/global/non-tech cases explicit.
- Expose role/location criteria for catalog queries and candidate preferences while preserving broad shared ingestion.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `new role/location normalization module`
- `utils/scraping.py`
- `catalog normalized fields/migrations`
- `workers/worker_email.py matching adapter`

### Design impact

Location/role text must separate known facts and unknown restrictions; preference controls arrive with profile/discovery tickets.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Remote - United States is not confirmed eligible from India; worldwide/India-allowed remote and ambiguous remote are distinguished.
- [ ] Missing country is unknown; Indian city-only data is normalized with reliable evidence, including non-default hubs such as Kochi.
- [ ] Backend preference does not accept QA Analyst solely because a query contains developer/engineer.
- [ ] Multi-location/relocation and country restrictions preserve source evidence; no user filter prunes the shared catalog.

## 8. Verification Plan

- Role synonym, punctuation, multi-location, city/country, remote restriction, and missing-location fixtures.
- Query/digest integration tests using normalized fields.
- False-positive/false-negative regression cases from the review.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Worldwide geocoding paid services, guessing work authorization, or accepting remote eligibility from the word remote alone.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
