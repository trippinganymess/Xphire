import { test, expect } from './fixtures.js';

test('terminal code and styles load only when the terminal route is opened', async ({ page, backend }) => {
  const resources: string[] = [];
  page.on('request', (request) => resources.push(new URL(request.url()).pathname));
  await page.goto('/#/');
  await expect(page.getByRole('article')).toHaveCount(2);
  expect(backend.requests.some((request) => request.path === '/rest/v1/Seen_job')).toBe(true);
  expect(resources.some((path) => path.endsWith('/SketchTerminal.tsx'))).toBe(false);
  expect(resources.some((path) => path.endsWith('/SketchTerminal.css'))).toBe(false);
  await page.getByRole('link', { name: 'TERMINAL ACCESS' }).click();
  await expect(page.getByText('System ready. Authentication required to continue.')).toBeVisible();
  expect(resources.some((path) => path.endsWith('/SketchTerminal.tsx'))).toBe(true);
  expect(resources.some((path) => path.endsWith('/SketchTerminal.css'))).toBe(true);
});
