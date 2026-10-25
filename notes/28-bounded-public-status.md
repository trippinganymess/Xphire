---
id: "28"
title: "Bounded public status requests"
blocked_by: []
status: in_review
branch: "V2/28-bounded-public-status"
priority: P0
created: 2026-10-25
tags: [v2, pr38-remediation, implementation-ticket, learning-ticket, concept]
---

# 28: Bounded public status requests

[PR #38 remediation index](README.md#pr-38-remediation-slice)

**Branch:** `V2/28-bounded-public-status` is the dedicated-ticket naming convention. This approved remediation is integrated on `fix/pr38-review`, the existing PR #38 performance branch; do not create a separate branch for this exception.
**Delivers:** Public status reads whose work and upstream usage are bounded, without exposing or spending an unbounded personal access token (PAT) quota.
**Status:** in progress. This note scopes the fix; it does not claim the fix or verification is complete.

## 1. Core Motivation & Problem

**Why are we doing this?** An unauthenticated public GET spends a PAT quota and makes service calls without a bound. A cheap-looking read endpoint can therefore consume privileged upstream capacity under arbitrary repeated traffic.

## 2. Blocked By

- None (independent security/resource-boundary remediation; can start immediately).

## 3. Derivation & Concept Notes

**Foundational facts:** Public reachability means an endpoint can be called repeatedly by anyone; authentication alone is not a resource bound, and a cache alone is not a bound unless its miss/work behavior is itself constrained. Secret-backed upstream calls create a privileged cost and should have explicit limits.

**Derivation:** Inventory what the status endpoint reads and why it requires the PAT. Remove or minimize privileged calls from the public path where possible; where status must remain public, bound request frequency, upstream call count, response size, and concurrency/work duration with a clear failure behavior. Ensure cache misses or attacker-varied parameters cannot bypass those bounds. Do not expose token material or private workflow details.

**Structural verification:** Use mocked PAT/service boundaries and a deterministic clock to issue repeated and varied public requests. Assert the total upstream call/work limit, cache behavior under misses, safe response projection, and predictable throttling/failure behavior. No real PAT or service call is needed.

<!-- Optional teaching: explain public attack surface, quota amplification, and why cache and rate/concurrency/work bounds solve different problems. No teaching session or quiz has been claimed. -->

## 4. Visual Model (If Needed)

<!-- A request → cache → bounded service-call flow can be added if it clarifies the limit boundary. -->

## 5. Active Recall Checkpoint

- [ ] Explain how an anonymous endpoint can amplify privileged PAT/service costs and why cache alone may not bound it.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Verify repeated requests and cache misses against explicit finite resource bounds.

Learning checkpoints are separate from implementation acceptance; no quiz or completed fix is claimed.

## 6. Implementation Scope

- Bound public status endpoint work, service calls, and any PAT use; remove PAT dependence if the public contract can be served without it.
- Add rate/concurrency/timeout or equivalent explicit limits appropriate to the deployed runtime and ensure parameter variation cannot defeat them.
- Return only the minimal public status projection; keep secrets and private run/workflow details out of output and logs.
- Define safe cache behavior as an optimization, not the sole abuse-control mechanism.

### Starting points

- PR #38 public status GET handler and its PAT/service-call boundary.
- Existing mocked edge/API tests and local/offline endpoint test tooling.

### Design impact

Preserve the public status contract where possible; do not introduce authentication requirements without confirming callers and approved product behavior. Resource safety is mandatory even when read access remains public.

## 7. Acceptance Criteria

- [ ] Repeated anonymous requests have a documented, finite bound on service/PAT work and concurrency/time.
- [ ] Cache misses, varied parameters, and expired entries cannot cause unbounded upstream calls.
- [ ] Public responses contain only approved status fields; no PAT, private identity, or sensitive workflow data leaks.
- [ ] Offline mocked tests cover limits/throttling/cache behavior without using a real PAT or external service.

## 8. Verification Plan

- Exercise the public endpoint via local/mock handler tests with synthetic service/PAT responses and deterministic rate/time controls.
- Verify request/work limits and sanitized public projection under repeated and cache-miss scenarios.
- Run applicable type/lint/tests and record exact outcomes; do not spend a real token quota for verification.

## 9. Out of Scope

Building a new authentication system, redesigning workflow status lifecycle, or relying on undocumented upstream quota behavior as the safety bound.

## 10. Execution Log

- 2026-10-25: Remediation note created; fix and verification not yet recorded here.
- 2026-10-25 (fix/pr38-review): Public GET now uses a database-backed cross-instance snapshot cache (migration 004) and a global request budget; GitHub reads are budgeted separately and fail closed with 429/Retry-After. Handler tests and disposable-PostgreSQL contract/concurrency suites pass.
- Fix implemented and verified; PR review pending.
- Integration target exception: `fix/pr38-review` (existing PR #38 performance branch).
- Verification: recorded in the log above; review/merge pending on PR #38.
