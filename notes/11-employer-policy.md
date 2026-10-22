---
id: "11"
title: "Candidate-controlled employer preferences and factual risks"
blocked_by: ["06"]
status: blocked
branch: "V2/11-employer-policy"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 11: Candidate-controlled employer preferences and factual risks

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/11-employer-policy` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Broad employer coverage by default, with optional preference hooks and evidence-based risk representation.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** An unconditional JobSpy blocklist removes graduate-hiring employers, while company stars mix prestige/category with quality and vary by source.

## 2. Blocked By

- [ ] [06: Migrated, normalized job catalog and provenance](06-normalized-job-catalog.md)

**Directly unblocks:** [12](12-server-side-discovery.md), [14](14-explainable-matching.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A personal employer preference is not a universal eligibility rule; suspicion without evidence is not a verified risk.

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

- Remove unconditional mass-employer exclusions from shared ingestion and harmonize behavior across ATS/JobSpy.
- Define optional include/exclude employer preferences and canonical employer aliases for later profile/UI integration.
- Separate company metadata/preferences from eligibility/fit; make stars non-authoritative or deprecate them with compatibility documentation.
- Represent only source-backed risks such as explicit payment requirements with evidence/unknown handling, not arbitrary employer-category penalties.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `utils/scraping.py MASS_RECRUITERS/filter usage`
- `utils/ai_reviewer.py rating contract`
- `workers/worker_email.py ranking/filter compatibility`
- `employer preference/risk schema and tests`

### Design impact

Avoid reputation stars as the primary quality indicator; future controls must be opt-in and clearly labeled preferences.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Previously blocked employers can enter the shared catalog from any supported source.
- [ ] Default candidate discovery does not inherit an unconditional blocklist; opt-in exclusions are isolated to a user/query.
- [ ] Company reputation does not confirm eligibility or override required-skill matching.
- [ ] Risk labels have evidence and source provenance; ambiguous categories remain unknown rather than stigmatized.

## 8. Verification Plan

- Employer alias/blocked-employer/source-consistency fixtures.
- Compatibility tests for legacy star settings and absence of global exclusions.
- Risk-evidence/false-positive tests and canonical-employer preference tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Claiming all large service employers are unsafe, publishing unsupported accusations, or full personalized scoring.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
