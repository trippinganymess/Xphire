import type { Page } from '@playwright/test';
import { test, expect, session, type MockBackend } from './fixtures.js';

async function signIn(page: Page) {
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(stored));
  }, session);
}

const requestPosts = (requests: MockBackend['requests']) => requests.filter((request) => request.path === '/functions/v1/request-private-access');

async function awaitGate(page: Page) {
  await page.getByRole('dialog').waitFor();
}

/** The access email is gated behind the Confirm/Cancel dialog; the gate
 *  plays its burst (2000ms) and only then settles the choice. */
async function confirmEmail(page: Page) {
  await awaitGate(page);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.clock.runFor(2_100);
}

test('PJobB offers an access request page and guests sign in before sending', async ({ page, backend }) => {
  await page.goto('/#/private-jobs');
  await page.getByRole('link', { name: 'Request access', exact: true }).click();
  await expect(page).toHaveURL(/#\/private-jobs\/request-access$/);
  await expect(page.getByRole('heading', { name: 'Request PJobB access' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to request access' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in through Terminal Access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'REQUEST ACCESS', exact: true })).toHaveCount(0);
  expect(requestPosts(backend.requests)).toHaveLength(0);
});

test('unpaid users submit their name and message using their account email', async ({ page, backend }, testInfo) => {
  await signIn(page);
  await page.goto('/#/private-jobs');
  await page.getByRole('link', { name: 'Request access', exact: true }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('Test Candidate');
  await expect(page.getByLabel('Account email')).toHaveValue('candidate@example.test');
  await expect(page.getByLabel('Account email')).toHaveAttribute('readonly', '');
  await page.getByLabel('Your name').fill('Candidate Name');
  await page.getByLabel('Message (optional)').fill('I am looking for frontend roles.\nThank you.');
  await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requestPosts(backend.requests)).toHaveLength(0);
  await confirmEmail(page);
  await expect(page.getByRole('status')).toContainText('queued for email delivery to recblackoff@gmail.com');
  await expect(page.getByRole('button', { name: 'REQUEST SUBMITTED' })).toBeDisabled();
  const posts = requestPosts(backend.requests);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.body).toEqual({ name: 'Candidate Name', message: 'I am looking for frontend roles.\nThank you.' });
  expect(posts[0]?.authorization).toBe('Bearer offline-access-token');
  expect(backend.requests.some((request) => request.path === '/rest/v1/private_jobs'
    || request.path === '/functions/v1/private-job-board')).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('pjobb-access-request.png'), fullPage: true });
});

test('canceling the confirmation leaves the form untouched and sends nothing', async ({ page, backend }) => {
  await signIn(page);
  await page.goto('/#/private-jobs/request-access');
  await page.getByLabel('Message (optional)').fill('Do not send this.');
  await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
  await awaitGate(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.clock.runFor(2_100);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Your name')).toBeEnabled();
  expect(requestPosts(backend.requests)).toHaveLength(0);
  await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a pending request disables duplicate submits until the queue responds', async ({ page, backend }) => {
  await signIn(page);
  let release!: () => void;
  backend.accessRequestGate = new Promise<void>((resolve) => { release = resolve; });
  await page.goto('/#/private-jobs/request-access');
  try {
    await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
    await confirmEmail(page);
    await expect(page.getByRole('button', { name: 'SENDING REQUEST...' })).toBeDisabled();
    await expect(page.getByLabel('Your name')).toBeDisabled();
    await page.keyboard.press('Enter');
    expect(requestPosts(backend.requests)).toHaveLength(1);
  } finally { release(); backend.accessRequestGate = null; }
  await expect(page.getByRole('button', { name: 'REQUEST SUBMITTED' })).toBeDisabled();
});

for (const failure of [
  { status: 429, code: 'already_requested', text: 'You already requested access in the last 24 hours.' },
  { status: 403, code: 'verified_email_required', text: 'Confirm your account email before requesting access.' },
  { status: 503, code: 'notification_unavailable', text: 'Your request was saved, but email delivery could not be confirmed.' },
]) {
  test('request failure ' + failure.code + ' is clear and preserves the form', async ({ page, backend }) => {
    await signIn(page);
    backend.accessRequestHttpStatus = failure.status;
    backend.accessRequestCode = failure.code;
    await page.goto('/#/private-jobs/request-access');
    await page.getByLabel('Message (optional)').fill('Please review my access.');
    await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
    await confirmEmail(page);
    await expect(page.getByRole('alert')).toContainText(failure.text);
    await expect(page.getByLabel('Message (optional)')).toHaveValue('Please review my access.');
    await expect(page.getByRole('button', { name: 'REQUEST ACCESS', exact: true })).toBeEnabled();
    expect(requestPosts(backend.requests)).toHaveLength(1);
  });
}

test('already entitled users get a link to their private board', async ({ page, backend }) => {
  await signIn(page);
  backend.accessRequestHttpStatus = 200;
  backend.accessRequestStatus = 'already_allowed';
  await page.goto('/#/private-jobs/request-access');
  await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
  await confirmEmail(page);
  await expect(page.getByRole('status')).toContainText('You already have active PJobB access.');
  await expect(page.getByRole('link', { name: 'Open your Private Job Board' })).toHaveAttribute('href', '#/private-jobs');
});

test('sign-out clears a pending form and ignores its late response', async ({ page, backend }) => {
  await signIn(page);
  let release!: () => void;
  backend.accessRequestGate = new Promise<void>((resolve) => { release = resolve; });
  await page.goto('/#/private-jobs/request-access');
  try {
    await page.getByRole('button', { name: 'REQUEST ACCESS', exact: true }).click();
    await confirmEmail(page);
    await expect(page.getByRole('button', { name: 'SENDING REQUEST...' })).toBeDisabled();
    await page.evaluate(async () => {
      const path = '/src/lib/supabase.ts';
      const { supabase } = await import(path);
      await supabase.auth.signOut();
    });
    await expect(page.getByRole('heading', { name: 'Sign in to request access' })).toBeVisible();
  } finally { release(); backend.accessRequestGate = null; }
  await expect(page.getByText(/queued for email delivery/)).toHaveCount(0);
  await expect(page.getByLabel('Your name')).toHaveCount(0);
});

for (const width of [320, 390, 1440]) {
  test('access form fits at ' + width + 'px with keyboard focus', async ({ page, backend }) => {
    await signIn(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/private-jobs/request-access');
    const name = page.getByLabel('Your name');
    await expect(name).toBeVisible();
    await name.focus();
    await name.press('Tab');
    await expect(page.getByLabel('Account email')).toBeFocused();
    const overflows = await page.locator('.private-access-request').evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflows).toBe(false);
    expect(requestPosts(backend.requests)).toHaveLength(0);
  });
}
