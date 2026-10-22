import { test, expect, job } from './fixtures.js';

test('combined server filters find a match outside the old 1,000-row sample and reset pagination', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 1001 }, (_, i) => job({
    job_id: `other-${i}`, company: 'Other', title: 'Unrelated', rating: 2, experience: '5+ Yrs',
  }));
  backend.jobs.push(job({ job_id: '000-target', title: 'Target Engineer', rating: 5 }));
  backend.jobs.push(job({ job_id: '000-senior', title: 'Target Engineer', rating: 5, experience: '5+ Yrs' }));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('status')).toContainText('Page 2');
  await page.getByRole('textbox', { name: 'Search jobs' }).fill('  target  ');
  await page.getByRole('combobox', { name: 'Minimum rating' }).selectOption('5');
  await page.getByLabel('Freshers Only').check();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Target Engineer' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Page 1 of 1 · 1 jobs');
  const query = new URLSearchParams(backend.requests.at(-1)?.query);
  expect(query.get('offset')).toBe('0');
  expect(query.get('rating')).toBe('gte.5');
  expect(query.get('or')).toContain('experience.ilike');
  expect(query.get('select')).not.toBe('*');
});

test('equal timestamps use a deterministic tie-breaker across adjacent pages', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 100 }, (_, i) => job({
    job_id: String(i).padStart(3, '0'), title: `Unique role ${i}`,
  })).reverse();
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(50);
  const first = await page.getByRole('heading', { level: 3 }).allTextContents();
  expect(first[0]).toBe('Unique role 99');
  expect(first.at(-1)).toBe('Unique role 50');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('status')).toContainText('Page 2');
  const second = await page.getByRole('heading', { level: 3 }).allTextContents();
  expect(second[0]).toBe('Unique role 49');
  expect(second.at(-1)).toBe('Unique role 0');
  expect(new Set([...first, ...second]).size).toBe(100);
  expect(new URLSearchParams(backend.requests.at(-1)?.query).get('order')).toBe('scraped_at.desc,job_id.desc');
});

test('keyword punctuation and LIKE wildcards remain literal data, not query syntax', async ({ page, backend }) => {
  const keyword = 'A%,(title.eq."anything")_\\';
  backend.jobs = [job({ title: keyword }), job({ job_id: 'unrelated', title: 'anything' })];
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search jobs' }).fill(`  ${keyword}  `);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: keyword, exact: true })).toBeVisible();
});

test('background revalidation advances the last-24-hour cutoff', async ({ page, backend }) => {
  backend.jobs = [job(), job({ job_id: 'expiring', title: 'Expiring role', scraped_at: '2026-10-21T12:00:10Z' })];
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.clock.runFor(30_100);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Expiring role' })).toHaveCount(0);
});

test('a failed later page still lets the visitor return to a working page', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 51 }, (_, i) => job({ job_id: String(i).padStart(3, '0') }));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(50);
  backend.catalogStatus = 500;
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to load jobs');
  backend.catalogStatus = 200;
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByRole('article')).toHaveCount(50);
  await expect(page.getByRole('status')).toContainText('Page 1 of 2');
});

test('a shrinking catalog returns the visitor to an available page', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 51 }, (_, i) => job({ job_id: String(i).padStart(3, '0') }));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('status')).toContainText('Page 2 of 2');
  backend.jobs = [job({ title: 'Only remaining role' })];
  await page.clock.runFor(30_100);
  await expect(page.getByRole('status')).toContainText('Page 1 of 1');
  await expect(page.getByRole('heading', { name: 'Only remaining role' })).toBeVisible();
});

test('an asterisk in a keyword does not expand into a server wildcard', async ({ page, backend }) => {
  backend.jobs = [job({ title: 'A* team' }), job({ job_id: 'other', title: 'A trusted team' })];
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search jobs' }).fill('A*');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'A* team', exact: true })).toBeVisible();
});
