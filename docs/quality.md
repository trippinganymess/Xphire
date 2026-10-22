# Quality and offline development

Supported quality environment: **Python 3.11** and **Node.js 24 LTS** (npm bundled with Node). CI uses the same major versions. The runtime workers still consume `requirements.txt`; the fully pinned, SHA-256-verified `requirements-dev.txt` includes those runtime requirements plus test/lint/audit tooling. Do not reuse a credentialed production worker environment for testing.

## Clean checkout

No `.env`, accounts or API keys are needed for these checks. Installation, Chromium download, and dependency audits contact package/advisory registries; the test suites do not contact live product services.

```bash
python3.11 -m venv .venv-quality
source .venv-quality/bin/activate
python -m pip install --require-hashes -r requirements-dev.txt
python -m pip check

node --version # v24.x
npm --prefix frontend ci --ignore-scripts
(cd frontend && npx playwright install chromium)
# On Linux, use: npx playwright install --with-deps chromium

python -m ruff check .
python -m pytest -q
python scripts/check_docs.py
npm run typecheck
npm run lint
npm run build
npm test

python -m pip_audit --disable-pip -r requirements-dev.txt
npm --prefix frontend audit
```

Root npm commands delegate without installing packages or rewriting the lockfile. Frontend `typecheck` covers application, Vite/Playwright config, and test TypeScript. `node frontend/verify_ui.cjs` is a safe compatibility wrapper for `npm test`, not a live screenshot flow. Browser failure screenshots/traces are saved under ignored `frontend/test-results/` and `frontend/playwright-report/`. The checked-in older `test_screenshots/` remain historical artifacts.

If testing on a machine with local frontend `.env` files, Playwright starts its **own** strict-port server with explicit fake Supabase values that override Vite environment files. It will not reuse an existing server. A plain production build can read local `.env`; the clean-checkout and PR build need none and never execute browser requests.

Optional equivalent hash-checking installer: `uv pip install --python .venv-quality/bin/python --require-hashes -r requirements-dev.txt`. Lock refresh is deliberate, not part of build/test:

```bash
# Resolver used for this lock: uv 0.11.21
uv pip compile requirements-dev.in --python-version 3.11 --universal --generate-hashes -o requirements-dev.txt
```

Review lock diffs and both audits whenever changing dependencies. Audit availability depends on external registries; CI does not silently skip audit failures. `npm ci --ignore-scripts` avoids unnecessary lifecycle scripts; the existing tools use packaged platform bindings and browser installation is explicit.

## Effect boundaries and extension points

- `tests/conftest.py` scrubs ambient credentials **before collection** and per test. Unexpected HTTP, socket/DNS, JobSpy, model, SMTP and blocking sleep effects raise `pytest.fail`, outside production `except Exception` fallbacks.
- `http_effects` supplies HTTPX `MockTransport` with exact method/host/path routes; assert query parameters, payload and headers at that boundary. `supabase` uses synthetic read/service credentials.
- `ats_board` in `tests/test_collectors.py` scripts the four current ATS response formats. `jobspy_effects` scripts installed JobSpy's dataframe interface. Neither replaces imported modules.
- `model_effects`, `clock`, and `smtp_effects` script SDK responses/errors, UTC/monotonic time/retry sleeps, and TLS/login/message delivery. Add failures to fixture queues to reproduce regressions without paid calls or mail.
- Frontend `tests/fixtures.ts` uses the real Supabase SDK with mocked HTTP/auth/profile/catalog/function responses and intercepted realtime sockets. Non-local, non-mocked traffic is blocked and fails the test. Google font traffic is explicitly blocked as decoration. Add endpoints deliberately; never allow a general live fallback.

Known product defects assert **desired** V2 behavior as strict expected failures: pytest uses `xfail_strict=true` and `raises=AssertionError`; browser tests declare `test.fail()` only immediately before the known assertion. Setup/safety failures remain real failures. Unexpected passes fail the suite and require removal of the annotation when the owning ticket fixes the defect. They are not eligibility/lifecycle acceptance evidence.

## Reviewed warnings and advisory disposition

| Baseline | Disposition |
|---|---|
| App auth callback initialization lint warning | Moved the typed helper into the owning effect; no rule-wide suppression. |
| Three unused catch bindings | Removed bindings; unreadable function error bodies retain the SDK message. |
| Terminal state reset in effect | One-line suppression with ticket 05 ownership; current session-driven terminal reset retained, not redesigned. New frontend warnings fail via `--deny-warnings`. |
| Python pre-existing unused imports / annotation / redundant f-strings | Removed unused worker imports and redundant f-prefixes; added a type-only Deduper import. E9/F checks cover utilities, workers, tests, and scripts with no file-wide ignores. Full style/type enforcement is not claimed. |
| React duplicate terminal log keys in mocked run flow | Reproduced console diagnostic: multiple log entries use `Date.now()` in the same submit. Retained and documented for ticket 05's terminal/form state replacement; not a simulated successful-delivery check. Other browser runtime errors fail tests. |
| Large avatar assets (roughly 1–1.5 MB each) | Existing build output retained; asset optimization is not this ticket's UI redesign. No chunk-size warning in verified build. |
| `source-map-js` GHSA-68fv-2mgg-jv7q | Patched lock from 1.2.1 to 1.2.2. Build-time source-map parser DoS, not a browser runtime dependency; still remediated. |
| Vite GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22, GHSA-vfpm-58rq-9qcg | Patched 8.2.2 to 8.2.4. Editor/dev-server issues (some Windows-specific); production deploy is static assets, but developer exposure remains relevant. No public host in test config. |
| Python locked development/runtime environment | `pip-audit`: no known vulnerabilities at verification. Installer packages are included in the lock/audit. |

Npm lock changes retain unrelated package versions: only Vite, source-map-js, new aligned `@playwright/test` and root metadata change. Both audits include development tools; no blanket advisory ignores.

## PR CI

`.github/workflows/pr_quality.yml` runs independent Python, frontend, and documentation jobs on PRs targeting `main`, with read-only repository permissions, no secrets, and no scraper/email/dispatch workflow invocation. Failures propagate normally; browser failure evidence is uploaded for seven days. Deployment uses Node 24 to match tested tool support, but this workflow does not deploy or merge anything. Branch-protection required checks must be configured separately by a repository administrator.

The document checker validates checked documentation's local file links and ticket ID/status/branch/blocker metadata without requesting external links. It does not claim full Markdown style, anchor, accessibility, deployed RLS, production eligibility precision, or actual mail-delivery coverage.
