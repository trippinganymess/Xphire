---
id: "20"
title: "Reliable personal digests, delivery ledger, and reminders"
blocked_by: ["10", "14", "16", "19"]
status: blocked
branch: "V2/20-reliable-digests-and-reminders"
priority: P2
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 20: Reliable personal digests, delivery ledger, and reminders

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/20-reliable-digests-and-reminders` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A user/job digest ledger with bounded delivery retries, high-fit selection, and source-backed deadline reminders.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Catalog deduplication is global, not per-user delivery tracking; repeats, failures, no matches, and deadline reminders need explicit behavior.

## 2. Blocked By

- [ ] [10: Verified open-job lifecycle and truthful timestamps](10-open-job-lifecycle.md)
- [ ] [14: Hard-filtered, explainable candidate matching](14-explainable-matching.md)
- [ ] [16: Private saved jobs, dismissals, and relevance feedback](16-personal-shortlist.md)
- [ ] [19: Explicit alert cadence, timezone, and due scheduling](19-alert-cadence.md)

**Directly unblocks:** [21](21-m3-email-design.md), [22](22-quality-evaluation.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Knowing a job exists is different from knowing it was sent to a user; SMTP acceptance cannot guarantee final inbox delivery.

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

- Build personalized high-fit verified-open digests from shared catalog; respect saved/dismissed/employer/location preferences and explicit unknown handling.
- Track planned/attempted/sent/failed delivery and per-user/job inclusion with durable idempotency; avoid repeated jobs and unsent-state confusion.
- Add bounded retry/backoff, sanitized failure visibility, and documented no-match notifications/cadence; do not guarantee fixed digest volume.
- Add opt-in upcoming-deadline reminders only for known source deadlines, deduplicated and suppressed for dismissed/closed/confirmed-applied jobs. Ticket 16's explicit “already applied” feedback is available at this frontier; consume tracker confirmations when 17 also ships.
- Prefer catalog-backed delivery; isolate any requested live refresh from delivery so connector/model failure cannot erase useful verified cache results.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `private delivery/digest/reminder migrations and RLS`
- `workers/worker_email.py, worker_schedule.py`
- `utils/emailer.py result/retry interface`
- `personal match/shortlist/lifecycle adapters`
- `frontend delivery/reminder settings/status`

### Design impact

Honest digest/no-match/failure/reminder copy; recipient-facing M3 email styling is handled in 21.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Repeated/concurrent dispatch and retries do not silently resend the same successful user/job digest; failure/retry state remains inspectable.
- [ ] Selected jobs obey hard eligibility/open status/preferences and transparent fit ranking, not company-star-first order.
- [ ] No-match and failed runs differ; cached verified roles survive live-source/model failure.
- [ ] Reminders require a known future deadline, explicit consent, and no confirmed submission/dismissal/closure; dates/timezones are correct.
- [ ] Per-user delivery and recipient metadata are private; retry and SMTP status claims match what is actually observed.

## 8. Verification Plan

- Frozen-clock per-user ledger, duplicate/concurrent send, retry/failure/no-match/cache fallback scenarios.
- Reminder consent/deadline/applied/dismissed/closed suppression tests with mocked SMTP.
- RLS/ownership and digest-selection integration tests; no live mail in CI.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Exactly-once delivery guarantees across SMTP/provider failures, unseen deadline guesses, or using catalog Seen_job as a private delivery ledger.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
