# Google signup in the terminal

The terminal authentication menu offers **[3] Continue with Google**. Enter `3` or `google` to create a Supabase account on first use, or sign in to an existing Google-linked account. Email/password signup and sign-in remain available as options 1 and 2.

## Deployment configuration

Configure this in the Google Cloud and Supabase dashboards; the frontend cannot enable the provider itself.

1. In Google Cloud, configure the OAuth consent screen for the application. If the app is in testing mode, add the intended Google accounts as test users.
2. Create an OAuth client of type **Web application**. Add the **Supabase callback URL shown in the Google provider settings** as an authorized redirect URI, normally `https://<project-ref>.supabase.co/auth/v1/callback`. This is Google's redirect target, not the application's `#/terminal` route.
3. In Supabase Authentication's Google provider settings, enable Google and save that client's ID and secret. Keep the client secret in Supabase, **never** in a `VITE_*` variable, browser code, or a committed environment file.
4. In Supabase Authentication's URL configuration, set the site URL to the deployed application and add the application return URLs to the redirect allowlist:
   - Production: `https://xphire.animesh-23gcebds018.workers.dev/#/terminal`
   - Local development with Vite's default port: `http://localhost:5173/#/terminal`
   - Add the matching origin/path for any other development port or deployment base path. The frontend derives this URL from the current location and removes its query parameters.
5. The frontend uses the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. No Google-specific frontend environment variables or new dependencies are required.

References: [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Redirect and profile behavior

- OAuth uses Supabase's PKCE flow: Google returns through Supabase, then the browser receives an authorization code in the query string. The SDK exchanges that code for the session without putting access tokens in the router fragment.
- Complete signup/sign-in in the same browser where it started. The local PKCE verifier is required. A missing verifier, expired code, or cancelled consent returns to the terminal menu with an error and retry instructions.
- Callback codes and provider error parameters are removed from the address bar, including on failures, so reload does not repeat an expired exchange.
- The existing Supabase session storage key is unchanged. Sessions persist across reloads, and authenticated users can use the existing terminal commands. Older email-confirmation links with implicit tokens are restored explicitly, while subsequent Google sign-ins still use PKCE.
- The app uses Google's name/avatar metadata when an optional `users` profile is absent. An existing profile's name/avatar takes precedence. Profile schema/creation triggers are not captured in the checked-in migrations; any deployed trigger must accept Google users as well as email/password users. This change does not write browser-supplied Google metadata directly to a new database row.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm --prefix frontend test -- tests/google-auth.spec.ts
```

The browser tests use the real Supabase Auth SDK with intercepted authorize redirects, token responses, and profiles. They cover numeric/text menu selection, the PKCE exchange, authenticated return and reload, cancellation, expired codes, missing verifiers, browser storage failure, duplicate-submit prevention, legacy confirmation links, and email/password regressions. They never contact Google or create a real account. After dashboard configuration, manually verify one successful Google signup, existing-account sign-in, and cancelled consent in the deployed application; mocked tests do not verify live provider configuration.
