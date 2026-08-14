import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const dateTag = process.env.E2E_DATE || new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const pushPublicKey = (process.env.VITE_PUSH_PUBLIC_KEY || '').trim();
const swCacheName = 'erp4-pwa-v2';

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
};

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

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
      let fallbackSeq = 0;
      const randomBytes = (size: number) => {
        const bytes = new Uint8Array(size);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          crypto.getRandomValues(bytes);
          return bytes;
        }
        for (let i = 0; i < size; i += 1) {
          bytes[i] = (i * 73 + 19) & 0xff;
        }
        return bytes;
      };
      const bytesToBase64 = (bytes: Uint8Array) => {
        let binary = '';
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        return btoa(binary);
      };
      const makeId = () => {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
          return crypto.randomUUID();
        }
        fallbackSeq += 1;
        return `${Date.now()}-${fallbackSeq}`;
      };
      const makeSubscription = () => {
        const endpoint = `https://example.com/push/${makeId()}`;
        const keys = {
          p256dh: bytesToBase64(randomBytes(16)),
          auth: bytesToBase64(randomBytes(12)),
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
        PushManager.prototype.getSubscription =
          async function getSubscription() {
            return (
              (window as { __testPushSub?: unknown }).__testPushSub || null
            );
          };
      } catch {
        // ignore
      }
    });
  }
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function selectByLabelOrFirst(select: Locator, label: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: 15_000 })
    .toBeGreaterThan(1);
  await expect
    .poll(() => select.locator('option', { hasText: label }).count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await select.selectOption({ label });
}

async function ensureServiceWorker(page: Page) {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch {
        return false;
      }
    }
    await navigator.serviceWorker.ready;
    return true;
  });
}

async function ensureControlledServiceWorker(page: Page) {
  if (!(await ensureServiceWorker(page))) return false;
  if (
    !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
  ) {
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
    ).toBeVisible();
  }
  return page.evaluate(() => Boolean(navigator.serviceWorker.controller));
}

test('pwa manifest declares a bounded text-only Web Share Target @pwa', async ({
  page,
}) => {
  await prepare(page);
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.webmanifest', {
      cache: 'no-store',
    });
    return response.json();
  });
  expect(manifest.share_target).toEqual({
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { title: 'title', text: 'text', url: 'url' },
  });
  expect(manifest.share_target.params.files).toBeUndefined();
});

test('pwa Web Share Target stages locally, resumes explicitly, and never puts content in its URL @pwa @extended', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await prepare(page);
  expect(await ensureControlledServiceWorker(page)).toBe(true);

  const privateText = `PRIVATE-SHARE-TARGET-${runId()}`;
  let captureMutationRequests = 0;
  page.on('request', (request) => {
    if (
      /\/knowledge\/captures(?:\/|$)/u.test(new URL(request.url()).pathname)
    ) {
      captureMutationRequests += 1;
    }
  });

  const staged = await page.evaluate(async (text) => {
    const form = new FormData();
    form.set('title', 'Synthetic PWA share');
    form.set('text', `<script>globalThis.pwaCompromised=true</script>${text}`);
    form.set('url', 'https://example.invalid/synthetic');
    const response = await fetch('/share-target', {
      method: 'POST',
      body: form,
    });
    return {
      status: response.status,
      url: response.url,
      body: await response.text(),
    };
  }, privateText);

  expect(staged.status).toBe(200);
  const landingUrl = new URL(staged.url);
  const opaqueId = landingUrl.searchParams.get('shareTarget') || '';
  expect(landingUrl.pathname).toBe('/');
  expect([...landingUrl.searchParams.keys()]).toEqual(['shareTarget']);
  expect(opaqueId).toMatch(/^[a-f0-9]{32}$/u);
  expect(staged.url).not.toContain(privateText);
  expect(staged.body).not.toContain(privateText);
  expect(captureMutationRequests).toBe(0);

  await page.goto(staged.url);
  await expect(
    page.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: '選択テキスト' })).toHaveValue(
    `<script>globalThis.pwaCompromised=true</script>${privateText}`,
  );
  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { pwaCompromised?: boolean })
          .pwaCompromised,
    ),
  ).toBeUndefined();
  expect(captureMutationRequests).toBe(0);

  await page
    .getByRole('textbox', { name: '選択テキスト' })
    .fill('Sanitized synthetic selection for PWA verification.');
  await captureSection(
    page.locator('section[aria-labelledby="knowledge-capture-ingress-title"]'),
    '01-pwa-share-preview.png',
  );

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toBeVisible();
  expect(captureMutationRequests).toBe(0);

  const siblingPage = await page.context().newPage();
  await siblingPage.goto(staged.url);
  await expect(
    siblingPage.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toBeVisible();
  await expect(
    siblingPage.getByRole('textbox', { name: '選択テキスト' }),
  ).toHaveValue(
    `<script>globalThis.pwaCompromised=true</script>${privateText}`,
  );

  await page.getByRole('button', { name: '破棄', exact: true }).click();
  await expect(page).not.toHaveURL(/shareTarget=/u);
  await expect(siblingPage).not.toHaveURL(/shareTarget=/u);
  await expect(
    siblingPage.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toHaveCount(0);
  await expect(siblingPage.getByText(privateText)).toHaveCount(0);
  await siblingPage.close();
  const remaining = await page.evaluate(async (id) => {
    return new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('erp4-share-target-drafts', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction('drafts', 'readonly');
        const get = transaction.objectStore('drafts').get(id);
        get.onsuccess = () => resolve(get.result ? 1 : 0);
        get.onerror = () => reject(get.error);
        transaction.oncomplete = () => database.close();
      };
    });
  }, opaqueId);
  expect(remaining).toBe(0);
});

