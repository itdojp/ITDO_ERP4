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

test('frontend smoke approval ack link lifecycle @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = runId();
  const projectId = authState.projectIds[0];
  const ackTargetUserId = 'e2e-member-1@example.com';
  await prepare(page);

  const memberRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
    {
      headers: buildAuthHeaders(),
      data: { userId: ackTargetUserId, role: 'member' },
    },
  );
  if (!memberRes.ok() && memberRes.status() !== 409) {
    throw new Error(
      `Failed to ensure project member: status=${memberRes.status()}`,
    );
  }

  const ackRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-ack-requests`,
    {
      headers: buildAuthHeaders(),
      data: {
        body: `E2E approval ack link ${id}`,
        requiredUserIds: [ackTargetUserId],
        tags: ['e2e', 'ack', 'approval-link'],
      },
    },
  );
  await ensureOk(ackRes);
  const ackPayload = (await ackRes.json()) as {
    id?: string;
    messageId?: string;
    ackRequest?: { id?: string };
  };
  const ackMessageId =
    typeof ackPayload.id === 'string'
      ? ackPayload.id
      : typeof ackPayload.messageId === 'string'
        ? ackPayload.messageId
        : '';
  expect(ackMessageId).toBeTruthy();
  expect(typeof ackPayload.ackRequest?.id).toBe('string');

  const estimateCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      headers: buildAuthHeaders(),
      data: {
        totalAmount: 130000,
        currency: 'JPY',
        notes: `E2E approval ack link estimate ${id}`,
      },
    },
  );
  await ensureOk(estimateCreateRes);
  const estimateCreatePayload = (await estimateCreateRes.json()) as {
    estimate?: { id?: string };
  };
  const estimateId = estimateCreatePayload.estimate?.id || '';
  expect(estimateId).toBeTruthy();

  const estimateSubmitRes = await page.request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/submit`,
    {
      headers: buildAuthHeaders(),
      data: { reasonText: 'e2e approval ack link lifecycle' },
    },
  );
  await ensureOk(estimateSubmitRes);

  await navigateToSection(page, '承認', '承認一覧');
  const approvalsSection = page
    .locator('main')
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  const flowTypeSelect = approvalsSection.locator('select', {
    has: approvalsSection.locator('option', { hasText: '見積' }),
  });
  await selectByLabelOrFirst(
    flowTypeSelect,
    '見積',
  );
  await approvalsSection.getByRole('button', { name: '再読込' }).click();

  const approvalItem = approvalsSection.locator('li', { hasText: estimateId });
  await expect(approvalItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(approvalItem).toBeVisible({ timeout: actionTimeout });

  const ackInput = approvalItem.getByPlaceholder(
    '発言URL / Markdown / messageId',
  );
  await expect(ackInput).toBeVisible({ timeout: actionTimeout });
  await approvalItem.getByRole('button', { name: '更新' }).click();
  await ackInput.fill(ackMessageId);
  await approvalItem.getByRole('button', { name: '追加' }).click();
  await expect(approvalItem.getByText(ackMessageId)).toBeVisible({
    timeout: actionTimeout,
  });

  page.once('dialog', (dialog) => dialog.accept().catch(() => undefined));
  await approvalItem.getByRole('button', { name: '削除' }).click();
  await expect(
    approvalItem.getByText('登録済みリンクはありません'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await captureSection(approvalsSection, '07-approvals-ack-link-lifecycle.png');
});
