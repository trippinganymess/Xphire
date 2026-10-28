import { test, expect, job } from './fixtures.js';

const catalogRequests = (backend: { requests: { path: string }[] }) =>
  backend.requests.filter((request) => request.path === '/rest/v1/Seen_job');

test('stale public results remain visible while one background request refreshes them', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  expect(catalogRequests(backend)).toHaveLength(1);
  const input = page.getByRole('textbox', { name: 'Search jobs' });
  await input.focus();
  backend.jobs.push(job({ job_id: 'new', title: 'New opportunity' }));
  let release = () => {};
  backend.catalogGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.clock.runFor(30_100);
    await expect(page.getByText('Refreshing jobs...')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect.poll(() => catalogRequests(backend).length).toBe(2);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(catalogRequests(backend)).toHaveLength(2);
    release();
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'New opportunity' })).toBeVisible();
    await expect(page.getByText('Refreshing jobs...')).toHaveCount(0);
    await expect(input).toBeFocused();
  } finally { release(); }
});

test('failed initial fetch offers retry instead of claiming there are no matches', async ({ page, backend }) => {
  backend.catalogStatus = 503;
  await page.goto('/#/');
  await expect(page.getByRole('alert')).toContainText('Unable to load jobs');
  await expect(page.getByText('No jobs match your filters. Try different criteria.')).toHaveCount(0);
  backend.catalogStatus = 200;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('failed background refresh keeps useful results and retry replaces them', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  backend.catalogStatus = 503;
  await page.clock.runFor(30_100);
  await expect(page.getByRole('alert')).toContainText('Refresh failed. Showing previously loaded results.');
  await expect(page.getByRole('article')).toHaveCount(2);
  backend.catalogStatus = 200;
  backend.jobs = [job({ title: 'Recovered result' })];
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Recovered result' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('cached pages are separated by page and filters', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 52 }, (_, i) => job({ job_id: String(i).padStart(3, '0'), title: `Role ${i}` }));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(51);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Role 0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByRole('article')).toHaveCount(51);
  expect(catalogRequests(backend)).toHaveLength(2);
  await page.getByRole('textbox', { name: 'Search jobs' }).fill('Role 0');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Role 0', exact: true })).toBeVisible();
  expect(catalogRequests(backend)).toHaveLength(3);
});

test('a late query cannot replace a newer filter result', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  let release = () => {};
  backend.catalogGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.getByRole('textbox', { name: 'Search jobs' }).fill('Acme');
    await expect.poll(() => catalogRequests(backend).length).toBe(2);
    backend.catalogGate = null;
    await page.getByRole('textbox', { name: 'Search jobs' }).fill('Mumbai');
    await expect(page.getByRole('heading', { name: 'Senior Analyst' })).toBeVisible();
    release();
    // Revisit the old key to prove its response completed and was cached.
    await page.getByRole('textbox', { name: 'Search jobs' }).fill('Acme');
    await expect(page.getByRole('heading', { name: 'Junior Engineer' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search jobs' }).fill('Mumbai');
    await expect(page.getByRole('heading', { name: 'Senior Analyst' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    expect(catalogRequests(backend)).toHaveLength(3);
  } finally { release(); }
});

test('a public page older than five minutes is not displayed as cached data', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('link', { name: 'TERMINAL ACCESS' }).click();
  await expect(page.getByText('System ready. Authentication required to continue.')).toBeVisible();
  await page.clock.runFor(5 * 60_000 + 100);
  backend.jobs = [job({ title: 'Fresh after expiry' })];
  let release = () => {};
  backend.catalogGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.getByRole('link', { name: 'Xphire Home' }).click();
    await expect(page.getByText('System scanning for new jobs...')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Junior Engineer' })).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: 'Fresh after expiry' })).toBeVisible();
  } finally { release(); }
});

test('the public cache evicts old query pages rather than growing without bound', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 21 }, (_, i) => job({ job_id: String(i), title: `Key ${i}.` }));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(21);
  for (let i = 0; i < 21; i++) {
    await page.getByRole('textbox', { name: 'Search jobs' }).fill(`Key ${i}.`);
    await expect(page.getByRole('heading', { name: `Key ${i}.`, exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
  }
  expect(catalogRequests(backend)).toHaveLength(22);
  await page.getByRole('textbox', { name: 'Search jobs' }).fill('');
  await expect(page.getByRole('article')).toHaveCount(21);
  expect(catalogRequests(backend)).toHaveLength(23);
});

test('a stale remount displays cached results while refreshing in the background', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('link', { name: 'TERMINAL ACCESS' }).click();
  await expect(page.getByText('System ready. Authentication required to continue.')).toBeVisible();
  await page.clock.runFor(31_000);
  backend.jobs = [job({ title: 'Revalidated return' })];
  let release = () => {};
  backend.catalogGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.getByRole('link', { name: 'Xphire Home' }).click();
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(page.getByText('Refreshing jobs...')).toBeVisible();
    release();
    await expect(page.getByRole('heading', { name: 'Revalidated return' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
  } finally { release(); }
});

test('hidden boards pause scheduled fetching and revalidate on becoming visible', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  await page.clock.runFor(31_000);
  expect(catalogRequests(backend)).toHaveLength(1);
  backend.jobs = [job({ title: 'Visible refresh' })];
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'Visible refresh' })).toBeVisible();
  expect(catalogRequests(backend)).toHaveLength(2);
});
