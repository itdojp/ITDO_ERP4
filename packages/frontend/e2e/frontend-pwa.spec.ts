import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const pushPublicKey = (process.env.VITE_PUSH_PUBLIC_KEY || '').trim();
const swCacheName = 'erp4-pwa-v1';

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
};

function ensureEvidenceDir() {
  if (!captureEnabled) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
}

async function captureSection(locator: Locator, filename: string) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  if (!captureEnabled) return;
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

async function prepare(
  page: Page,
  options?: { grantNotifications?: boolean; mockPush?: boolean },
) {
  ensureEvidenceDir();
  if (options?.grantNotifications) {
    await page.addInitScript(() => {
      if (!('Notification' in window)) return;
      try {
        Notification.requestPermission = () => Promise.resolve('granted');
      } catch {
        // ignore
      }
    });
  }
  if (options?.mockPush) {
    await page.addInitScript(() => {
      if (!('PushManager' in window)) return;
      const makeSubscription = () => {
        const endpoint = `https://example.com/push/${Math.random()}`;
        const keys = {
          p256dh: btoa(Math.random().toString(36)),
          auth: btoa(Math.random().toString(36)),
        };
        return {
          endpoint,
          expirationTime: null,
          options: { userVisibleOnly: true },
          getKey: () => new Uint8Array(),
          toJSON: () => ({ endpoint, expirationTime: null, keys }),
          unsubscribe: async () => true,
        };
      };
      try {
        PushManager.prototype.subscribe = async function subscribe() {
          const subscription = makeSubscription();
          (window as { __testPushSub?: unknown }).__testPushSub = subscription;
          return subscription;
        };
        PushManager.prototype.getSubscription = async function getSubscription() {
          return (window as { __testPushSub?: unknown }).__testPushSub || null;
        };
      } catch {
        // ignore
      }
    });
  }
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible();
}

async function selectByLabelOrFirst(select: Locator, label: string) {
  if (await select.locator('option', { hasText: label }).count()) {
    await select.selectOption({ label });
    return;
  }
  await select.selectOption({ index: 1 });
}

async function ensureServiceWorker(page: Page) {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      try {
        registration = await navigator.serviceWorker.register('/sw.js');
      } catch {
        return false;
      }
    }
    await navigator.serviceWorker.ready;
    return true;
  });
}

test('pwa offline duplicate time entries @pwa @extended', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await prepare(page);

  const timeSection = page
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    timeSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );

  await context.setOffline(true);

  await timeSection.locator('input[type="number"]').fill('75');
  await timeSection.getByPlaceholder('作業種別').fill('E2E-DUP');
  await timeSection.getByPlaceholder('場所').fill('offline-dup');

  const addButton = timeSection.getByRole('button', { name: '追加' });
  await addButton.click();
  await expect(
    timeSection.getByText('オフラインのため送信待ちに保存しました'),
  ).toBeVisible();
  await addButton.click();
  await expect(
    timeSection.getByText('オフラインのため送信待ちに保存しました'),
  ).toBeVisible();

  const currentSection = page.locator('.card', {
    has: page.locator('strong', { hasText: '現在のユーザー' }),
  });
  await currentSection.scrollIntoViewIfNeeded();
  await currentSection.getByRole('button', { name: '再読込' }).click();
  await expect
    .poll(
      async () => {
        const statusText = await currentSection
          .getByText(/件数:/)
          .textContent();
        const match = statusText?.match(/件数:\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(2);

  await context.setOffline(false);

  const resendButton = currentSection.getByRole('button', { name: '再送' });
  if (await resendButton.isEnabled().catch(() => false)) {
    await resendButton.click();
  }
  await expect
    .poll(
      async () => {
        const statusText = await currentSection
          .getByText(/件数:/)
          .textContent();
        const match = statusText?.match(/件数:\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 10_000 },
    )
    .toBe(0);

  await page.reload();
  const timeSectionReload = page
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSectionReload.scrollIntoViewIfNeeded();
  const dupItems = timeSectionReload.locator('ul.list li', {
    hasText: 'E2E-DUP',
  });
  await expect(dupItems).toHaveCount(2);
  await captureSection(
    timeSectionReload,
    '16-offline-duplicate-time-entry.png',
  );
});

test('pwa push subscribe flow @pwa', async ({ page, context }) => {
  test.setTimeout(120_000);
  if (!pushPublicKey) {
    test.skip(true, 'VITE_PUSH_PUBLIC_KEY が未設定のためスキップ');
  }
  await context.grantPermissions(['notifications'], { origin: baseUrl });
  await prepare(page, { grantNotifications: true, mockPush: true });

  const swReady = await ensureServiceWorker(page);
  if (!swReady) {
    test.skip(true, 'Service Worker が利用できないためスキップ');
  }

  const pushSection = page
    .locator('strong', { hasText: 'Push通知' })
    .locator('..');
  await pushSection.scrollIntoViewIfNeeded();
  const consent = pushSection.getByRole('checkbox', {
    name: '通知の受信に同意します',
  });
  await consent.check();
  const alertsTopic = pushSection.getByLabel('アラート');
  if (!(await alertsTopic.isChecked())) {
    await alertsTopic.check();
  }

  await pushSection.getByRole('button', { name: '購読登録' }).click();
  await expect(pushSection.getByText('Push購読を登録しました')).toBeVisible();
  await expect(pushSection.getByText('Subscription: 登録済み')).toBeVisible();
  await captureSection(pushSection, '17-push-registered.png');

  await pushSection.getByRole('button', { name: 'テスト通知' }).click();
  await expect(pushSection.getByText('テスト通知を送信しました')).toBeVisible();

  await pushSection.getByRole('button', { name: '購読解除' }).click();
  await expect(pushSection.getByText('Push購読を解除しました')).toBeVisible();
  await expect(pushSection.getByText('Subscription: 未登録')).toBeVisible();
  await captureSection(pushSection, '18-push-unsubscribed.png');

  await pushSection.getByRole('button', { name: '購読登録' }).click();
  await expect(pushSection.getByText('Push購読を登録しました')).toBeVisible();
  await expect(pushSection.getByText('Subscription: 登録済み')).toBeVisible();
  await captureSection(pushSection, '19-push-resubscribed.png');
});

test('pwa service worker cache refresh @pwa @extended', async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);

  const swReady = await ensureServiceWorker(page);
  if (!swReady) {
    test.skip(true, 'Service Worker が利用できないためスキップ');
  }

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          return caches.keys();
        }),
      { timeout: 10_000 },
    )
    .toContain(swCacheName);

  await page.evaluate(async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  });

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          return caches.keys();
        }),
      { timeout: 10_000 },
    )
    .not.toContain(swCacheName);

  await page.reload();
  await ensureServiceWorker(page);

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          return caches.keys();
        }),
      { timeout: 10_000 },
    )
    .toContain(swCacheName);

  const dashboardSection = page
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  await captureSection(dashboardSection, '20-sw-cache-refresh.png');
});
