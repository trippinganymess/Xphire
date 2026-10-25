import { test, expect } from './fixtures.js';

test('the board fetches only its active page, not an unseen next page', async ({ page, backend }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);

  const catalogRequests = backend.requests.filter((request) => request.path === '/rest/v1/Seen_job');
  expect(catalogRequests).toHaveLength(1);
  expect(catalogRequests.some((request) => new URLSearchParams(request.query).get('offset') === '51')).toBe(false);
});
