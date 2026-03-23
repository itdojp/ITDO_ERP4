import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const isBffMode =
  (process.env.E2E_AUTH_MODE || '').trim().toLowerCase() === 'jwt_bff';

test('frontend auth gateway bff smoke @extended', async ({ page }) => {
  test.skip(!isBffMode, 'jwt_bff build only');

  await page.addInitScript(() => {
    window.localStorage.removeItem('erp4_auth');
    window.localStorage.setItem('erp4_active_section', 'reports');
  });

  await page.route('**/auth/session', async (route) => {
    await route.fulfill({
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'unauthorized' } }),
    });
  });

  let startRequestUrl = '';
  await page.route('**/auth/google/start*', async (route) => {
    startRequestUrl = route.request().url();
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Googleでログイン' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '簡易ログイン' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Googleでログイン' }).click();
  await expect
    .poll(() => startRequestUrl, { timeout: 10000 })
    .toContain('/auth/google/start');
  expect(new URL(startRequestUrl).searchParams.get('returnTo')).toBe('/');
});
