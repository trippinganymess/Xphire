---
id: "25"
title: "PR #38 semantic refresh control"
blocked_by: ["23"]
status: in_review
branch: "V2/25-pr38-semantic-refresh-control"
priority: P1
created: 2026-10-25
tags: [v2, pr38-remediation, implementation-ticket, learning-ticket, concept]
---

# 25: PR #38 semantic refresh control

[PR #38 remediation index](README.md#pr-38-remediation-slice) · [23: Board render recovery](23-pr38-board-rendering.md)

**Branch:** `V2/25-pr38-semantic-refresh-control` is the dedicated-ticket naming convention. This approved remediation is integrated on `fix/pr38-review`, the existing PR #38 performance branch; do not create a separate branch for this exception.
**Delivers:** A refresh control whose accessible name, state, and visual treatment use defined design tokens rather than an undefined literal color token.
**Status:** in progress. This note scopes the fix; it does not claim the fix or verification is complete.

## 1. Core Motivation & Problem

**Why are we doing this?** The refresh control references a literal color token named `cyan` that is not defined in the design system. The control can therefore render incorrectly and does not reliably communicate its action/state accessibly.

## 2. Blocked By

- [ ] [23: PR #38 board render recovery](23-pr38-board-rendering.md) — the board must render before validating its control in context.

## 3. Derivation & Concept Notes

**Foundational facts:** A semantic control exposes its purpose and state to assistive technology; color alone cannot carry that meaning. A design-token reference is valid only when the token is actually defined and available in the component's theme context.

**Derivation:** Inspect the control's role, accessible name, disabled/busy state, and token usage. Replace the undefined color reference with an existing semantic token (or a deliberately defined token only if that is already part of the approved system), and ensure refresh progress is expressed in text/ARIA state as well as styling.

**Structural verification:** Check for undefined token references in the relevant component/styles, then test keyboard use and accessible name/state in the mocked browser. Validate that the control remains legible in the existing theme without relying on color as the only signal.

<!-- Optional teaching: connect semantic HTML/ARIA, theme token contracts, and non-color status cues; derive accessible refresh behavior from the interaction states. No teaching session or quiz has been claimed. -->

## 4. Visual Model (If Needed)

<!-- No diagram needed; use an accessibility tree/browser assertion if helpful. -->

## 5. Active Recall Checkpoint

- [ ] Explain why defined tokens and semantic state matter independently of visual color.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Verify the refresh control with keyboard and accessible role/name/state checks.

Learning checkpoints are separate from implementation acceptance; no quiz or completed fix is claimed.

## 6. Implementation Scope

- Replace the undefined literal `cyan` reference with an existing appropriate semantic design token.
- Ensure the refresh affordance has a useful accessible name and announces any relevant busy/disabled state.
- Preserve the existing layout and refresh behavior.

### Starting points

- PR #38 board refresh-control component and current design token definitions.
- Existing mocked-browser accessibility/interaction checks.

### Design impact

No new palette or visual system. Keep the control consistent with the current semantic paper/ink tokens and component patterns.

## 7. Acceptance Criteria

- [ ] The refresh control no longer references an undefined cyan token.
- [ ] Its action and any busy state are available through accessible semantics, not color alone.
- [ ] Keyboard interaction and contrast/legibility remain correct in the existing theme.
- [ ] Offline UI tests validate behavior without live services.

## 8. Verification Plan

- Search the touched control/style path for unresolved token names and inspect the defined token source.
- Run mocked-browser checks for role/name/state and keyboard activation.
- Run frontend typecheck, lint, production build, and browser suite after blocker 23 is resolved.

## 9. Out of Scope

A broader color-system redesign, adding arbitrary palette values, or changing catalog refresh semantics.

## 10. Execution Log

- 2026-10-25: Remediation note created; fix and verification not yet recorded here.
- 2026-10-25 (fix/pr38-review): The REFRESH control now reuses existing paper/ink shell tokens; no new literal palette and no undefined `--cyan-neon` dependency.
- Mocked browser refresh suites and build pass.
- Fix implemented and verified; PR review pending.
- Integration target exception: `fix/pr38-review` (existing PR #38 performance branch).
- Verification: recorded in the log above; review/merge pending on PR #38.
