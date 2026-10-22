---
id: "10"
title: "Verified open-job lifecycle and truthful timestamps"
blocked_by: ["07"]
status: blocked
branch: "V2/10-open-job-lifecycle"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 10: Verified open-job lifecycle and truthful timestamps

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/10-open-job-lifecycle` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Independent observation/verification lifecycle and reliable open/closed/stale state.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Already-seen jobs never refresh, then disappear from 24-hour browsing/six-hour cache even if still open; source posting and discovery time are conflated.

## 2. Blocked By

- [ ] [07: Full JD ingestion and efficient resilient connectors](07-evidence-ingestion.md)

**Directly unblocks:** [12](12-server-side-discovery.md), [14](14-explainable-matching.md), [20](20-reliable-digests-and-reminders.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A first observation date, a source posting date, and an open-status verification are different facts; a transient failure proves none of them false.

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

- Track source_posted_at, first_seen_at, last_seen_at, last_verified_at, closed_at and status/reason with UTC storage.
- Update existing observations on rediscovery without unnecessary re-enrichment; re-enrich changed evidence/versioned rules as needed.
- Verify canonical apply/requisition availability, distinguish explicit closure from unavailable/blocked/transient responses, and define configurable stale/retry rules.
- Expose verified-open catalog selection separately from posted-recently selection and preserve unknown source dates.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `utils/deduper.py and new lifecycle/verifier module`
- `workers/worker_scrape.py, worker_email.py`
- `supabase lifecycle/index migrations`
- `catalog query interface`

### Design impact

Labels must say Posted, Discovered, or Verified accurately. Do not label an old open role as newly posted.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Rediscovered existing jobs update observation time and remain available beyond 24h while verified open.
- [ ] Open/closed/stale/verification-unavailable outcomes have source evidence; transient 429/timeout/403 does not silently close a role.
- [ ] Changed description triggers a documented refresh without altering first_seen_at or inventing source_posted_at.
- [ ] Invalid/dead/canonical apply links are handled with safe URL checks; lifecycle updates are idempotent and clock-testable.

## 8. Verification Plan

- Frozen-clock rediscovery/cache-window and stale/closure lifecycle tests.
- Verifier fixtures for explicit removed requisition, redirects, 404, blocked, timeout, 429, and recovery.
- Migration/backfill and repeated-cycle integration tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Blind HEAD-only closure decisions, live mass URL checks in CI, or resetting posting dates to collection time.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
