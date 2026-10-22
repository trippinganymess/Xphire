# Xphire design baseline and V2 design contract

> Status: current implementation recorded; V2 Material Design 3 direction approved.
> Recorded: 2026-10-22. Current-state source: commit `587df22af02bf97d958aeb27edfd9d725f40f1d7`.
> This document does not claim that the V2 target is implemented or that the deployed database was inspected.

## 1. Purpose and reading rules

Keep Xphire consistent while improving discovery for fresher and entry-level candidates. This document has two deliberately separate parts:

- **Current state (§2–6):** what the checked-in application implements, including limitations. It is a historical baseline, not a prescription to retain defects.
- **V2 contract (§7–12):** the approved target for future work. V2 moves to **Material Design 3 (M3), web-first**, rather than extending the sketch/neon aesthetic.

Each V2 ticket must link here, identify the surfaces it changes, and update this document when an approved decision changes. Do not describe a planned feature as shipped. `APPLICATION_PIPELINE_PLAN.md` is a separate, currently untracked proposal; its resume, GitHub, submission, and inbox features are not part of the implemented application.

## 2. Current product and navigation

Xphire is a job-discovery and email-digest application, not an application-submission system.

| Surface | Implemented behavior | Source |
|---|---|---|
| `#/` | Public job board with keyword, minimum-star, and fresher filters | `frontend/src/components/JobBoard.tsx` |
| `#/terminal` | Terminal-driven sign-up/sign-in, one-time search, scheduling, cancellation, and informational commands | `frontend/src/components/SketchTerminal.tsx` |
| Shared header | Home logo, title, avatar/sign-out menu; terminal-access link on board; status bulb on terminal | `frontend/src/components/SketchHeader.tsx` |
| Email digest | Table-based HTML cards and SMTP delivery; up to 20 jobs | `utils/emailer.py`, `workers/worker_email.py` |

`App.tsx` uses React Router's `HashRouter`, restores Supabase sessions, and fetches an optional profile from `users`. Only the board and terminal are routed. `WorkflowFilters`, `SignupCard`, `NeonButton`, `NeonInput`, and `HeatmapBg` are not the active routed experience; their older mock/neon styling must not be mistaken for the design baseline.

## 3. Current visual system (historical)

### 3.1 Identity and tokens

The active UI is paper/sketch/retro-terminal: white dotted paper, dark ink, irregular heavy outlines, offset hard shadows, pixel headings, yellow job cards, and a mustard terminal body.

Authoritative current declarations are in `frontend/src/index.css`; route-specific values are in the header, terminal, and board CSS files.

| Current token or use | Declared value |
|---|---|
| `--paper-bg` | `#FFFFFF` |
| `--paper-surface` | `#FAFAFA` |
| `--ink-black`, `--border-sketch` | `#121214` |
| `--ink-charcoal` | `#27272A` |
| `--ink-muted`, `--ink-light` | `#71717A`, `#A1A1AA` |
| Online/running bulbs | `#00E676`, `#FFD600`, with glow animations |
| Job cards and apply buttons | Hardcoded `#FFE600` |
| Terminal body | Hardcoded `#D4AC0D` |
| Dot grid | `#E4E4E7` dots at 24px spacing |
| Borders | 2px or 2.5px solid dark ink |
| Shadows | 3px or 5px offset, no blur |
| Shape | Irregular elliptical radii; 16px pill radii |
| Spacing scale | 4, 8, 16, 24, 32px |

### 3.2 Typography and layout

- Pixel headings use `Bitcount Single`, loaded in `frontend/index.html`.
- Body fallback is `Patrick Hand`/`Caveat`; job cards, controls, and terminal use `JetBrains Mono`/`Courier New`.
- Root container: `75vw`, max 1440px, min 320px, centered, 32px/16px padding.
- Header: horizontal, no wrapping; 56px corner controls, reduced to 40px at 600px.
- Board: wrapping filter row; auto-fill grid with a 300px minimum card width and 24px gap.
- Terminal: min-height 580px, max-height 78vh, internal vertical scrolling; smaller typography and min-height 440px at 600px.
- Card hover moves up/left with a larger hard shadow; pressed actions move down/right.
- Terminal has a blinking cursor and pulsing status bulb.