test('pwa Web Share Target rejects files, unknown fields, wrong media, and oversize input @pwa @extended', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await prepare(page);
  expect(await ensureControlledServiceWorker(page)).toBe(true);

  const results = await page.evaluate(async () => {
    const fileForm = new FormData();
    fileForm.set('text', new Blob(['synthetic']), 'capture.txt');
    const unknownForm = new FormData();
    unknownForm.set('provider', 'private-canary');
    const oversizeForm = new FormData();
    oversizeForm.set('text', 'a'.repeat(128 * 1024));
    const [file, unknown, wrongMedia, oversize] = await Promise.all([
      fetch('/share-target', { method: 'POST', body: fileForm }),
      fetch('/share-target', { method: 'POST', body: unknownForm }),
      fetch('/share-target', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      fetch('/share-target', { method: 'POST', body: oversizeForm }),
    ]);
    return Promise.all(
      [file, unknown, wrongMedia, oversize].map(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
    );
  });

  expect(results).toEqual([
    { status: 400, body: 'invalid_payload' },
    { status: 400, body: 'invalid_payload' },
    { status: 415, body: 'unsupported_media_type' },
    { status: 413, body: 'payload_too_large' },
  ]);
  expect(JSON.stringify(results)).not.toContain('private-canary');
});

test('pwa Web Share Target keeps an unauthenticated offline draft and resumes only after login @pwa @extended', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await prepare(page);
  expect(await ensureControlledServiceWorker(page)).toBe(true);
  const privateText = `PRIVATE-OFFLINE-DRAFT-${runId()}`;
  const landingUrl = await page.evaluate(async (text) => {
    const form = new FormData();
    form.set('text', text);
    const response = await fetch('/share-target', {
      method: 'POST',
      body: form,
    });
    return response.url;
  }, privateText);
  await page.evaluate(() => window.localStorage.removeItem('erp4_auth'));
  // `prepare()` installs authenticated state on every navigation of its page.
  // Use a fresh page so the unauthenticated resume path is not replaced by
  // the authenticated state that `prepare()` injects into its own page.
  const landingPage = await context.newPage();
  await landingPage.goto(landingUrl);

  await expect(
    landingPage.getByText(/ログイン後に内容を確認できます/),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(landingPage.getByText(/自動送信されません/)).toBeVisible();
  await expect(landingPage.getByText(privateText)).toHaveCount(0);
  await expect(
    landingPage.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toHaveCount(0);

  await context.setOffline(false);
  await landingPage.evaluate((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.dispatchEvent(new Event('erp4:auth-updated'));
  }, authState);
  await expect(
    landingPage.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toBeVisible();
  await expect(
    landingPage.getByRole('textbox', { name: '選択テキスト' }),
  ).toHaveValue(privateText);

  await landingPage.evaluate(() => {
    window.localStorage.removeItem('erp4_auth');
    window.dispatchEvent(new Event('erp4:auth-updated'));
  });
  await expect(
    landingPage.getByText(/ログイン後に内容を確認できます/),
  ).toBeVisible();
  await expect(landingPage.getByText(privateText)).toHaveCount(0);
  await expect(
    landingPage.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toHaveCount(0);

  await landingPage.evaluate((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.dispatchEvent(new Event('erp4:auth-updated'));
  }, authState);
  await expect(
    landingPage.getByRole('heading', { name: 'ブラウザー共有の確認' }),
  ).toBeVisible();
  await expect(
    landingPage.getByRole('textbox', { name: '選択テキスト' }),
  ).toHaveValue(privateText);
  await landingPage.getByRole('button', { name: '破棄', exact: true }).click();
  await expect(landingPage).not.toHaveURL(/shareTarget=/u);
});

test('pwa offline duplicate time entries @pwa @extended', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await prepare(page);
  const id = runId();
  const workTag = `E2E-DUP-${id}`;
  const locationTag = `offline-dup-${id}`;

  const timeSection = page
    .locator('main')
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await page.getByRole('button', { name: '工数入力', exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '工数入力', level: 2, exact: true }),
  ).toBeVisible();
  await timeSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    timeSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );

  await context.setOffline(true);

  await timeSection.locator('input[type="number"]').fill('75');
  await timeSection.getByLabel('作業種別').fill(workTag);
  await timeSection.getByLabel('場所').fill(locationTag);

  const addButton = timeSection.getByRole('button', { name: '追加' });
  await addButton.click();
  await expect(
    timeSection.getByText('オフラインのため送信待ちに保存しました'),
  ).toBeVisible();
  await timeSection.locator('input[type="number"]').fill('75');
  await timeSection.getByLabel('作業種別').fill(workTag);
  await timeSection.getByLabel('場所').fill(locationTag);
  await addButton.click();
  await expect(
    timeSection.getByText('オフラインのため送信待ちに保存しました'),
  ).toBeVisible();

  const currentSection = page.locator('.card', {
    has: page.locator('strong', { hasText: '現在のユーザー' }),
  });
  await currentSection.scrollIntoViewIfNeeded();
  const offlineQueueSection = currentSection
    .locator('strong', { hasText: 'オフライン送信キュー' })
    .locator('..');
  await offlineQueueSection.getByRole('button', { name: '再読込' }).click();
  await expect
    .poll(
      async () => {
        const statusText = await offlineQueueSection
          .getByText(/件数:/)
          .textContent();
        const match = statusText?.match(/件数:\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(2);

  await context.setOffline(false);

  const resendButton = offlineQueueSection.getByRole('button', {
    name: '再送',
  });
  if (await resendButton.isEnabled().catch(() => false)) {
    await resendButton.click();
  }
  await expect
    .poll(
      async () => {
        const statusText = await offlineQueueSection
          .getByText(/件数:/)
          .textContent();
        const match = statusText?.match(/件数:\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 10_000 },
    )
    .toBe(0);

  await page.reload();
  await page.getByRole('button', { name: '工数入力', exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '工数入力', level: 2, exact: true }),
  ).toBeVisible();
  const timeSectionReload = page
    .locator('main')
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSectionReload.scrollIntoViewIfNeeded();
  const dupItems = timeSectionReload.locator('.itdo-card', {
    hasText: workTag,
  });
  await expect(dupItems).toHaveCount(2);
  const normalizedTexts = (await dupItems.allTextContents()).map((text) =>
    text.replace(/\s+/g, ' ').trim(),
  );
  if (normalizedTexts.length === 2) {
    expect(normalizedTexts[0]).toBe(normalizedTexts[1]);
  }
  expect(normalizedTexts.join(' ')).toContain(workTag);
  expect(normalizedTexts.join(' ')).toContain(locationTag);
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
  await expect(
    pushSection.getByText(
      /テスト通知を(ローカル表示しました|Push配信しました)/,
    ),
  ).toBeVisible();

  await pushSection.getByRole('button', { name: '購読解除' }).click();
  await expect(pushSection.getByText('Push購読を解除しました')).toBeVisible();
  await expect(pushSection.getByText('Subscription: 未登録')).toBeVisible();
  await captureSection(pushSection, '18-push-unsubscribed.png');

  await pushSection.getByRole('button', { name: '購読登録' }).click();
  await expect(pushSection.getByText('Push購読を登録しました')).toBeVisible();
  await expect(pushSection.getByText('Subscription: 登録済み')).toBeVisible();
  await captureSection(pushSection, '19-push-resubscribed.png');
});

test('pwa sw push URL guard is present @pwa', async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  const swSource = await page.evaluate(async () => {
    const response = await fetch('/sw.js', { cache: 'no-store' });
    return response.text();
  });
  expect(swSource).toContain('normalizeNotificationPath');
  expect(swSource).toContain(
    'data: { url: normalizeNotificationPath(payload.url) }',
  );
  expect(swSource).toContain('self.clients.openWindow(target.toString())');
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

test('pwa service worker does not cache api responses @pwa @extended', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await prepare(page);

  const swReady = await ensureServiceWorker(page);
  if (!swReady) {
    test.skip(true, 'Service Worker が利用できないためスキップ');
  }

  const nonce = randomUUID();
  await page.route('**/api/cache-check*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'cache-control': 'no-store',
      },
      body: JSON.stringify({ ok: true, nonce }),
    });
  });

  const result = await page.evaluate(async (value) => {
    const res = await fetch(`/api/cache-check?nonce=${value}`);
    return res.json();
  }, nonce);
  expect(result.ok).toBe(true);

  const containsApiEntry = await page.evaluate(async () => {
    const cache = await caches.open('erp4-pwa-v2');
    const keys = await cache.keys();
    return keys.some((request) =>
      new URL(request.url).pathname.startsWith('/api/'),
    );
  });
  expect(containsApiEntry).toBe(false);
});
