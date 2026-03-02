import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return process.env.CI ? 30_000 : 12_000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
};

const authHeaders = {
  'x-user-id': authState.userId,
  'x-roles': authState.roles.join(','),
  'x-project-ids': authState.projectIds.join(','),
  'x-group-ids': authState.groupIds.join(','),
};

type SubmitErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function prepare(page: Page) {
  page.on('pageerror', (error) => {
    console.error('[leave-submit-validation] pageerror:', error);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[leave-submit-validation] console.error:', msg.text());
    }
  });

  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);

  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible({
    timeout: actionTimeout,
  });
}

async function openLeaveSection(page: Page) {
  await page.getByRole('button', { name: '休暇申請', exact: true }).click();
  const leaveSection = page
    .locator('main')
    .locator('h2', { hasText: '休暇' })
    .locator('..');
  await expect(
    leaveSection.getByRole('heading', { name: '休暇', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
  return leaveSection;
}

async function createLeaveType(
  request: APIRequestContext,
  options: {
    code: string;
    name: string;
    submitLeadDays: number;
    allowRetroactiveSubmit: boolean;
  },
) {
  const res = await request.post(`${apiBase}/leave-types`, {
    headers: authHeaders,
    data: {
      code: options.code,
      name: options.name,
      isPaid: true,
      unit: 'daily',
      requiresApproval: true,
      attachmentPolicy: 'none',
      submitLeadDays: options.submitLeadDays,
      allowRetroactiveSubmit: options.allowRetroactiveSubmit,
      active: true,
    },
  });
  await ensureOk(res);
}

async function setLeaveType(leaveSection: Locator, leaveTypeCode: string) {
  const selectControl = leaveSection.locator('select[aria-label="休暇種別"]');
  if ((await selectControl.count()) > 0) {
    await expect(selectControl).toBeVisible({ timeout: actionTimeout });
    await expect
      .poll(
        () =>
          selectControl.locator(`option[value="${leaveTypeCode}"]`).count(),
        {
          timeout: actionTimeout,
        },
      )
      .toBeGreaterThan(0);
    await selectControl.selectOption({ value: leaveTypeCode });
    return;
  }
  const textControl = leaveSection.locator('input[aria-label="休暇種別"]');
  await expect(textControl).toBeVisible({ timeout: actionTimeout });
  await textControl.fill(leaveTypeCode);
}

async function createLeaveDraft(leaveSection: Locator, options: {
  leaveTypeCode: string;
  leaveTypeLabel: string;
  date: string;
  notes: string;
}) {
  await setLeaveType(leaveSection, options.leaveTypeCode);
  await leaveSection.getByLabel('休暇開始日').fill(options.date);
  await leaveSection.getByLabel('休暇終了日').fill(options.date);
  await leaveSection.getByLabel('備考(任意)').fill(options.notes);
  await leaveSection.getByRole('button', { name: /^作成$/ }).click();

  const sectionMessage = leaveSection.locator(':scope > p').first();
  await expect(sectionMessage).toHaveText('作成しました', {
    timeout: actionTimeout,
  });

  const row = leaveSection
    .locator('li', {
      hasText: `${options.leaveTypeLabel} / ${options.date}〜${options.date}`,
    })
    .first();
  await expect(row).toContainText('draft', { timeout: actionTimeout });
  return row;
}

async function setNoConsultationReason(row: Locator, reasonText: string) {
  await row.getByRole('button', { name: '詳細', exact: true }).click();
  const reasonInput = row.getByLabel('相談無しの理由');
  await expect(reasonInput).toBeVisible({ timeout: actionTimeout });
  await row.getByRole('checkbox').first().check();
  await reasonInput.fill(reasonText);
}

async function submitAndReadError(page: Page, row: Locator) {
  const submitResPromise = page.waitForResponse(
    (res) => {
      if (res.request().method() !== 'POST') return false;
      try {
        const path = new URL(res.url()).pathname;
        return /^\/leave-requests\/[^/]+\/submit$/.test(path);
      } catch {
        return false;
      }
    },
    { timeout: actionTimeout },
  );

  await row.getByRole('button', { name: '申請', exact: true }).click();
  const submitRes = await submitResPromise;
  const payload = (await submitRes.json().catch(() => ({}))) as SubmitErrorPayload;
  return {
    status: submitRes.status(),
    payload,
  };
}

test('frontend leave submit validation for lead/retroactive/time conflict @core', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  const suffix = runId();
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const conflictDate = new Date(now);
  conflictDate.setDate(now.getDate() + 5);

  const leadRetroTypeCode =
    `e2e_leave_window_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`.toLowerCase();
  const conflictTypeCode =
    `e2e_leave_conflict_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`.toLowerCase();
  const leadRetroTypeLabel = `E2E Leave Window ${suffix} (${leadRetroTypeCode})`;
  const conflictTypeLabel = `E2E Leave Conflict ${suffix} (${conflictTypeCode})`;

  await createLeaveType(request, {
    code: leadRetroTypeCode,
    name: `E2E Leave Window ${suffix}`,
    submitLeadDays: 3,
    allowRetroactiveSubmit: false,
  });
  await createLeaveType(request, {
    code: conflictTypeCode,
    name: `E2E Leave Conflict ${suffix}`,
    submitLeadDays: 0,
    allowRetroactiveSubmit: true,
  });

  const projectRes = await request.post(`${apiBase}/projects`, {
    headers: authHeaders,
    data: {
      code: `E2E-LCF-${suffix}`.slice(0, 30),
      name: `E2E Leave Conflict ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(projectRes);
  const project = (await projectRes.json()) as { id?: string };
  const projectId = String(project?.id || '');
  expect(projectId.length).toBeGreaterThan(0);

  const timeEntryRes = await request.post(`${apiBase}/time-entries`, {
    headers: authHeaders,
    data: {
      projectId,
      userId: authState.userId,
      workDate: toDateInput(conflictDate),
      minutes: 120,
    },
  });
  await ensureOk(timeEntryRes);

  await prepare(page);
  const leaveSection = await openLeaveSection(page);
  const sectionMessage = leaveSection.locator(':scope > p').first();

  const leadDraftRow = await createLeaveDraft(leaveSection, {
    leaveTypeCode: leadRetroTypeCode,
    leaveTypeLabel: leadRetroTypeLabel,
    date: toDateInput(tomorrow),
    notes: `lead-days-${suffix}`,
  });
  await setNoConsultationReason(leadDraftRow, `lead-days-${suffix}`);
  const leadSubmit = await submitAndReadError(page, leadDraftRow);
  expect(leadSubmit.status).toBe(400);
  expect(leadSubmit.payload.error?.code).toBe('LEAVE_SUBMIT_LEAD_DAYS_REQUIRED');
  await expect(sectionMessage).toContainText(/申請に失敗しました|lead/i, {
    timeout: actionTimeout,
  });

  const retroDraftRow = await createLeaveDraft(leaveSection, {
    leaveTypeCode: leadRetroTypeCode,
    leaveTypeLabel: leadRetroTypeLabel,
    date: toDateInput(yesterday),
    notes: `retroactive-${suffix}`,
  });
  await setNoConsultationReason(retroDraftRow, `retroactive-${suffix}`);
  const retroSubmit = await submitAndReadError(page, retroDraftRow);
  expect(retroSubmit.status).toBe(400);
  expect(retroSubmit.payload.error?.code).toBe(
    'LEAVE_RETROACTIVE_SUBMIT_FORBIDDEN',
  );
  await expect(sectionMessage).toContainText(/申請に失敗しました|retroactive/i, {
    timeout: actionTimeout,
  });

  const conflictDraftRow = await createLeaveDraft(leaveSection, {
    leaveTypeCode: conflictTypeCode,
    leaveTypeLabel: conflictTypeLabel,
    date: toDateInput(conflictDate),
    notes: `time-conflict-${suffix}`,
  });
  await setNoConsultationReason(conflictDraftRow, `time-conflict-${suffix}`);
  const conflictSubmit = await submitAndReadError(page, conflictDraftRow);
  expect(conflictSubmit.status).toBe(409);
  expect(conflictSubmit.payload.error?.code).toBe('TIME_ENTRY_CONFLICT');
  await expect(
    leaveSection
      .getByText(/工数の重複|休暇期間に工数が存在します/, { exact: false })
      .first(),
  ).toBeVisible({ timeout: actionTimeout });
});