### 3.3 Existing inconsistencies, not requirements

- Board styles reference undefined `--cyan-neon`, `--pink-neon`, `--lime-neon`, related light colors, and `--yellow-light`.
- Legacy neon controls reference token families that are absent from the active root styles.
- Some surfaces, typography, and state colors are hardcoded; there is no complete semantic token contract.
- Header/avatar overflow can clip the sign-out dropdown. The header sign-out callback clears local UI state without itself signing out of Supabase.
- `frontend/index.html` lacks a viewport meta tag. Small-screen sizing, long prompt labels, and minimum grid widths need explicit verification.
- Focus styling, reduced-motion support, semantic labels, and status contrast are not a verified accessibility baseline.
- Current screenshots and `frontend/verify_ui.cjs` are historical artifacts, not authoritative passing tests for today's routes/auth flow.

## 4. Current technical architecture

### 4.1 Runtime shape

```text
Visitor browser
  ├─ React + TypeScript + Vite static SPA on Cloudflare Workers Assets
  ├─ Supabase Auth, public job reads, and profile access (profile RLS unverified)
  └─ Supabase Edge Functions
       ├─ dispatch-workflow → GitHub Actions email_jobs.yml
       └─ schedule-workflow → private email_subscriptions row

GitHub Actions
  ├─ scrape_jobs.yml → worker_scrape → ATS + JobSpy → dedup → Gemini → Seen_job
  ├─ email_jobs.yml → worker_email → parallel cache + live collection
  │                                      → enrichment/save → filter → SMTP digest
  └─ schedule_jobs.yml → worker_schedule → matching subscriptions → worker_email
```

| Responsibility | Current implementation |
|---|---|
| SPA composition/routing | `frontend/src/App.tsx` |
| Supabase client/profile access | `frontend/src/lib/supabase.ts`, `userService.ts` |
| Sources and heuristic filters | `utils/scraping.py` |
| Gemini extraction, retries, fallback | `utils/ai_reviewer.py` |
| Job identity, database lookup/upsert | `utils/deduper.py` |
| HTML rendering and SMTP | `utils/emailer.py` |
| Background ingestion | `workers/worker_scrape.py` |
| On-demand digest | `workers/worker_email.py` |
| Subscription dispatcher | `workers/worker_schedule.py` |
| Dispatch and subscription handlers | `supabase/functions/*/index.ts` |
| Hosting | `wrangler.toml`, `.github/workflows/deploy_frontend.yml` |

Retain the React + Supabase + Python + scheduled-worker shape initially. M3 is a UI contract, not a requirement to replace the backend, add microservices, or adopt a UI package immediately.

### 4.2 Collection and enrichment

- JobSpy currently targets LinkedIn and Indeed, not Google Jobs; some comments and marketing copy still mention Google Jobs.
- Direct collectors target Greenhouse, Lever, Ashby, and SmartRecruiters.
- There are 1,183 configured ATS slugs across the four lists at the baseline commit; this is **not** evidence of 1,183 working integrations.
- The six default ingestion keywords each trigger another complete ATS sweep. The resulting configured fan-out is 7,098 ATS requests per run, before detail requests or retries.
- JobSpy requests at most 15 results per site and uses a six-hour window and India location.
- ATS records do not include JD content. Greenhouse requests `content=false`.
- Gemini enriches unseen jobs with company stars, location, experience, and salary; missing credentials/errors trigger fallback fields. The prompt receives company/title and a description capped at 3,000 characters, but not existing source location/salary.
- Title/location/description regexes and company exclusions are heuristics, not verified eligibility or risk decisions.

### 4.3 Schedules and run feedback

- Ingestion cron: every 30 minutes.
- Subscription dispatcher cron: UTC 00:00, 06:00, 12:00, 18:00.
- Each subscription is selected only when its chosen hour equals the execution hour, giving **one daily slot**, despite terminal copy promising six-hour recurrence.
- Email pipeline runs live collection and cache lookup in parallel, even when cache results exist.
- Digest merge puts newly enriched jobs first, then cached jobs; each pool is ordered by company stars. Filtering happens before the final 20-job limit, but cache retrieval has an earlier 60-row limit before fresher filtering.
- Terminal dispatch is real, but streaming progress/status is simulated using timers. Dispatch acceptance is not evidence that a worker succeeded or an email arrived.

