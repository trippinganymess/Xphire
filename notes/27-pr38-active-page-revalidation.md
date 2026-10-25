---
id: "27"
title: "PR #38 active-page revalidation"
blocked_by: ["23"]
status: in_review
branch: "V2/27-pr38-active-page-revalidation"
priority: P1
created: 2026-10-25
tags: [v2, pr38-remediation, implementation-ticket, learning-ticket, concept]
---

# 27: PR #38 active-page revalidation

[PR #38 remediation index](README.md#pr-38-remediation-slice) · [23: Board render recovery](23-pr38-board-rendering.md) · [Performance discovery slice](performance-discovery.md)

**Branch:** `V2/27-pr38-active-page-revalidation` is the dedicated-ticket naming convention. This approved remediation is integrated on `fix/pr38-review`, the existing PR #38 performance branch; do not create a separate branch for this exception.
**Delivers:** Active public pages revalidate their visible query when freshness/focus/visibility conditions require it, without invisible pages subscribing or polling.
**Status:** in progress. This note scopes the fix; it does not claim the fix or verification is complete.

## 1. Core Motivation & Problem

**Why are we doing this?** An extra `useJobPage` subscription causes an invisible page to remain subscribed and poll. Hidden work wastes requests/resources and can make freshness behavior difficult to reason about.

## 2. Blocked By

- [ ] [23: PR #38 board render recovery](23-pr38-board-rendering.md) — the board must render before active-versus-inactive lifecycle behavior can be verified.

## 3. Derivation & Concept Notes

**Foundational facts:** A component subscription expresses interest in state; it is not free merely because its output is not visible. Polling is a scheduled side effect and should have a clear owner and a lifecycle tied to actual demand.

**Derivation:** Trace all `useJobPage` call sites and identify which instance owns visible content. Remove the redundant/invisible subscription or scope refresh scheduling to the active page/query. Revalidate on the intended expiry and relevant focus/visibility return, while pausing periodic network work when the page is hidden or inactive.

**Structural verification:** Instrument mocked requests and mount/unmount/visibility transitions. An invisible route should not keep a poll alive; an active stale route should revalidate once for its active query, without duplicate polling/subscriptions.

<!-- Optional teaching: distinguish state subscription from rendering, derive side-effect ownership from component lifecycle, and reason about hidden-page resource use. No teaching session or quiz has been claimed. -->

## 4. Visual Model (If Needed)

<!-- A route visibility/subscription lifecycle sequence may help if behavior is non-obvious. -->

## 5. Active Recall Checkpoint

- [ ] Explain why an invisible component can still create network work through a subscription/poller.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Verify inactive/hidden quiescence and active stale-query revalidation.

Learning checkpoints are separate from implementation acceptance; no quiz or completed fix is claimed.

## 6. Implementation Scope

- Remove the redundant `useJobPage` subscription that attaches to the invisible page, or make the ownership/lifecycle precise if a replacement is necessary.
- Ensure only the active page/query is revalidated and duplicate refresh owners do not create redundant requests.
- Pause scheduled polling while hidden/inactive; resume freshness checks when the page becomes relevant again.
- Preserve stale results and current query semantics during refresh.

### Starting points

- PR #38 board route/component and all `useJobPage` call sites.
- Existing query-store cache/revalidation lifecycle and mocked browser visibility/focus tests.

### Design impact

No visual redesign. Keep the existing stale-while-revalidate user experience while eliminating unnecessary hidden work.

## 7. Acceptance Criteria

- [ ] An invisible page does not retain the extra subscription or continue its polling loop.
- [ ] An active stale page revalidates the active query when expected, without duplicate requests.
- [ ] Hidden pages pause scheduled fetches; focus/visibility return does not trigger unbounded/bulk refresh.
- [ ] Tests use deterministic clock/request fixtures and no live catalog service.

## 8. Verification Plan

- Run mocked-browser tests for active/inactive routes, tab visibility, focus return, expiry, and request counts.
- Run frontend typecheck, lint, build, and browser suite after blocker 23 is resolved.
- Record exact commands and outcomes when verified.

## 9. Out of Scope

New realtime infrastructure, changing cache TTL policy beyond what is needed for correct active-page ownership, or broader catalog-query redesign.

## 10. Execution Log

- 2026-10-25: Remediation note created; fix and verification not yet recorded here.
- 2026-10-25 (fix/pr38-review): Removed the invisible next-page subscription ("prefetch") that kept revalidating a non-displayed query every 30 seconds.
- Mocked browser regression asserts no catalog request for an unseen page.
- Fix implemented and verified; PR review pending.
- Integration target exception: `fix/pr38-review` (existing PR #38 performance branch).
- Verification: recorded in the log above; review/merge pending on PR #38.
