---
id: "18"
title: "Durable request and worker run status"
blocked_by: ["02", "06"]
status: blocked
branch: "V2/18-real-run-status"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 18: Durable request and worker run status

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/18-real-run-status` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Authenticated durable run IDs and real accepted/queued/running/no_matches/succeeded/failed outcomes.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The terminal sets completed after six seconds without observing GitHub or SMTP; worker failures/no matches are not represented durably.

## 2. Blocked By

- [ ] [02: Authenticated, bounded workflow dispatch](02-secure-dispatch.md)
- [ ] [06: Migrated, normalized job catalog and provenance](06-normalized-job-catalog.md)

**Directly unblocks:** [19](19-alert-cadence.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Accepting a request and finishing its work are separate events; timers cannot establish remote completion.

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

- Persist user-owned runs tied to 02 idempotency and correlate dispatch with worker execution through explicit request IDs.
- Replace simulated progress with authorized polling/events of real worker transitions; handle dispatch failure, timeout, cancellation, and delayed execution.
- Pass explicit run/user/query context to worker interfaces rather than preparing future concurrency through process-global environment mutations.
- Record sanitized source/persistence/delivery outcomes; SMTP skipped/missing credentials must not masquerade as success.
- Prevent overlapping ingestion/run work where necessary and add bounded workflow timeouts/concurrency; defer a new durable queue vendor until justified.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase run/event migrations and authorized status interface`
- `dispatch-workflow and .github/workflows/email_jobs.yml`
- `workers/worker_email.py, worker_schedule.py, worker_scrape.py`
- `frontend terminal/search status presentation`
- `utils/emailer.py result contract`

### Design impact

Actual state text/announcements replace fake logs. If 05 is not merged, use a minimal existing-terminal adapter without inventing a second UI.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Each accepted request has a durable authorized run ID and can be correlated to worker start/end/failure.
- [ ] No timer marks completion; dispatch rejection, no matches, stale/timeout, missing SMTP, and delivery failure are distinct.
- [ ] User A cannot inspect user B’s run/query/recipient; public status reveals no private details.
- [ ] Worker execution uses explicit context and retries/duplicate execution cannot create contradictory terminal states.

## 8. Verification Plan

- Mock dispatch/worker transition/SMTP outcomes and stale-clock recovery tests.
- Run ownership/RLS and idempotency-correlation tests.
- Browser real-status adapter tests and workflow timeout/concurrency validation.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Guaranteeing GitHub cron timeliness, leaking GitHub/PAT data, introducing a queue/microservice without need, or pretending sent means inbox-delivered.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