## 5. Current data and access model

This is the **application's expected schema**, not a verified inventory of the deployed database.

| Record | Fields used by the application | Access/limitations |
|---|---|---|
| `Seen_job` | `job_id`, `company`, `title`, `url`, `location`, `experience`, `salary`, `source`, `rating`, `scraped_at` | Public select policy; backend writes use service key when supplied. Base table creation is not captured in the checked-in migrations. |
| `users` | `id`, `name`, `email`, `avatar_url`, optional workflow preferences/run count | Frontend fetch/update; schema and RLS definition are not captured in the checked-in migrations. |
| `email_subscriptions` | UUID/user FK, recipient, title, fresher flag, stars, UTC slot, active flag, timestamps | One row per user; own-row RLS; authenticated handler writes through admin client. Migration is checked in. |

- ATS identity hashes lowercased company/title plus URL into 32 SHA-256 hex characters. JobSpy-provided IDs are retained when the key exists. Canonical cross-source identity is not guaranteed.
- Persistence includes neither descriptions nor source-posted, first-seen, last-seen, verified, or closed timestamps.
- Already-seen jobs are removed before persistence/enrichment, so rediscovery does not refresh catalog lifecycle fields.
- Board reads the newest 1,000 rows scraped within 24 hours, then filters locally. It subscribes to realtime events and also polls every minute; deployed realtime publication is not verified here.
- Board fresher filtering differs from backend filtering. Substring checks can accept `10-12 Yrs` and reject `0-2 Yrs`/unclassified interns.
- Public job data must not be used for future candidate facts, resumes, applications, email snippets, or OAuth tokens.
- Workflow dispatch has JWT verification disabled and no handler-level identity verification. This is a known security gap, not an intentional public capability to preserve.

## 6. Baseline capabilities and missing capabilities

**Implemented:** discovery, cache/dedup, optional model-backed enrichment, board browsing, original apply links, identity/auth, subscription storage, on-demand/scheduled digests.

**Not implemented:** evidence-based candidate profile, normalized eligibility, country-scoped remote eligibility, open/closed verification lifecycle, per-user fit ranking, saved/dismissed jobs, application tracking, deadline reminders, durable run/delivery history, or production quality metrics.

The V2 objective is a **verified fresher shortlist**. An employer's reputation, the time Xphire first saw a listing, and a title containing “junior” do not independently prove candidate eligibility.

## 7. V2 visual direction: Material Design 3

### 7.1 Decision and consistency rules

The user selected M3 for V2 on 2026-10-22. This aligns with `.antigravity/rules/material-web.md`. The sketch UI above remains the historical baseline; do not reuse its heavy shadows, dotted texture, mustard console, pixel fonts, or neon/glass panels as V2 defaults.

- **Light theme first.** Dark theme is not part of the initial migration; add it only with a complete token set and contrast verification.
- **Shared shell and primitives first.** Migrate route-level surfaces deliberately; do not mix old token families into new M3 components.
- **Semantic roles, not palette literals.** Literal color definitions belong in the centralized theme stylesheet only. Surface/text/component CSS must reference tokens.
- **No automatic vendor dependency.** React semantic HTML + CSS can satisfy this contract. Any M3 library adoption needs a separate compatibility/accessibility decision.
- **Web-first M3 Expressive layouts** use Flexbox/Grid, consistent spacing, visible labels, and responsive sizing. Expressiveness must not obscure job facts or status.

### 7.2 Initial light color roles

These starting values establish one consistent M3-style purple/neutral palette. They are a design choice, not a claim of automatic dynamic-color generation. Validate actual text/state combinations during implementation.

