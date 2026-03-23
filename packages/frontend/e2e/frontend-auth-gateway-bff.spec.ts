import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const isBffMode =
  (process.env.E2E_AUTH_MODE || '').trim().toLowerCase() === 'jwt_bff';

const futureIso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();

function ensureEvidenceDir() {
  if (!captureEnabled) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
}

async function captureSection(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  const capturePath = path.join(evidenceDir, filename);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    await expect(locator).toBeVisible({ timeout: 5000 });
    await locator.screenshot({ path: capturePath });
  } catch {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
      // UI 証跡取得失敗でテスト自体は落とさない。
    }
  }
}

async function mockAuthCsrf(page: Page) {
  await page.route('**/auth/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csrfToken: 'csrf-token-001' }),
    });
  });
}

test('frontend auth gateway bff smoke @extended', async ({ page }) => {
  test.skip(!isBffMode, 'jwt_bff build only');
  ensureEvidenceDir();

  await page.addInitScript(() => {
    window.localStorage.removeItem('erp4_auth');
    window.localStorage.setItem('erp4_active_section', 'reports');
  });

  await page.route('**/auth/google/start*', async (route) => {
    await route.fulfill({
      status: 204,
      body: '',
    });
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

  const loginRequestPromise = page.waitForRequest('**/auth/google/start*');
  await page.getByRole('button', { name: 'Googleでログイン' }).click();
  const loginRequest = await loginRequestPromise;
  const loginUrl = new URL(loginRequest.url());
  expect(loginUrl.pathname).toBe('/auth/google/start');
  expect(loginUrl.searchParams.get('returnTo')).toBe('/');
});

test('frontend auth gateway bff local login smoke @extended', async ({
  page,
}) => {
  test.skip(!isBffMode, 'jwt_bff build only');
  ensureEvidenceDir();

  let sessionState: 'unauthorized' | 'authenticated' = 'unauthorized';

  await page.addInitScript(() => {
    window.localStorage.removeItem('erp4_auth');
    window.localStorage.setItem('erp4_active_section', 'reports');
  });
  await mockAuthCsrf(page);

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
            expiresAt: futureIso(7),
            idleExpiresAt: futureIso(1),
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

  await page.route('**/auth/sessions?*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 20,
        offset: 0,
        items: [
          {
            sessionId: 'sess-local-1',
            providerType: 'local_password',
            issuer: 'erp4_local',
            userAccountId: 'user-local-1',
            userIdentityId: 'identity-local-1',
            sourceIp: '203.0.113.10',
            userAgent: 'Mozilla/5.0 Local Session',
            createdAt: futureIso(0),
            lastSeenAt: futureIso(0),
            expiresAt: futureIso(7),
            idleExpiresAt: futureIso(1),
            revokedAt: null,
            revokedReason: null,
            current: true,
          },
        ],
      }),
    });
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
  await expect(page.getByText('Session ID: sess-local-1')).toBeVisible();
});

test('frontend auth gateway bff local bootstrap password rotation @extended', async ({
  page,
}) => {
  test.skip(!isBffMode, 'jwt_bff build only');
  ensureEvidenceDir();

  await page.addInitScript(() => {
    window.localStorage.removeItem('erp4_auth');
    window.localStorage.setItem('erp4_active_section', 'reports');
  });
  await mockAuthCsrf(page);

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

test('frontend auth gateway bff session management smoke @extended', async ({
  page,
}) => {
  test.skip(!isBffMode, 'jwt_bff build only');
  ensureEvidenceDir();

  let sessionItems = [
    {
      sessionId: 'sess-current',
      providerType: 'google_oidc',
      issuer: 'https://accounts.google.com',
      userAccountId: 'user-current-1',
      userIdentityId: 'identity-google-1',
      sourceIp: '203.0.113.10',
      userAgent: 'Mozilla/5.0 Current Session',
      createdAt: futureIso(0),
      lastSeenAt: futureIso(0),
      expiresAt: futureIso(7),
      idleExpiresAt: futureIso(1),
      revokedAt: null,
      revokedReason: null,
      current: true,
    },
    {
      sessionId: 'sess-other',
      providerType: 'google_oidc',
      issuer: 'https://accounts.google.com',
      userAccountId: 'user-current-1',
      userIdentityId: 'identity-google-1',
      sourceIp: '203.0.113.20',
      userAgent: 'Mozilla/5.0 Other Session',
      createdAt: futureIso(0),
      lastSeenAt: futureIso(0),
      expiresAt: futureIso(7),
      idleExpiresAt: futureIso(1),
      revokedAt: null,
      revokedReason: null,
      current: false,
    },
  ];

  await page.addInitScript(() => {
    window.localStorage.removeItem('erp4_auth');
    window.localStorage.setItem('erp4_active_section', 'reports');
  });
  await mockAuthCsrf(page);

  await page.route('**/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: {
          userId: 'bff-user',
          roles: ['user'],
          groupIds: [],
          projectIds: [],
          groupAccountIds: [],
        },
        session: {
          sessionId: 'sess-current',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          userAccountId: 'user-current-1',
          userIdentityId: 'identity-google-1',
          expiresAt: futureIso(7),
          idleExpiresAt: futureIso(1),
        },
      }),
    });
  });

  await page.route('**/auth/sessions?*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 20,
        offset: 0,
        items: sessionItems,
      }),
    });
  });

  await page.route('**/auth/sessions/sess-other/revoke', async (route) => {
    sessionItems = sessionItems.filter(
      (item) => item.sessionId !== 'sess-other',
    );
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'sess-other',
        providerType: 'google_oidc',
        issuer: 'https://accounts.google.com',
        userAccountId: 'user-current-1',
        userIdentityId: 'identity-google-1',
        sourceIp: '203.0.113.20',
        userAgent: 'Mozilla/5.0 Other Session',
        createdAt: futureIso(0),
        lastSeenAt: futureIso(0),
        expiresAt: futureIso(7),
        idleExpiresAt: futureIso(1),
        revokedAt: futureIso(0),
        revokedReason: 'user_requested',
        current: false,
      }),
    });
  });

  await page.goto(baseUrl);
  await expect(page.getByText('ID: bff-user')).toBeVisible();
  await expect(page.getByText('現在のセッション')).toBeVisible();
  await expect(page.getByText('他のセッション')).toBeVisible();
  await expect(page.getByText('Session ID: sess-other')).toBeVisible();

  await page.getByRole('button', { name: 'このセッションを失効' }).click();

  await expect(page.getByText('認証セッションを失効しました')).toBeVisible();
  await expect(page.getByText('Session ID: sess-other')).toHaveCount(0);
  await expect(page.getByText('Session ID: sess-current')).toBeVisible();
  await captureSection(
    page.locator('.card').filter({ hasText: '現在のユーザー' }),
    '00-current-user-auth-sessions.png',
  );
});
