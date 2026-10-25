import { test, expect, job, session } from './fixtures.js';

test('public board uses mocked catalog, query window, filters and safe apply links', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Latest Opportunities' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByText('1h ago').first()).toBeVisible();
  const request = backend.requests.find((r) => r.path === '/rest/v1/Seen_job');
  expect(request?.query).toContain('scraped_at=gte.2026-10-21');
  expect(request?.query).toContain('limit=51');
  const apply = page.getByRole('link', { name: 'APPLY NOW' }).first();
  await expect(apply).toHaveAttribute('href', 'https://jobs.example.test/entry');
  await expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByPlaceholder('Search keyword ...').fill('mumbai');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Senior Analyst' })).toBeVisible();
  await page.getByPlaceholder('Search keyword ...').fill('');
  await page.getByRole('combobox').selectOption('4');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('combobox').selectOption('All');
  await page.getByLabel('Freshers Only').check();
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(backend.requests.every((r) => r.method === 'GET')).toBe(true);
});

test('loading and empty states are distinct', async ({ page, backend }) => {
  backend.jobs = [];
  backend.catalogDelay = true;
  await page.goto('/#/');
  await expect(page.getByText('System scanning for new jobs...')).toBeVisible();
  await expect(page.getByText('No jobs match your filters. Try different criteria.')).toBeVisible();
});

test('terminal access starts at auth menu, never creates an account', async ({ page, backend }) => {
  await page.goto('/#/');
  await page.getByRole('link', { name: 'TERMINAL ACCESS' }).click();
  await expect(page.getByText('System ready. Authentication required to continue.')).toBeVisible();
  await expect(page.locator('.terminal-prompt__label')).toContainText('Select option');
  expect(backend.requests.some((r) => r.path.startsWith('/auth/'))).toBe(false);
});

test('restored synthetic session can submit a mocked, rejected dispatch', async ({ page, backend }) => {
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(stored));
  }, session);
  await page.goto('/#/terminal');
  await expect(page.getByText('✓ Authentication complete. Welcome, Test Candidate!')).toBeVisible();
  const input = page.locator('.terminal-prompt__input');
  const submit = async (value: string, prompt: string) => {
    await expect(page.locator('.terminal-prompt__label')).toContainText(prompt);
    await input.fill(value);
    await input.press('Enter');
    // Legacy terminal uses Date.now() for keys; keep separate commands at distinct instants.
    await page.clock.runFor(10);
  };
  await submit('run', 'test_candidate@xphire');
  await submit('Backend Engineer', 'Job title to search');
  await submit('', 'Recipient email');
  await submit('y', 'Freshers / Entry-level');
  await submit('4', 'Minimum company rating');
  await submit('y', 'Dispatch workflow');
  await expect(page.getByText(/Failed to dispatch workflow: Offline dispatch rejected/)).toBeVisible();
  await expect(page.locator('.terminal-prompt__label')).toContainText('test_candidate@xphire');
  const dispatches = backend.requests.filter((r) => r.path.includes('/functions/'));
  expect(dispatches).toHaveLength(1);
  expect(dispatches[0]?.body).toEqual({ jobTitle: 'Backend Engineer',
    recipientEmail: 'candidate@example.test', freshersOnly: true, minStars: 4 });
  expect(backend.requests.some((r) => r.path === '/auth/v1/signup')).toBe(false);
});

// Expected failures assert the V2 contract, NOT the current bug as correct behavior.
// Playwright treats an unexpected pass as a failure, requiring removal when fixed.
for (const experience of ['0-2 Yrs', 'Internship']) {
  test(`ticket 08: fresher filter includes ${experience}`, async ({ page, backend }) => {
    backend.jobs = [job({ experience })];
    await page.goto('/#/');
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByLabel('Freshers Only').check();
    await expect(page.locator('.job-board')).toHaveAttribute('aria-busy', 'false');
    const count = await page.getByRole('article').count();
    test.fail(true, 'Ticket 08: board only checks Fresher/0-1 substrings');
    expect(count).toBe(1);
  });
}

test('ticket 08: fresher filter excludes 10-12 Yrs', async ({ page, backend }) => {
  backend.jobs = [job({ experience: '10-12 Yrs' })];
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Freshers Only').check();
  await expect(page.locator('.job-board')).toHaveAttribute('aria-busy', 'false');
  const count = await page.getByRole('article').count();
  test.fail(true, 'Ticket 08: 10-12 contains 0-1');
  expect(count).toBe(0);
});

test('ticket 10/12: recently scraped closed jobs are not offered', async ({ page, backend }) => {
  backend.jobs = [job({ lifecycle_status: 'closed' })];
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(1);
  const count = await page.getByRole('article').count();
  test.fail(true, 'Tickets 10/12: lifecycle is not persisted/consumed yet');
  expect(count).toBe(0);
});
