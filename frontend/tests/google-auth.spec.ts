import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

async function submit(page: Page, value: string, prompt: string) {
  await expect(page.locator('.terminal-prompt__label')).toContainText(prompt);
  await page.locator('.terminal-prompt__input').fill(value);
  await page.locator('.terminal-prompt__input').press('Enter');
  await page.clock.runFor(10);
}

for (const choice of ['3', 'google']) {
  test(`Google OAuth via ${choice} uses PKCE and returns to the authenticated terminal`, async ({ page, backend }) => {
    backend.authSession.user.user_metadata = {
      full_name: 'Google Candidate',
      picture: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
    };
    backend.userProfile = null;
    const authorizationUrls: URL[] = [];
    await page.route('https://placeholder.supabase.co/auth/v1/authorize?**', async (route) => {
      const url = new URL(route.request().url());
      authorizationUrls.push(url);
      const callback = new URL(url.searchParams.get('redirect_to')!);
      callback.searchParams.set('code', 'offline-google-code');
      await route.fulfill({ status: 302, headers: { location: callback.href } });
    });
    await page.goto('/?unrelated=value#/terminal');
    await expect(page.getByText('[3] Continue with Google', { exact: false })).toBeVisible();
    await submit(page, choice, 'Select option');
    await expect(page.getByText('✓ Authentication complete. Welcome, Google Candidate!')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Google Candidate' })).toHaveAttribute('src', backend.authSession.user.user_metadata.picture);
    await expect(page).toHaveURL('http://127.0.0.1:4173/#/terminal');
    expect(authorizationUrls).toHaveLength(1);
    const authorization = authorizationUrls[0]!;
    expect(authorization.searchParams.get('provider')).toBe('google');
    expect(authorization.searchParams.get('redirect_to')).toBe('http://127.0.0.1:4173/#/terminal');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exchanges = backend.requests.filter((request) => request.path === '/auth/v1/token');
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.query).toBe('?grant_type=pkce');
    expect(exchanges[0]?.body).toMatchObject({ auth_code: 'offline-google-code', code_verifier: expect.any(String) });
    expect(backend.requests.some((request) => request.path === '/auth/v1/signup')).toBe(false);
    await submit(page, 'run', 'google_candidate@xphire');
    await expect(page.locator('.terminal-prompt__label')).toContainText('Job title to search');
    await page.reload();
    await expect(page.getByText('✓ Authentication complete. Welcome, Google Candidate!')).toBeVisible();
    expect(backend.requests.filter((request) => request.path === '/auth/v1/token')).toHaveLength(1);
  });
}

for (const errorLocation of ['query', 'fragment']) {
  test(`Google cancellation in ${errorLocation} returns to the menu and cleans the URL`, async ({ page, backend }) => {
    const error = 'error=access_denied&error_description=Google+sign-in+was+cancelled';
    await page.goto(errorLocation === 'query' ? `/?${error}#/terminal` : `/#${error}`);
    await expect(page.getByText(/Sign-in failed: Google sign-in was cancelled/)).toBeVisible();
    await expect(page.locator('.terminal-prompt__input')).toBeEnabled();
    await expect(page.getByText('[3] Continue with Google', { exact: false })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:4173/#/terminal');
    expect(backend.requests.some((request) => request.path.startsWith('/auth/'))).toBe(false);
    await submit(page, '2', 'Select option');
    await expect(page.locator('.terminal-prompt__label')).toContainText('Enter your email address');
  });
}

test('expired PKCE callback can retry without re-exchanging on reload', async ({ page, backend }) => {
  backend.authTokenStatus = 400;
  await page.addInitScript(() => {
    localStorage.setItem('sb-placeholder-auth-token-code-verifier', JSON.stringify('offline-verifier'));
  });
  await page.goto('/?code=expired-code#/terminal');
  await expect(page.getByText(/Sign-in failed: OAuth code has expired/)).toBeVisible();
  await expect(page.locator('.terminal-prompt__input')).toBeEnabled();
  await expect(page).toHaveURL('http://127.0.0.1:4173/#/terminal');
  expect(backend.requests.filter((request) => request.path === '/auth/v1/token')).toHaveLength(1);
  await page.reload();
  await expect(page.getByText('System ready. Authentication required to continue.')).toBeVisible();
  expect(backend.requests.filter((request) => request.path === '/auth/v1/token')).toHaveLength(1);
});

test('callback without a local PKCE verifier explains how to retry', async ({ page, backend }) => {
  await page.goto('/?code=other-browser-code#/terminal');
  await expect(page.getByText(/opened in a different browser/)).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:4173/#/terminal');
  expect(backend.requests.some((request) => request.path === '/auth/v1/token')).toBe(false);
});

test('Google startup errors restore the menu instead of leaving the input disabled', async ({ page, backend }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes('code-verifier')) throw new Error('Browser storage is unavailable');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/#/terminal');
  await submit(page, 'google', 'Select option');
  await expect(page.getByText('Google sign-in failed: Browser storage is unavailable')).toBeVisible();
  await expect(page.locator('.terminal-prompt__input')).toBeEnabled();
  await submit(page, '2', 'Select option');
  await expect(page.locator('.terminal-prompt__label')).toContainText('Enter your email address');
  expect(backend.requests.some((request) => request.path.startsWith('/auth/'))).toBe(false);
});

