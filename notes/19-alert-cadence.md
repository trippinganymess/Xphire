---
id: "19"
title: "Explicit alert cadence, timezone, and due scheduling"
blocked_by: ["05", "18"]
status: blocked
branch: "V2/19-alert-cadence"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 19: Explicit alert cadence, timezone, and due scheduling

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/19-alert-cadence` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Explicit daily/six-hour settings with next-send state, due-time processing, and correct cancellation.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The UI promises six-hour recurrence while the dispatcher processes one daily chosen slot, and execution-hour matching can miss delayed cron runs.

## 2. Blocked By

- [ ] [05: Accessible account, search, and settings forms](05-account-and-search-forms.md)
- [ ] [18: Durable request and worker run status](18-real-run-status.md)

**Directly unblocks:** [20](20-reliable-digests-and-reminders.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Cadence is a schedule rule, not a label; due work must be identified by stored time rather than assuming the runner starts on the hour.

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

- Choose explicit daily at preferred time and every-six-hours modes in settings; define timezone/quiet-time behavior and document existing-row migration.
- Store next_run_at/cadence/timezone and process due subscriptions using a safe claim/idempotency strategy rather than exact execution hour.
- Show next scheduled send and saved settings; cancellation prevents future claims and has a documented in-flight policy.
- Use explicit subscription context in workers and represent missed/delayed runs honestly.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase email_subscriptions schedule migrations`
- `supabase/functions/schedule-workflow/index.ts`
- `workers/worker_schedule.py`
- `.github/workflows/schedule_jobs.yml`
- `frontend alert settings and terminal copy`

### Design impact

M3 settings label exact cadence/timezone/next-send; avoid “every six hours” copy for daily behavior.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Daily and six-hour fixtures produce the stated next-send sequence, including timezone conversion and supported daylight-saving cases.
- [ ] Delayed/manual cron execution finds due work without missing or repeatedly claiming the same subscription.
- [ ] Subscribe/update/unsubscribe are authenticated, recipient-authorized, bounded, and ownership-tested.
- [ ] Existing daily-slot rows migrate without silently multiplying email frequency; settings and worker behavior agree.

## 8. Verification Plan

- Frozen-clock cadence/timezone/due/claim/concurrent-run/cancel fixtures.
- Migration and two-user subscription RLS/auth tests.
- Browser settings round-trip/error and next-send-label tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Guaranteeing exact inbox arrival times, silently changing daily subscribers to six-hour email, or bulk dispatch during tests.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