| CSS custom property | Initial value | Purpose |
|---|---|---|
| `--md-sys-color-primary` | `#6750A4` | Primary action/selection |
| `--md-sys-color-on-primary` | `#FFFFFF` | Content on primary |
| `--md-sys-color-primary-container` | `#EADDFF` | Selected containers |
| `--md-sys-color-on-primary-container` | `#21005D` | Content on primary container |
| `--md-sys-color-secondary` | `#625B71` | Supporting emphasis |
| `--md-sys-color-on-secondary` | `#FFFFFF` | Content on secondary |
| `--md-sys-color-secondary-container` | `#E8DEF8` | Supporting containers |
| `--md-sys-color-on-secondary-container` | `#1D192B` | Content on secondary container |
| `--md-sys-color-tertiary` | `#7D5260` | Limited tertiary emphasis |
| `--md-sys-color-on-tertiary` | `#FFFFFF` | Content on tertiary |
| `--md-sys-color-tertiary-container` | `#FFD8E4` | Tertiary containers |
| `--md-sys-color-on-tertiary-container` | `#31111D` | Content on tertiary container |
| `--md-sys-color-surface` | `#FEF7FF` | Page/dialog surface |
| `--md-sys-color-on-surface` | `#1D1B20` | Main text |
| `--md-sys-color-on-surface-variant` | `#49454F` | Supporting text/icons |
| `--md-sys-color-surface-container-lowest` | `#FFFFFF` | Lowest-emphasis container |
| `--md-sys-color-surface-container-low` | `#F7F2FA` | Low-emphasis container |
| `--md-sys-color-surface-container` | `#F3EDF7` | Standard container |
| `--md-sys-color-surface-container-high` | `#ECE6F0` | Higher-emphasis container |
| `--md-sys-color-surface-container-highest` | `#E6E0E9` | Highest container tone |
| `--md-sys-color-outline` | `#79747E` | Control boundaries |
| `--md-sys-color-outline-variant` | `#CAC4D0` | Decorative separators/card borders |
| `--md-sys-color-error` | `#B3261E` | Errors/destructive emphasis |
| `--md-sys-color-on-error` | `#FFFFFF` | Content on error |
| `--md-sys-color-error-container` | `#F9DEDC` | Error surface |
| `--md-sys-color-on-error-container` | `#410E0B` | Content on error surface |

Success/warning/unknown job states require app-semantic tokens with documented light-theme values and contrast tests in the token ticket; do not invent nonstandard `md-sys` role names or communicate eligibility through color alone. Disabled/hover/focus/pressed styles must be defined centrally, not improvised per page.

### 7.3 Type scale

Use **Roboto, then system sans-serif**, with local fallback that remains usable if a webfont fails. Reserve monospace for optional diagnostic logs/identifiers, never primary job content. Define named role classes/custom properties, rather than pixel-font heading exceptions.

| Role | Size / line-height | Weight |
|---|---|---|
| display-large / medium / small | 57/64, 45/52, 36/44px | 400 |
| headline-large / medium / small | 32/40, 28/36, 24/32px | 400 |
| title-large / medium / small | 22/28, 16/24, 14/20px | 400 / 500 / 500 |
| body-large / medium / small | 16/24, 14/20, 12/16px | 400 |
| label-large / medium / small | 14/20, 12/16, 11/16px | 500 |

Page heading: headline-large on wide screens, headline-medium on compact screens. Card job title: title-large; descriptions: body-medium; metadata: body-small; actions: label-large. Avoid all-caps paragraphs and tiny eligibility explanations.

### 7.4 Shape, spacing, elevation, motion

- Spacing tokens: 4, 8, 12, **16**, 24, 32, 48px. Default container padding and control-group gap: 16px.
- Buttons/inputs: 8px or 20px pill shape, consistent within each variant. Cards: 12px or 16px. Dialogs: 28px. Status/filter chips: pill shape.
- Outlined cards are the default content container. Elevated surfaces are reserved for sticky/floating controls, menus, and dialogs; no sketch-style offset shadows.
- Use one modest elevation scale and one set of hover/focus/pressed state layers in shared styles.
- Motion should explain state changes, not simulate activity. Short transitions, no perpetual status glow; honor `prefers-reduced-motion`.

## 8. V2 layouts and components

### 8.1 Shared shell and responsive behavior