test('email/password signup remains available and menu navigation retains Google', async ({ page, backend }) => {
  await page.goto('/#/terminal');
  await submit(page, 'invalid', 'Select option');
  await expect(page.getByText(/Invalid choice.*continue with Google/)).toBeVisible();
  await submit(page, '1', 'Select option');
  await submit(page, 'menu', 'Enter your full name');
  await expect(page.getByText('[3] Continue with Google', { exact: false }).last()).toBeVisible();
  await submit(page, '1', 'Select option');
  await submit(page, 'Email Candidate', 'Enter your full name');
  await submit(page, 'email@example.test', 'Enter your email address');
  await submit(page, 'offline-password', 'Create a password');
  await submit(page, 'offline-password', 'Confirm your password');
  await expect(page.getByText('✓ Authentication complete. Welcome, Test Candidate!')).toBeVisible();
  const signup = backend.requests.find((request) => request.path === '/auth/v1/signup');
  expect(signup?.body).toMatchObject({ email: 'email@example.test', password: 'offline-password', data: { name: 'Email Candidate' } });
});

test('pending Google redirect disables the prompt and ignores duplicate submits', async ({ page, backend }) => {
  // Pause verifier persistence before navigation so the pending UI is observable.
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    let paused = false;
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (!paused && key.includes('code-verifier')) {
        paused = true;
        return new Promise<void>((resolve) => {
          document.addEventListener('release-google', () => resolve(), { once: true });
        });
      }
    };
  });
  let authorizations = 0;
  await page.route('https://placeholder.supabase.co/auth/v1/authorize?**', async (route) => {
    authorizations++;
    const callback = new URL(new URL(route.request().url()).searchParams.get('redirect_to')!);
    callback.searchParams.set('code', 'offline-google-code');
    await route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  await page.goto('/#/terminal');
  await expect(page.locator('.terminal-prompt__label')).toContainText('Select option');
  await page.locator('.terminal-prompt__input').fill('3');
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('.terminal-prompt')!;
    form.requestSubmit();
    form.requestSubmit();
  });
  try {
    await expect(page.locator('.terminal-prompt__input')).toBeDisabled();
    await expect(page.locator('.terminal-prompt__label')).toHaveText('Connecting to Google...');
  } finally {
    await page.evaluate(() => document.dispatchEvent(new Event('release-google')));
  }
  await expect(page.getByText('✓ Authentication complete. Welcome, Test Candidate!')).toBeVisible();
  expect(authorizations).toBe(1);
  expect(backend.requests.filter((request) => request.path === '/auth/v1/token')).toHaveLength(1);
});

test('older implicit confirmation links restore the session without changing subsequent Google PKCE', async ({ page, backend }) => {
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: 1792674000 })).toString('base64url')}.b2ZmbGluZQ`;
  await page.route('https://placeholder.supabase.co/auth/v1/logout**', (route) => route.fulfill({ status: 204 }));
  let authorization: URL | undefined;
  await page.route('https://placeholder.supabase.co/auth/v1/authorize?**', async (route) => {
    authorization = new URL(route.request().url());
    const callback = new URL(authorization.searchParams.get('redirect_to')!);
    callback.searchParams.set('code', 'offline-google-code');
    await route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  await page.goto(`/#access_token=${token}&refresh_token=offline-refresh-token&token_type=bearer&expires_in=3600`);
  await expect(page.getByText('✓ Authentication complete. Welcome, Test Candidate!')).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:4173/#/terminal');
  await submit(page, 'logout', 'test_candidate@xphire');
  await expect(page.locator('.terminal-prompt__label')).toContainText('Select option');
  await submit(page, '3', 'Select option');
  await expect(page.getByText('✓ Authentication complete. Welcome, Test Candidate!')).toBeVisible();
  expect(authorization?.searchParams.get('code_challenge_method')).toBe('s256');
  expect(backend.requests.some((request) => request.path === '/auth/v1/user')).toBe(true);
});

test('email/password sign-in remains available', async ({ page, backend }) => {
  await page.goto('/#/terminal');
  await submit(page, '2', 'Select option');
  await submit(page, 'candidate@example.test', 'Enter your email address');
  await submit(page, 'offline-password', 'Enter your password');
  await expect(page.getByText('✓ Authentication complete. Welcome, Test Candidate!')).toBeVisible();
  const token = backend.requests.find((request) => request.path === '/auth/v1/token');
  expect(token?.query).toBe('?grant_type=password');
  expect(token?.body).toMatchObject({ email: 'candidate@example.test', password: 'offline-password' });
});
