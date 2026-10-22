---
id: "06"
title: "Migrated, normalized job catalog and provenance"
blocked_by: ["01"]
status: blocked
branch: "V2/06-normalized-job-catalog"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 06: Migrated, normalized job catalog and provenance

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/06-normalized-job-catalog` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A reproducible shared job schema and canonical cross-source identity with safe compatibility migration.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** JobSpy IDs and ATS title/company/URL hashes have different identity semantics; job/profile base schemas are not fully captured in migrations.

## 2. Blocked By

- [ ] [01: Reproducible quality and regression foundation](01-quality-foundation.md)

**Directly unblocks:** [07](07-evidence-ingestion.md), [11](11-employer-policy.md), [13](13-private-candidate-profile.md), [18](18-real-run-status.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A job requisition and a source observation are different records; changing display text must not create a new underlying job.

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

- Inspect existing database shape safely and capture the required catalog schema in additive migrations/backfill steps.
- Define normalized employer/requisition/canonical apply identity and source observations/provenance; handle absent provider IDs conservatively.
- Reserve JD/experience/location/employment/deadline and lifecycle fields with explicit unknown values for later tickets.
- Provide adapter/compatibility access for board/email during migration; audit public projection and profile schema assumptions without exposing private data.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase/migrations/`
- `utils/deduper.py`
- `utils/scraping.py normalization interfaces`
- `frontend/src/components/JobBoard.tsx types`
- `workers/worker_email.py catalog adapter`

### Design impact

No visual redesign. Document public/private fields and current-versus-target schema in design.md.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Clean database setup and migration/backfill from existing records are tested; no destructive schema assumption is made.
- [ ] Same requisition from two sources canonicalizes where evidence permits; different requisitions are not merged solely by title/employer.
- [ ] Missing/blank IDs and URLs cannot collapse unrelated jobs; invalid external schemes are rejected.
- [ ] Existing readers remain functional; public selects cannot include future candidate/application/credential fields.

## 8. Verification Plan

- Local migration, rollback/recovery-plan, compatibility, and canonical-identity fixtures.
- Cross-source URLs/tracking parameters/title edits/distinct-location requisitions tests.
- Public/private projection and adapter contract tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Live destructive migrations, full JD extraction, deciding eligibility, or interpreting same-title postings as duplicates without evidence.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
