import { test, expect, job } from './fixtures.js';

test('each page loads at most 51 jobs and jobs beyond 1,000 remain reachable', async ({ page, backend }) => {
  backend.jobs = Array.from({ length: 1005 }, (_, i) => job({
    job_id: `job-${String(i).padStart(4, '0')}`, title: `Opportunity ${i}`,
  }));
  backend.jobs.push(job({ job_id: 'old', title: 'Outside the window', scraped_at: '2026-10-21T11:00:00Z' }));
  backend.jobs.push(job({ job_id: 'future', title: 'Future timestamp', scraped_at: '2026-10-22T13:00:00Z' }));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(51);
  await expect(page.getByRole('status')).toContainText('Page 1 of 20');
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  for (let i = 2; i <= 20; i++) {
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('status')).toContainText(`Page ${i} of 20`);
  }
  await expect(page.getByRole('article')).toHaveCount(36);
  await expect(page.getByRole('heading', { name: 'Opportunity 0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await expect(page.getByText('Outside the window')).toHaveCount(0);
  await expect(page.getByText('Future timestamp')).toHaveCount(0);
  const requests = backend.requests.filter((r) => r.path === '/rest/v1/Seen_job');
  expect(requests.every((r) => new URLSearchParams(r.query).get('limit') === '51')).toBe(true);
  expect(requests.at(-1)?.query).toContain('offset=969');
});

test('returning to the board reuses a fresh public page without another catalog request', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  const initialRequests = backend.requests.filter((r) => r.path === '/rest/v1/Seen_job').length;
  await page.getByRole('link', { name: 'TERMINAL ACCESS' }).click();
  await expect(page.getByText('System ready. Authentication required to continue.')).toBeVisible();
  backend.catalogStatus = 500;
  await page.getByRole('link', { name: 'Xphire Home' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  // A failed backend makes accidental refetching observable as an error, too.
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(backend.requests.filter((r) => r.path === '/rest/v1/Seen_job')).toHaveLength(initialRequests);
});
