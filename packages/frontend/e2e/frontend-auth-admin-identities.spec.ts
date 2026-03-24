import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';

const authState = {
  userId: 'demo-system-admin',
  roles: ['system_admin', 'admin'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['admins'],
};

type IdentityItem = {
  identityId: string;
  userAccountId: string;
  userName?: string;
  displayName?: string | null;
  userActive: boolean;
  userDeletedAt?: string | null;
  providerType: 'google_oidc' | 'local_password';
  issuer: string;
  providerSubject: string;
  emailSnapshot?: string | null;
  status: 'active' | 'disabled';
  lastAuthenticatedAt?: string | null;
  linkedAt: string;
  effectiveUntil?: string | null;
  rollbackWindowUntil?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  localCredential?: {
    loginId: string;
    passwordAlgo: string;
    mfaRequired: boolean;
    mfaSecretConfigured: boolean;
    mustRotatePassword: boolean;
    failedAttempts: number;
    lockedUntil?: string | null;
    passwordChangedAt?: string | null;
  } | null;
};

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

test('frontend auth identity migration settings smoke @extended', async ({
  page,
}) => {
  ensureEvidenceDir();
  const corsHeaders = {
    'access-control-allow-origin': baseUrl,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers':
      'content-type,x-user-id,x-roles,x-project-ids,x-group-ids,x-group-account-ids,authorization',
    vary: 'Origin',
  };

  let identities: IdentityItem[] = [
    {
      identityId: 'identity-google-1',
      userAccountId: 'user-account-1',
      userName: 'user.one@example.com',
      displayName: 'User One',
      userActive: true,
      userDeletedAt: null,
      providerType: 'google_oidc',
      issuer: 'https://accounts.google.com',
      providerSubject: 'google-subject-0001',
      emailSnapshot: 'user.one@example.com',
      status: 'active',
      lastAuthenticatedAt: '2026-03-23T00:00:00.000Z',
      linkedAt: '2026-03-22T00:00:00.000Z',
      effectiveUntil: null,
      rollbackWindowUntil: '2026-03-30T00:00:00.000Z',
      note: 'seed google',
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      localCredential: null,
    },
  ];

  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.setItem('erp4_active_section', 'admin-settings');
  }, authState);

  await page.route(`${apiBase}/auth/user-identities*`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
        body: '',
      });
      return;
    }
    if (
      route.request().method() !== 'GET' ||
      url.pathname !== '/auth/user-identities'
    ) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders,
      },
      body: JSON.stringify({
        limit: 20,
        offset: 0,
        items: identities,
      }),
    });
  });

  await page.route(
    `${apiBase}/auth/user-identities/google-link`,
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: corsHeaders,
          body: '',
        });
        return;
      }
      const body = JSON.parse(route.request().postData() || '{}') as Record<
        string,
        string | null
      >;
      const created: IdentityItem = {
        identityId: 'identity-google-2',
        userAccountId: String(body.userAccountId || ''),
        userName: 'user.two@example.com',
        displayName: 'User Two',
        userActive: true,
        userDeletedAt: null,
        providerType: 'google_oidc',
        issuer: String(body.issuer || ''),
        providerSubject: String(body.providerSubject || ''),
        emailSnapshot:
          typeof body.emailSnapshot === 'string' ? body.emailSnapshot : null,
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: '2026-03-23T01:00:00.000Z',
        effectiveUntil:
          typeof body.effectiveUntil === 'string' ? body.effectiveUntil : null,
        rollbackWindowUntil:
          typeof body.rollbackWindowUntil === 'string'
            ? body.rollbackWindowUntil
            : null,
        note: typeof body.note === 'string' ? body.note : null,
        createdAt: '2026-03-23T01:00:00.000Z',
        updatedAt: '2026-03-23T01:00:00.000Z',
        localCredential: null,
      };
      identities = [created, ...identities];
      await route.fulfill({
        status: 201,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
        body: JSON.stringify(created),
      });
    },
  );

  await page.route(
    `${apiBase}/auth/user-identities/local-link`,
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: corsHeaders,
          body: '',
        });
        return;
      }
      const body = JSON.parse(route.request().postData() || '{}') as Record<
        string,
        string | null
      >;
      const created: IdentityItem = {
        identityId: 'identity-local-1',
        userAccountId: String(body.userAccountId || ''),
        userName: 'user.one@example.com',
        displayName: 'User One',
        userActive: true,
        userDeletedAt: null,
        providerType: 'local_password',
        issuer: 'erp4_local',
        providerSubject: String(body.loginId || ''),
        emailSnapshot: null,
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: '2026-03-23T02:00:00.000Z',
        effectiveUntil:
          typeof body.effectiveUntil === 'string' ? body.effectiveUntil : null,
        rollbackWindowUntil:
          typeof body.rollbackWindowUntil === 'string'
            ? body.rollbackWindowUntil
            : null,
        note: typeof body.note === 'string' ? body.note : null,
        createdAt: '2026-03-23T02:00:00.000Z',
        updatedAt: '2026-03-23T02:00:00.000Z',
        localCredential: {
          loginId: String(body.loginId || ''),
          passwordAlgo: 'argon2id',
          mfaRequired: false,
          mfaSecretConfigured: false,
          mustRotatePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: null,
        },
      };
      identities = [created, ...identities];
      await route.fulfill({
        status: 201,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
        body: JSON.stringify(created),
      });
    },
  );

  await page.route(`${apiBase}/auth/user-identities/*`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
        body: '',
      });
      return;
    }
    if (
      route.request().method() !== 'PATCH' ||
      url.pathname === '/auth/user-identities/google-link' ||
      url.pathname === '/auth/user-identities/local-link'
    ) {
      await route.fallback();
      return;
    }
    const identityId = url.pathname.split('/').pop();
    const body = JSON.parse(route.request().postData() || '{}') as Record<
      string,
      string | null
    >;
    identities = identities.map((item) =>
      item.identityId === identityId
        ? {
            ...item,
            status: (body.status as 'active' | 'disabled') || item.status,
            effectiveUntil:
              body.effectiveUntil === null
                ? null
                : typeof body.effectiveUntil === 'string'
                  ? body.effectiveUntil
                  : item.effectiveUntil,
            rollbackWindowUntil:
              body.rollbackWindowUntil === null
                ? null
                : typeof body.rollbackWindowUntil === 'string'
                  ? body.rollbackWindowUntil
                  : item.rollbackWindowUntil,
            note:
              body.note === null
                ? null
                : typeof body.note === 'string'
                  ? body.note
                  : item.note,
            updatedAt: '2026-03-23T03:00:00.000Z',
          }
        : item,
    );
    const updated = identities.find((item) => item.identityId === identityId);
    if (!updated) {
      await route.fulfill({
        status: 404,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
        body: JSON.stringify({
          error: {
            code: 'identity_not_found',
            message: 'identity not found',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders,
      },
      body: JSON.stringify(updated),
    });
  });

  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(
    page.locator('main').getByRole('heading', { name: 'Settings', level: 2 }),
  ).toBeVisible();

  const card = page.getByTestId('auth-identity-migration-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('User One')).toBeVisible();

  await card.getByTestId('google-link-user-account-id').fill('user-account-2');
  await card
    .getByTestId('google-link-provider-subject')
    .fill('google-subject-0002');
  await card
    .getByTestId('google-link-email-snapshot')
    .fill('user.two@example.com');
  await card.getByTestId('google-link-ticket-id').fill('TICKET-001');
  await card.getByTestId('google-link-reason-code').fill('google_link');
  await card.getByTestId('google-link-submit').click();
  await expect(
    card
      .getByTestId('auth-identity-item-identity-google-2')
      .getByText('User Two'),
  ).toBeVisible();

  await card.getByTestId('local-link-user-account-id').fill('user-account-1');
  await card.getByTestId('local-link-login-id').fill('user.one.local');
  await card.getByTestId('local-link-password').fill('TempPassw0rd!');
  await card.getByTestId('local-link-ticket-id').fill('TICKET-002');
  await card.getByTestId('local-link-reason-code').fill('local_link');
  await card.getByTestId('local-link-submit').click();
  await expect(
    card
      .getByTestId('auth-identity-item-identity-local-1')
      .getByText('loginId: user.one.local'),
  ).toBeVisible();

  await card.getByTestId('auth-identity-edit-identity-google-1').click();
  await expect(card.getByTestId('auth-identity-edit-form')).toBeVisible();
  await card.getByTestId('identity-update-status').selectOption('disabled');
  await card.getByTestId('identity-update-ticket-id').fill('TICKET-003');
  await card.getByTestId('identity-update-reason-code').fill('disable_google');
  await card.getByTestId('identity-update-submit').click();
  await expect(
    card
      .getByTestId('auth-identity-item-identity-google-1')
      .getByText('disabled'),
  ).toBeVisible();

  const adminSettingsSection = page
    .locator('main')
    .getByRole('heading', { name: 'Settings', level: 2 })
    .locator('..');
  await captureSection(adminSettingsSection, '11-admin-settings.png');
  await captureSection(card, '11-auth-identity-migration.png');
});


test('frontend auth identity migration remains hidden without system_admin @extended', async ({
  page,
}) => {
  ensureEvidenceDir();
  let userIdentitiesRequested = false;

  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.setItem('erp4_active_section', 'admin-settings');
  }, {
    ...authState,
    userId: 'demo-admin-only',
    roles: ['admin'],
  });

  await page.route(`${apiBase}/auth/user-identities*`, async (route) => {
    userIdentitiesRequested = true;
    await route.abort();
    throw new Error('unexpected auth identity request to /auth/user-identities');
  });

  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(
    page.locator('main').getByRole('heading', { name: 'Settings', level: 2 }),
  ).toBeVisible();

  await expect(page.getByTestId('auth-identity-migration-card')).toHaveCount(0);
  await expect(page.getByText('認証方式移行')).toBeVisible();
  await expect(
    page.getByText(
      'この設定は system_admin ロールを持つユーザーのみが操作できます。',
    ),
  ).toBeVisible();
  expect(userIdentitiesRequested).toBe(false);
});
