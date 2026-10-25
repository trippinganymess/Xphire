---
id: "29"
title: "PR #38 secure email dispatch"
blocked_by: ["01"]
status: in_review
branch: "V2/29-secure-email-dispatch"
priority: P0
created: 2026-10-25
tags: [v2, pr38-remediation, implementation-ticket, learning-ticket, concept]
---

# 29: PR #38 secure email dispatch

[PR #38 remediation index](README.md#pr-38-remediation-slice) · [01: Quality foundation](01-quality-foundation.md) · [02: Authenticated, bounded workflow dispatch](02-secure-dispatch.md)

**Branch:** `V2/29-secure-email-dispatch` is the dedicated-ticket naming convention. This approved remediation is integrated on `fix/pr38-review`, the existing PR #38 performance branch; do not create a separate branch for this exception.
**Delivers:** An email dispatch path authorized to the caller/allowed recipient, with durable limits and replay protection rather than an open arbitrary-recipient send surface.
**Status:** in progress. This note scopes the fix; it does not claim the fix or verification is complete.

## 1. Core Motivation & Problem

**Why are we doing this?** The existing email dispatch is open: it has no effective authorization and accepts an arbitrary recipient. The verified quality foundation provides offline seams and regression infrastructure; the predecessor security ticket 02 remains separately tracked for authenticated workflow dispatch and is not a prerequisite for this remediation.

## 2. Blocked By

- [ ] [01: Reproducible quality and regression foundation](01-quality-foundation.md) — prerequisite quality/test foundation is already implemented and merged. This link records the verified foundation dependency; it does not claim ticket 02 is complete or incorrectly require the broader workflow-dispatch ticket.

## 3. Derivation & Concept Notes

**Foundational facts:** A recipient supplied in a request is untrusted input, not proof of authority. A privileged send must be authorized against a verified caller and approved recipient policy. Limits and replay protection must survive concurrent/retried requests; an in-memory check alone cannot guarantee that property across instances/restarts.

**Derivation:** Resolve the caller's identity server-side before any email side effect. Restrict recipient to the caller's verified email or an explicitly authorized flow. Validate request shape and bounds, then apply durable per-user quotas and idempotency/replay protection before sending. Keep credentials server-side and return sanitized outcomes. The quality foundation in 01 enables repeatable offline tests; ticket 02 remains a distinct workflow-dispatch scope and is not silently marked complete by this finding.

**Structural verification:** Mock authentication, persistence, and email delivery. Test unauthenticated/invalid identities, arbitrary recipients, malformed inputs, quota exhaustion, duplicate/replayed requests, and concurrent attempts; assert rejected requests cause no send and no cross-user data access.

<!-- Optional teaching: distinguish identity, authorization, recipient ownership, quotas, and idempotency; derive why each check must precede the external send. No teaching session or quiz has been claimed. -->

## 4. Visual Model (If Needed)

<!-- A trust-boundary sequence may help: authenticate → authorize recipient → durable limit/idempotency → dispatch. -->

## 5. Active Recall Checkpoint

- [ ] Explain why caller identity does not by itself authorize an arbitrary recipient or unlimited sends.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Verify rejected and replayed requests produce no email side effect.

Learning checkpoints are separate from implementation acceptance; no quiz or completed fix is claimed.

## 6. Implementation Scope

- Require verified caller authentication and perform handler-level identity checks before any send/service call.
- Authorize recipient ownership/explicit consent; reject arbitrary recipient addresses.
- Validate method, body size, input types, and finite bounds.
- Enforce persistent quotas/rate limits and durable idempotency/replay protection, including concurrent requests.
- Keep mail/service secrets server-side and sanitize errors/logs and response data.

### Starting points

- Existing PR #38 email dispatch handler/configuration and its SMTP/emailer boundary.
- Merged quality foundation 01 test fixtures; existing secure-dispatch predecessor note 02 for relevant patterns, without making its unimplemented broader scope a blocker.
- Database/migration and local edge-function test patterns, if needed for durable controls.

### Design impact

Preserve the intended email workflow while narrowing who can trigger it and where it can send. The UI must show truthful rejection/acceptance; no secret or arbitrary recipient is exposed.

## 7. Acceptance Criteria

- [ ] Missing/invalid identity, unauthorized recipient, malformed/oversized input, or exhausted limits are rejected before mail delivery.
- [ ] A valid authorized request can send at most once for a repeated idempotency key, including concurrent retry attempts.
- [ ] Durable quotas cannot be bypassed by process restart or parallel requests; users cannot access one another's limit/idempotency records.
- [ ] SMTP/service secrets and sensitive recipient details do not leak to browser output or logs.
- [ ] Offline tests mock identity, persistence, and mail; no real mail is sent.

## 8. Verification Plan

- Use isolated local database/edge-function tests and mocked SMTP/emailer; verify authorization, recipient policy, durable quotas, replay/concurrency, and cross-user isolation.
- Verify rejected calls make zero external send calls; inspect sanitized responses/logs.
- Run applicable type/lint/tests and document exact commands/results after implementation. Never send a real email for verification.

## 9. Out of Scope

Marking ticket 02 complete, arbitrary alternate-recipient support without explicit verified consent, production deployment, or treating a mocked SMTP acceptance as inbox delivery.

## 10. Execution Log

- 2026-10-25: Remediation note created; fix and verification not yet recorded here.
- 2026-10-25 (fix/pr38-review): Implemented the notes/02 policy: verified non-anonymous Supabase identity, account-email-only recipient, bounded validated payloads, mandatory UUID idempotency key, durable per-user/global quotas with replay/conflict handling (migration 005). Terminal preserves retry keys. Handler tests (18) and disposable-PostgreSQL contract/concurrency suites pass.
- Fix implemented and verified; PR review pending.
- Dependency clarification: 01 is the implemented/merged quality foundation prerequisite. Ticket 02 is referenced for context only and is not a blocker for this specific email finding.
- Integration target exception: `fix/pr38-review` (existing PR #38 performance branch).
- Verification: recorded in the log above; review/merge pending on PR #38.
