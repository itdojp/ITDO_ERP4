import { randomUUID } from 'node:crypto';
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
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  // CI runners vary in performance; keep default timeout conservative.
  return process.env.CI ? 30_000 : 12_000;
})();

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
      // ignore capture failures to avoid blocking the test flow
    }
  }
}

async function prepare(page: Page, override?: Partial<typeof authState>) {
  const resolvedAuthState = { ...authState, ...(override ?? {}) };
  ensureEvidenceDir();
  page.on('pageerror', (error) => {
    console.error('[e2e][pageerror]', error);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][console.error]', msg.text());
    }
  });
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, resolvedAuthState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  // Use exact matching to avoid collisions like "承認" vs "承認依頼".
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function selectByLabelOrFirst(select: Locator, label?: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: actionTimeout })
    .toBeGreaterThan(1);
  if (label) {
    await expect
      .poll(() => select.locator('option', { hasText: label }).count(), {
        timeout: actionTimeout,
      })
      .toBeGreaterThan(0);
    await select.selectOption({ label });
    return;
  }
  await select.selectOption({ index: 1 });
}

const buildAuthHeaders = (override?: Partial<typeof authState>) => {
  const resolved = { ...authState, ...(override ?? {}) };
  return {
    'x-user-id': resolved.userId,
    'x-roles': resolved.roles.join(','),
    'x-project-ids': (resolved.projectIds ?? []).join(','),
    'x-group-ids': (resolved.groupIds ?? []).join(','),
  };
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

type VendorApprovalFixture = {
  projectId: string;
  vendorId: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
};

async function seedVendorApprovalFixture(
  page: Page,
): Promise<VendorApprovalFixture> {
  const suffix = runId();
  const projectId = authState.projectIds[0];
  const vendorRes = await page.request.post(`${apiBase}/vendors`, {
    headers: buildAuthHeaders(),
    data: {
      code: `E2E-VAP-${suffix}`,
      name: `E2E Vendor Approval ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(vendorRes);
  const vendorPayload = await vendorRes.json();
  const vendorId = String(vendorPayload?.id || '');
  expect(vendorId.length).toBeGreaterThan(0);

  const poRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/purchase-orders`,
    {
      headers: buildAuthHeaders(),
      data: {
        vendorId,
        totalAmount: 12000,
        currency: 'JPY',
      },
    },
  );
  await ensureOk(poRes);
  const poPayload = await poRes.json();
  const purchaseOrderId = String(poPayload?.id || '');
  const purchaseOrderNo = String(poPayload?.poNo || '');
  expect(purchaseOrderId.length).toBeGreaterThan(0);
  expect(purchaseOrderNo.length).toBeGreaterThan(0);

  const quoteRes = await page.request.post(`${apiBase}/vendor-quotes`, {
    headers: buildAuthHeaders(),
    data: {
      projectId,
      vendorId,
      totalAmount: 12000,
      currency: 'JPY',
      quoteNo: `VQ-${suffix}`,
    },
  });
  await ensureOk(quoteRes);

  const invoiceRes = await page.request.post(`${apiBase}/vendor-invoices`, {
    headers: buildAuthHeaders(),
    data: {
      projectId,
      vendorId,
      totalAmount: 12000,
      currency: 'JPY',
      vendorInvoiceNo: `VI-${suffix}`,
    },
  });
  await ensureOk(invoiceRes);

  return {
    projectId,
    vendorId,
    purchaseOrderId,
    purchaseOrderNo,
  };
}

test('frontend smoke vendor approvals @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);
  const fixture = await seedVendorApprovalFixture(page);

  await navigateToSection(page, '仕入/発注');
  const vendorSection = page
    .locator('main')
    .locator('h2', { hasText: '仕入/発注' })
    .locator('..');
  await vendorSection.scrollIntoViewIfNeeded();

  const poBlock = vendorSection
    .locator('h3', { hasText: '発注書' })
    .locator('..');
  await poBlock.getByRole('button', { name: /再取得|再読込/ }).click();
  const poRow = poBlock.locator('tbody tr', { hasText: fixture.purchaseOrderNo });
  await expect(poRow).toHaveCount(1, { timeout: actionTimeout });
  await expect(poRow).toBeVisible({ timeout: actionTimeout });
  const poSubmitButton = poRow.getByRole('button', { name: '承認依頼' });
  await expect(poSubmitButton).toBeVisible({ timeout: actionTimeout });
  await expect(poSubmitButton).toBeEnabled({ timeout: actionTimeout });
  await poSubmitButton.click();
  await expect(page.getByText('発注書を承認依頼しますか？')).toBeVisible({
    timeout: actionTimeout,
  });
  await page.getByRole('button', { name: '実行' }).click();
  await expect(page.getByText('発注書を承認依頼しますか？')).toBeHidden({
    timeout: actionTimeout,
  });

  await captureSection(vendorSection, '06-vendor-docs.png');

  await navigateToSection(page, '承認', '承認一覧');
  const approvalsSection = page
    .locator('main')
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  const flowTypeSelect = approvalsSection.locator('select', {
    has: approvalsSection.locator('option', { hasText: '発注' }),
  });
  await selectByLabelOrFirst(
    flowTypeSelect,
    '発注',
  );
  await approvalsSection.getByRole('button', { name: '再読込' }).click();
  const approvalItem = approvalsSection.locator('li', {
    hasText: `purchase_orders:${fixture.purchaseOrderId}`,
  });
  await expect(approvalItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(approvalItem).toBeVisible({ timeout: actionTimeout });
  const approveButton = approvalItem.getByRole('button', { name: '承認' });
  await expect(approveButton).toBeVisible({ timeout: actionTimeout });
  await expect(approveButton).toBeEnabled({ timeout: actionTimeout });
  await approveButton.click();
  await expect(approvalsSection.getByText('承認しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(approvalsSection, '07-approvals.png');
});
