import type { Page } from '@playwright/test';
import { test, expect, privateJob, session } from './fixtures.js';

async function signIn(page: Page) {
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(stored));
  }, session);
}

async function changeSession(page: Page, stored: typeof session | null) {
  await page.evaluate(async (next) => {
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(modulePath);
    if (!next) await supabase.auth.signOut();
    else await supabase.auth.setSession({ access_token: next.access_token, refresh_token: next.refresh_token });
  }, stored);
}

function jwt(userId: string): string {
  const encode = (body: unknown) => Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: Date.parse('2026-10-23T12:00:00Z') / 1000 })}.offline`;
}

const privateCalls = (requests: { path: string }[]) => requests.filter((r) => r.path.includes('private'));

test('PJobB is beside Latest Opportunities and guests cannot request private jobs', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Latest Opportunities' })).toBeVisible();
  const button = page.getByRole('link', { name: 'PJobB', exact: true });
  await expect(button).toHaveAttribute('href', '#/private-jobs');
  await expect(button).toHaveCSS('background-color', 'rgb(194, 229, 148)');
  await button.click();
  await expect(page.getByRole('heading', { name: 'Private Job Board' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to open PJobB' })).toBeVisible();
  expect(privateCalls(backend.requests)).toHaveLength(0);
  await expect(page.getByRole('link', { name: 'Sign in through Terminal Access' })).toHaveAttribute('href', '#/terminal');
});

test('signed-in unpaid users fail closed before private catalog or paid discovery', async ({ page, backend }) => {
  await signIn(page);
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('heading', { name: 'Active paid access required' })).toBeVisible();
  expect(backend.requests.some((r) => r.path === '/rest/v1/private_jobs')).toBe(false);
  expect(backend.requests.some((r) => r.path === '/functions/v1/private-job-board')).toBe(false);
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('paid private board shows cyan own-user cards with no public scraper or fabricated rating', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  backend.privateJobs.push(privateJob({ user_id: '00000000-0000-0000-0000-000000000002', title: 'Other person secret' }));
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Private Junior Engineer' })).toBeVisible();
  await expect(page.getByText('Other person secret')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCSS('background-color', 'rgb(128, 229, 237)');
  await expect(page.getByText('Posted 2026-10-20 · time not supplied')).toBeVisible();
  await expect(page.getByText('Found 1h ago')).toBeVisible();
  await expect(page.locator('.job-card-rating')).toHaveCount(0);
  const request = backend.requests.find((r) => r.path === '/rest/v1/private_jobs');
  expect(request?.query).toContain(`user_id=eq.${session.user.id}`);
  expect(request?.query).toContain('limit=51');
  expect(request?.query).not.toContain('gte.2026-10-21');
  expect(request?.authorization).toBe('Bearer offline-access-token');
  expect(backend.requests.some((r) => r.path === '/rest/v1/Seen_job' || r.path.includes('refresh-jobs'))).toBe(false);
  await page.screenshot({ path: '/tmp/xphire-private-job-board.png', fullPage: true });
});

test('private keyword filters, provider labels, pagination and page clamping reuse board logic', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  backend.privateJobs = Array.from({ length: 53 }, (_, i) => privateJob({ job_id: String(i).padStart(3, '0'),
    title: `Engineer ${i}`, company: i === 0 ? 'Needle' : 'Company', experience: i === 1 ? 'Senior' : 'Junior' }));
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(51);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByLabel('Search jobs').fill('Needle');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Page 1 of 1 · 1 jobs')).toBeVisible();
  await page.getByLabel('Search jobs').fill('');
  await page.getByLabel('Junior / internship (provider label)').check();
  await expect(page.getByText('Page 1 of 2 · 52 jobs')).toBeVisible();
  await page.getByLabel('Junior / internship (provider label)').uncheck();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  backend.privateJobs = [privateJob()];
  await page.getByRole('button', { name: 'Reload board' }).click();
  await expect(page.getByText('Page 1 of 1 · 1 jobs')).toBeVisible();
});

test('discovery sends only the chosen query once and reload never calls a paid/public API', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  backend.privateJobs = [];
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('button', { name: 'FIND MY JOBS' })).toBeEnabled();
  await page.getByLabel('Job title for your daily discovery').fill('python developer');
  await page.getByRole('button', { name: 'FIND MY JOBS' }).click();
  await expect(page.getByText('Discovery complete: 1 jobs saved to your private board.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discovered Frontend Engineer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'FIND MY JOBS' })).toBeDisabled();
  const discoveries = backend.requests.filter((r) => r.path === '/functions/v1/private-job-board');
  expect(discoveries).toHaveLength(1);
  expect(discoveries[0]?.body).toEqual({ query: 'python developer' });
  await page.getByRole('button', { name: 'Reload board' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(backend.requests.filter((r) => r.path === '/functions/v1/private-job-board')).toHaveLength(1);
  expect(backend.requests.some((r) => r.path.includes('refresh-jobs') || r.path === '/rest/v1/Seen_job')).toBe(false);
});

test('quota response preserves saved jobs and disables further discovery', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  backend.privateDiscoveryHttpStatus = 429;
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'FIND MY JOBS' }).click();
  await expect(page.getByRole('alert')).toContainText('daily discovery allowance has been used');
  await expect(page.getByRole('button', { name: 'FIND MY JOBS' })).toBeDisabled();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('revoked paid access and unavailable access checks clear private cards', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  backend.privateAccess.allowed = false;
  await page.getByRole('button', { name: 'Reload board' }).click();
  await expect(page.getByRole('heading', { name: 'Active paid access required' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  backend.privateAccessHttpStatus = 503;
  await page.getByRole('button', { name: 'Check access again' }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to load your private board');
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('invalid apply URL never becomes an active link', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  backend.privateJobs = [privateJob({ url: 'javascript:alert(1)' })];
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Apply link unavailable')).toBeVisible();
  await expect(page.getByRole('link', { name: 'APPLY NOW' })).toHaveCount(0);
});

test('sign-out discards saved jobs and late private requests cannot restore them', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  let release!: () => void;
  backend.privateCatalogGate = new Promise<void>((resolve) => { release = resolve; });
  const before = backend.requests.filter((r) => r.path === '/rest/v1/private_jobs').length;
  await page.getByRole('button', { name: 'Reload board' }).click();
  await expect.poll(() => backend.requests.filter((r) => r.path === '/rest/v1/private_jobs').length).toBeGreaterThan(before);
  await changeSession(page, null);
  await expect(page.getByRole('heading', { name: 'Sign in to open PJobB' })).toBeVisible();
  release();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('account switch clears old private data and queries only the new owner', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('heading', { name: 'Private Junior Engineer' })).toBeVisible();
  const next = structuredClone(session);
  next.user.id = '00000000-0000-0000-0000-000000000002';
  next.access_token = jwt(next.user.id);
  backend.authSession = next;
  backend.privateJobs.push(privateJob({ user_id: next.user.id, title: 'Second account job' }));
  await changeSession(page, next);
  await expect(page.getByRole('heading', { name: 'Second account job' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private Junior Engineer' })).toHaveCount(0);
  const privateRequests = backend.requests.filter((r) => r.path === '/rest/v1/private_jobs');
  expect(privateRequests.at(-1)?.query).toContain(`user_id=eq.${next.user.id}`);
});

test('private access polling pauses while hidden and recovers on visibility', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  const count = backend.requests.filter((r) => r.path.includes('private_job_board_access')).length;
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  await page.clock.runFor(61_000);
  expect(backend.requests.filter((r) => r.path.includes('private_job_board_access'))).toHaveLength(count);
  backend.privateAccess.allowed = false;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'Active paid access required' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('header Sign Out revokes the SDK session and hides the private board', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.locator('.sketch-header__pfp').click();
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to open PJobB' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(backend.requests.filter((r) => r.path === '/auth/v1/logout')).toHaveLength(1);
});

test('private cards wrap long content at 200 percent zoom and honour reduced motion', async ({ page, backend }) => {
  await signIn(page);
  backend.privateAccess.allowed = true;
  backend.privateJobs = [privateJob({ title: 'A long private job title '.repeat(10), location: 'Remote in Bengaluru, India '.repeat(8) })];
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/private-jobs');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.locator('.private-job-board').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await expect(page.getByRole('article')).toHaveCSS('transition-duration', '0s');
});

for (const width of [320, 390, 768, 1440]) {
  test(`private board remains readable at ${width}px`, async ({ page, backend }) => {
    await signIn(page);
    backend.privateAccess.allowed = true;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/private-jobs');
    await expect(page.getByRole('article')).toHaveCount(1);
    const overflows = await page.locator('.private-job-board').evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflows).toBe(false);
  });
}
