# Xphire frontend

React/TypeScript SPA built with Vite. Use **Node.js 24 LTS**.

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run typecheck
npm run lint
npm run build
npm test
```

`npm test` starts an isolated local Vite server with fake Supabase credentials and mocked HTTP/auth/catalog/workflow/realtime effects. It does not reuse a manually started server or create real accounts. `node verify_ui.cjs` delegates to these asserting tests. See [quality documentation](../docs/quality.md) for fixture extension points, expected product defects, CI, audits, and evidence locations.

For actual development, copy `.env.example` to `.env` and provide the public Supabase URL/anon key, then run `npm run dev`. Do not use service-role keys in browser configuration. Live development and offline tests are separate activities.

The application currently retains its sketch/terminal UI; V2 Material Design 3 is governed by [design.md](../design.md) and shipped through later tickets, not this quality foundation.