- Public board remains `#/`; preserve `#/terminal` compatibility until a deliberate route migration is implemented.
- Start with a consistent top app bar: product identity, primary navigation, account action. Mobile navigation collapses rather than clips.
- Use a fluid container, max-width around 1200px, 16px compact/24px wide gutters, never `75vw` with a forced minimum wider than the viewport.
- Compact (<600px): single column, full-width primary controls, filter disclosure, no horizontal overflow.
- Medium (600–1023px): one/two-column board according to readable minimum card width.
- Expanded (≥1024px): two/three-column board or filters plus content; do not shrink evidence text to fit more cards.
- Verify 320px, 390px, 768px, and 1440px widths and 200% zoom. Long titles, employer names, locations, and evidence must wrap safely.

### 8.2 Shared primitives

| Primitive | Contract |
|---|---|
| Primary action | M3 filled button; one clearly dominant action per action group |
| Secondary/tertiary action | Outlined/text button; semantic link for navigation |
| Text field/select | Outlined field, persistent explicit label, helper/error text; placeholder is not a label |
| Checkbox/switch | Visible label and programmatic state; checkbox for filtering, switch for immediate on/off settings |
| Job/content card | Outlined surface, consistent padding, factual hierarchy, visible actions |
| Status chip | Text + optional icon + semantic color; never color-only |
| Menu/dialog | Keyboard access, predictable focus handling, no clipped overflow |
| Loading/error/empty region | Separate states, useful next action, accessible announcement |

Semantic HTML and React controls are allowed equivalents to `<md-filled-button>` and other M3 web elements. Do not route users into the unused mock `WorkflowFilters` implementation as a shortcut.

### 8.3 Target job-card hierarchy (after data tickets)

1. Employer and role title.
2. Location, employment type, and compensation (or “Not disclosed”).
3. Eligibility: confirmed/possible/not eligible/unknown, with evidence.
4. Candidate match: supported required skills, missing required skills, and unknown restrictions.
5. Source, source-posted date if known, and last verification time; keep timestamps distinct.
6. View details, original apply link, save/dismiss, and application state as those tickets ship.

Company stars are neither eligibility nor candidate fit. Do not display future fit/verification fields before the underlying implementation supports them. Opening an apply link is not a submission.

### 8.4 Search, account, profile, applications, alerts

- Provide accessible forms for sign-in, search, and alert settings; retain terminal commands only as optional advanced access, not the only way to configure discovery.
- Separate public browsing from authenticated personal actions.
- Profile fields distinguish user-provided evidence, preferences, and unknown facts. Ask about graduation restrictions only when relevant; never invent candidate claims.
- Application tracking begins with explicit manual confirmation or a real submission receipt. Save/open/generated resume are not “submitted.”
- Alerts clearly state cadence, next-send time/timezone, delivery state, and cancellation. Deadline reminders require a known source deadline.

### 8.5 Email adaptation

Use the same M3 palette, hierarchy, labels, and honest eligibility/date language, adapted to email-client limitations. Keep table-based layouts and inline styles where needed; render token values from a defined palette rather than expecting email clients to support CSS variables, web components, or webfonts. Supply a readable text alternative and safe escaped content/validated links. Email redesign is a dedicated ticket, not part of this document-only change.

## 9. V2 technical and data principles

- Keep discovery, normalized job identity/lifecycle, evidence extraction, eligibility, candidate matching, and delivery as focused modules with small interfaces.
- Board and digest consume the same persisted eligibility and matching semantics; do not duplicate decision regexes in React.
- Prefer deterministic rules for mandatory eligibility. AI may propose evidence-linked extraction, but cannot turn unknown evidence into a confirmed fact or overwrite authoritative source data silently.
- Normalize employer/requisition/canonical apply identity; preserve source observations and provenance.
- Collect each ATS board once per ingestion cycle, then classify locally; isolate connector failures, respect permitted access, and record source health.
- Separate first discovery, last observation, verification, source posting, and closure. A failed request alone is not proof a job is closed.
- Push filters before pagination and use stable ordering. User preferences do not narrow the shared catalog for everyone else.
- Private user-owned profile, matching, saved-job, application, and delivery records require explicit RLS and cross-user tests. No browser service-role secrets.
- Worker inputs must be explicit user/job context, not process-global environment mutations when concurrent per-user work is introduced.
- Authenticate/rate-limit external dispatch. Use durable idempotency for requests/delivery; distinguish request accepted, worker succeeded, no matches, email sent, and failure.
- Human approval is required for externally visible applications or future repository actions. Unattended bulk applications, CAPTCHA bypass, and fabricated resume claims are outside this V2 scope.

