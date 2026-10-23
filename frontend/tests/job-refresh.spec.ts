import { test, expect, job, session } from './fixtures.js';

const refreshPosts = (backend: { requests: { path: string; method: string }[] }) =>
  backend.requests.filter((r) => r.path === '/functions/v1/refresh-jobs' && r.method === 'POST');

async function signIn(page: import('@playwright/test').Page) {
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-supabase-auth-token', JSON.stringify(stored));
  }, session);
}

test('anonymous visitors can see status but cannot start a refresh', async ({ page, backend }) => {
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'REFRESH', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Please sign in through Terminal Access');
  expect(refreshPosts(backend)).toHaveLength(0);
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('signed-in refresh dispatches once and shows the 15-minute estimate', async ({ page, backend }) => {
  await signIn(page);
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'REFRESH', exact: true });
  await expect(button).toBeEnabled();
  let release!: () => void;
  backend.refreshGate = new Promise<void>((resolve) => { release = resolve; });
  await button.click();
  await expect(page.getByRole('button', { name: 'STARTING...' })).toBeDisabled();
  release();
  backend.refreshGate = null;
  await expect(page.getByText(/Refresh started.*about 15 minutes/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  expect(refreshPosts(backend)).toHaveLength(1);
  await page.getByLabel('Freshers Only').check();
  await expect(page.getByRole('article')).toHaveCount(1);
  // The estimate must never mark a still-running workflow complete.
  await page.clock.runFor(15 * 60_000);
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  expect(refreshPosts(backend)).toHaveLength(1);
});

test('a run started by another visitor is visible on load and route return', async ({ page, backend }) => {
  backend.refreshStatus = 'running';
  await page.goto('/#/');
  await expect(page.getByText(/page is already refreshing.*about 15 minutes/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  await page.getByRole('link', { name: 'TERMINAL ACCESS' }).click();
  await page.goto('/#/');
  await expect(page.getByText(/page is already refreshing/)).toBeVisible();
  expect(refreshPosts(backend)).toHaveLength(0);
});

test('a run starting between status check and click is reported as already refreshing', async ({ page, backend }) => {
  await signIn(page);
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'REFRESH', exact: true });
  await expect(button).toBeEnabled();
  backend.refreshStatus = 'running';
  await button.click();
  await expect(page.getByText(/page is already refreshing/)).toBeVisible();
  expect(refreshPosts(backend)).toHaveLength(1);
});

test('real completion reloads the current catalog and re-enables refresh', async ({ page, backend }) => {
  backend.refreshStatus = 'running';
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  backend.jobs.push(job({ job_id: 'new', title: 'Newly Found Engineer' }));
  backend.refreshStatus = 'completed';
  await page.clock.runFor(30_000);
  await expect(page.getByText(/Refresh complete/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Newly Found Engineer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'REFRESH', exact: true })).toBeEnabled();
});

test('failed runs do not claim successful completion', async ({ page, backend }) => {
  backend.refreshStatus = 'running';
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  backend.refreshStatus = 'failed';
  await page.clock.runFor(30_000);
  await expect(page.getByRole('alert')).toContainText('did not finish successfully');
  await expect(page.getByRole('button', { name: 'REFRESH', exact: true })).toBeEnabled();
});

test('dispatch failure is recoverable without losing job results', async ({ page, backend }) => {
  await signIn(page);
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'REFRESH', exact: true });
  await expect(button).toBeEnabled();
  backend.refreshHttpStatus = 503;
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Unable to start the refresh');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(button).toBeEnabled();
  backend.refreshHttpStatus = 200;
  await button.click();
  await expect(page.getByText(/Refresh started/)).toBeVisible();
});

test('an old completed run after a dispatch lease expires is not reported as success', async ({ page, backend }) => {
  backend.refreshStatus = 'running';
  backend.refreshRunId = undefined;
  backend.refreshPreviousRunId = 40;
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  backend.refreshStatus = 'completed';
  backend.refreshRunId = 40;
  await page.clock.runFor(90_000);
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  await expect(page.getByText(/Refresh complete/)).toHaveCount(0);
  await page.clock.runFor(30_000);
  await expect(page.getByRole('alert')).toContainText('Unable to confirm whether the refresh started');
  await expect(page.getByRole('button', { name: 'REFRESH', exact: true })).toBeEnabled();
});

test('status service failure clears the checking state and recovers on polling', async ({ page, backend }) => {
  backend.refreshHttpStatus = 503;
  await page.goto('/#/');
  await expect(page.getByRole('alert')).toContainText('Unable to check refresh status');
  await expect(page.getByRole('button', { name: 'REFRESH', exact: true })).toBeEnabled();
  backend.refreshHttpStatus = 200;
  backend.refreshStatus = 'running';
  await page.clock.runFor(30_000);
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  await expect(page.getByText(/page is already refreshing/)).toBeVisible();
});

test('status failure while running retains the active state until recovery', async ({ page, backend }) => {
  backend.refreshStatus = 'running';
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  backend.refreshHttpStatus = 503;
  await page.clock.runFor(30_000);
  await expect(page.getByRole('alert')).toContainText('Unable to check refresh status');
  await expect(page.getByRole('button', { name: 'REFRESHING...' })).toBeDisabled();
  backend.refreshHttpStatus = 200;
  backend.refreshStatus = 'completed';
  await page.clock.runFor(30_000);
  await expect(page.getByText(/Refresh complete/)).toBeVisible();
});

test('server-rejected session asks the visitor to sign in again', async ({ page, backend }) => {
  await signIn(page);
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'REFRESH', exact: true });
  await expect(button).toBeEnabled();
  backend.refreshHttpStatus = 401;
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Please sign in through Terminal Access');
  await expect(button).toBeEnabled();
});

test('refresh button fits the mobile board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'REFRESH', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
