---
id: "21"
title: "M3-aligned safe email digests"
blocked_by: ["03", "20"]
status: blocked
branch: "V2/21-m3-email-design"
priority: P2
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 21: M3-aligned safe email digests

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/21-m3-email-design` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Accessible client-compatible M3 digest/reminder templates with safe content and plain-text alternatives.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** The retro email differs from the approved M3 app and interpolates unescaped job content/URLs; email clients cannot rely on browser CSS tokens.

## 2. Blocked By

- [ ] [03: Material Design 3 tokens and accessible primitives](03-m3-design-system.md)
- [ ] [20: Reliable personal digests, delivery ledger, and reminders](20-reliable-digests-and-reminders.md)

**Directly unblocks:** No direct downstream blockers.

## 3. Derivation & Concept Notes

**Foundational fact:** Email is a different rendering environment; shared semantic design must be adapted, not copied as unsupported CSS/web components.

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

- Render the approved palette/type/hierarchy as inline values in table-based responsive templates with system-font fallbacks.
- Use truthful eligibility/fit/source/date/deadline/delivery language from the new data interfaces.
- Escape text/attributes, validate apply-link schemes/targets, and provide a meaningful multipart text alternative.
- Add unsubscribe/settings access appropriate to authenticated/secure consent flows and review major-client limitations without webfont/JS assumptions.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `utils/emailer.py and template/palette module`
- `digest/reminder rendering fixtures`
- `design.md §8.5`
- `safe email/settings link adapter`

### Design impact

M3 visual vocabulary without CSS variables/web components in email; restrained surfaces, readable contrast, and clear actions.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] HTML/text templates represent the same factual jobs, evidence, timestamps, and settings/reminder state.
- [ ] Hostile company/title/JD snippets and malicious URL schemes cannot inject email HTML or unsafe apply actions.
- [ ] Readable narrow layout/fallback fonts and contrast survive representative email rendering; no unsupported runtime dependency.
- [ ] Successful-send claim, source count, eligibility, and deadlines are never invented by the template.

## 8. Verification Plan

- HTML/text snapshot and escaping/link-validation fixtures.
- Representative narrow/wide browser render screenshots, explicitly labeled as not full email-client proof.
- Documented manual/client compatibility checklist and mocked multipart SMTP tests.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Claiming browser screenshots verify every mail client, embedding private content via public storage links, or sending real emails without permission.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