## 10. Migration sequence and design review

1. Record/approve this contract and publish V2 tickets.
2. Add reproducible tests and secure dispatch; these do not require a visual redesign.
3. Implement M3 tokens/primitives, then shared shell/board, then account/search/alerts forms.
4. Normalize jobs, extract evidence, fix eligibility/location/lifecycle, and expose consistent filters.
5. Add private profiles, explainable matches, details, shortlist feedback, and tracking.
6. Replace simulated status, correct cadence/delivery, align email, and evaluate quality.

Product and backend tickets may run independently of M3 migration when blockers allow it. A ticket may not introduce a third visual system or undocumented one-off token set.

For each UI ticket, review:

- [ ] Uses shared M3 color/type/shape/spacing roles, not legacy sketch/neon values.
- [ ] Keyboard/focus behavior and explicit labels are verified.
- [ ] Text contrast meets WCAG AA; non-text controls/focus states are distinguishable.
- [ ] Compact layouts, long content, 200% zoom, and reduced motion are checked.
- [ ] Loading, error, empty, unknown, and success states are honest and distinct.
- [ ] Screenshots/tests use mocked data; they never create real accounts, send mail, or dispatch paid work.
- [ ] Existing public browsing/apply navigation survives migration.
- [ ] This document is updated for intentionally changed decisions, not silently contradicted.

## 11. Verification and evidence

Quality-foundation commands now delegate without reinstalling packages. Use the supported Python 3.11/Node 24 setup in [docs/quality.md](docs/quality.md):

```bash
npm run typecheck
npm run build
npm run lint
npm test
python -m pytest -q
python scripts/check_docs.py
```

The explicit pinned development setup was added in ticket 01; the historical observation below remains a baseline, not the current check result. Do not run scraping/email workers with real credentials as tests.

The review baseline had a passing production build, two passing Python tests, five frontend lint warnings, and two high-severity dependency-audit entries. These are observations, not ongoing guarantees. The current tests do not cover eligibility, lifecycle, RLS, or reliable dispatch/delivery.

V2 quality measures: eligible-result precision and missed eligible roles on a manually labeled JD set; country/remote false positives; dead apply links; duplicate jobs/digests; connector success/yield; stale listings; run/delivery failures. Record thresholds and measured outcomes in the evaluation ticket; do not invent production results.

## 12. Ticket and branch convention

Use [notes/README.md](notes/README.md) for the approved dependency graph, execution frontier, and recommendation-to-ticket coverage.

- Dedicated note: `notes/<NN>-<ticket-name>.md`.
- Dedicated branch: `V2/<NN>-<ticket-name>`; design baseline: `V2/00-design-baseline`.
- Create a ticket branch when work starts, from updated `main` after its blockers merge. Do not create all future branches at today's SHA; they would become stale and omit merged dependencies.
- Implement/validate only the active ticket. Never commit or push directly to `main`.
- A ticket records scope, blockers, acceptance checks, design impact, verification, and excluded work.
- Use local notes and a linked roadmap as the source of execution order. Do not mark tickets completed merely because their notes exist.
- Live note mirroring can be enabled by the user with `/md-log notes/<NN>-<ticket-name>.md`; a documentation command written here does not activate an extension.

### Source index

- Product claims: `README.md` (claims may lag implementation).
- Active styling: `frontend/src/index.css`, `App.css`, `components/{JobBoard,SketchHeader,SketchTerminal}.css`, `frontend/index.html`.
- Current routes/auth: `frontend/src/App.tsx`, `components/SketchTerminal.tsx`, `lib/userService.ts`.
- Current collection/delivery: `utils/*.py`, `workers/*.py`, `.github/workflows/*.yml`.
- Expected data/access: `supabase/migrations/*.sql`, `supabase/config.toml`, `supabase/functions/*/index.ts`.
- Repository rules: `.antigravity/rules/material-web.md`, `.antigravity/rules/github-workflow.md`; local `.codex` rules also require isolated branches and verification.
