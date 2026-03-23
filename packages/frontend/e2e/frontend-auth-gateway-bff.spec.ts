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

  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Googleでログイン' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '簡易ログイン' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Googleでログイン' }).click();
  await page.waitForURL('**/auth/google/start*');
  expect(page.url()).toContain('/auth/google/start');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/');
});

test('frontend auth gateway bff local login smoke @extended', async ({
  page,
}) => {
  test.skip(!isBffMode, 'jwt_bff build only');

  let sessionState: 'unauthorized' | 'authenticated' = 'unauthorized';

  await page.addInitScript(() => {
    window.localStorage.removeItem('erp4_auth');
    window.localStorage.setItem('erp4_active_section', 'reports');
  });

  await page.route('**/auth/session', async (route) => {
    if (sessionState === 'authenticated') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user: {
            userId: 'local-user',
            roles: ['user'],
            groupIds: [],
            projectIds: [],
            groupAccountIds: [],
          },
          session: {
            sessionId: 'sess-local-1',
            providerType: 'local_password',
            issuer: 'erp4_local',
            userAccountId: 'user-local-1',
            userIdentityId: 'identity-local-1',
            expiresAt: '2026-03-24T00:00:00.000Z',
            idleExpiresAt: '2026-03-23T12:00:00.000Z',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'unauthorized' } }),
    });
  });

  await page.route('**/auth/local/login', async (route) => {
    sessionState = 'authenticated';
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Googleでログイン' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'ローカルログイン' }),
  ).toBeVisible();

  await page.getByLabel('ローカル認証 loginId').fill('local-user');
  await page.getByLabel('ローカル認証 password').fill('TempPassw0rd!');
  await page.getByRole('button', { name: 'ローカルログイン' }).click();

  await expect(page.getByText('ID: local-user')).toBeVisible();
  await expect(page.getByText('Roles: user')).toBeVisible();
});

test('frontend auth gateway bff local bootstrap password rotation @extended', async ({
  page,
}) => {
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

  await page.route('**/auth/local/login', async (route) => {
    await route.fulfill({
      status: 409,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'local_password_rotation_required' },
      }),
    });
  });

  await page.route('**/auth/local/password/rotate', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();

  await page.getByLabel('ローカル認証 loginId').fill('bootstrap-user');
  await page.getByLabel('ローカル認証 password').fill('TempPassw0rd!');
  await page.getByRole('button', { name: 'ローカルログイン' }).click();

  await expect(
    page.getByRole('button', { name: '初期パスワードを更新' }),
  ).toBeVisible();
  await page.getByLabel('ローカル認証 new password').fill('NewPassw0rd!');
  await page.getByRole('button', { name: '初期パスワードを更新' }).click();

  await expect(
    page.getByText(
      '初期パスワードを更新しました。新しいパスワードで再度ログインしてください',
    ),
  ).toBeVisible();
});
