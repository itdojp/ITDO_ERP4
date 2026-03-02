import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};
const gaHeaders = {
  ...authHeaders,
  'x-group-account-ids': 'general_affairs',
};

function userHeaders(options: {
  userId: string;
  roles?: string;
  projectIds?: string;
  groupAccountIds?: string;
}) {
  return {
    'x-user-id': options.userId,
    'x-roles': options.roles ?? 'user',
    ...(options.projectIds ? { 'x-project-ids': options.projectIds } : {}),
    ...(options.groupAccountIds
      ? { 'x-group-account-ids': options.groupAccountIds }
      : {}),
  };
}

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function withLeaveSetting(
  request: Parameters<typeof test>[0]['request'],
  desired: { timeUnitMinutes: number; defaultWorkdayMinutes: number },
  run: () => Promise<void>,
) {
  const currentLeaveSettingRes = await request.get(
    `${apiBase}/leave-settings`,
    {
      headers: authHeaders,
    },
  );
  await ensureOk(currentLeaveSettingRes);
  const previousLeaveSettings = (await currentLeaveSettingRes.json()) as {
    timeUnitMinutes?: number;
    defaultWorkdayMinutes?: number;
  };
  try {
    const leaveSettingRes = await request.patch(`${apiBase}/leave-settings`, {
      data: desired,
      headers: authHeaders,
    });
    await ensureOk(leaveSettingRes);
    await run();
  } finally {
    const restoreLeaveSettingRes = await request.patch(
      `${apiBase}/leave-settings`,
      {
        data: {
          timeUnitMinutes: previousLeaveSettings.timeUnitMinutes,
          defaultWorkdayMinutes: previousLeaveSettings.defaultWorkdayMinutes,
        },
        headers: authHeaders,
      },
    );
    await ensureOk(restoreLeaveSettingRes);
  }
}

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

test('leave submit blocks when time entries exist @core', async ({
  request,
}) => {
  const suffix = runId();
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-LEAVE-${suffix}`,
      name: `E2E Leave ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const todayStr = toDateInput(today);
  const tomorrowStr = toDateInput(tomorrow);

  const timeRes = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: project.id,
      userId: 'demo-user',
      workDate: todayStr,
      minutes: 60,
    },
    headers: authHeaders,
  });
  await ensureOk(timeRes);

  const leaveConflictRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: 'demo-user',
      leaveType: 'paid',
      startDate: todayStr,
      endDate: todayStr,
      hours: 8,
      notes: `conflict-${suffix}`,
    },
    headers: authHeaders,
  });
  await ensureOk(leaveConflictRes);
  const leaveConflict = await leaveConflictRes.json();

  const submitConflictRes = await request.post(
    `${apiBase}/leave-requests/${leaveConflict.id}/submit`,
    { data: {}, headers: authHeaders },
  );
  expect(submitConflictRes.status()).toBe(409);
  const submitConflictJson = await submitConflictRes.json();
  expect(submitConflictJson?.error?.code).toBe('TIME_ENTRY_CONFLICT');
  expect(submitConflictJson?.error?.conflictCount).toBeGreaterThan(0);

  const leaveOkRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: 'demo-user',
      leaveType: 'paid',
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `ok-${suffix}`,
    },
    headers: authHeaders,
  });
  await ensureOk(leaveOkRes);
  const leaveOk = await leaveOkRes.json();

  const submitOkRes = await request.post(
    `${apiBase}/leave-requests/${leaveOk.id}/submit`,
    {
      data: {
        noConsultationConfirmed: true,
        noConsultationReason: `e2e-${suffix}`,
      },
      headers: authHeaders,
    },
  );
  await ensureOk(submitOkRes);
  const submitted = await submitOkRes.json();
  expect(submitted.status).toBe('pending_manager');
});

test('leave submit requires consultation reason when no evidence @core', async ({
  request,
}) => {
  const suffix = runId();
  const targetUserId = `leave-no-evidence-${suffix}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateInput(tomorrow);
  const targetHeaders = userHeaders({ userId: targetUserId });

  const leaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: targetUserId,
      leaveType: 'paid',
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `no-evidence-${suffix}`,
    },
    headers: targetHeaders,
  });
  await ensureOk(leaveRes);
  const leave = await leaveRes.json();

  const submitMissingRes = await request.post(
    `${apiBase}/leave-requests/${leave.id}/submit`,
    { data: {}, headers: targetHeaders },
  );
  expect(submitMissingRes.status()).toBe(400);
  const submitMissingJson = await submitMissingRes.json();
  expect(submitMissingJson?.error?.code).toBe(
    'NO_CONSULTATION_REASON_REQUIRED',
  );

  const submitOkRes = await request.post(
    `${apiBase}/leave-requests/${leave.id}/submit`,
    {
      data: {
        noConsultationConfirmed: true,
        noConsultationReason: `e2e-${suffix}`,
      },
      headers: targetHeaders,
    },
  );
  await ensureOk(submitOkRes);
  const submitted = await submitOkRes.json();
  expect(submitted.status).toBe('pending_manager');
});

test('leave submit allows when chat evidence is attached @core', async ({
  request,
}) => {
  const suffix = runId();
  const targetUserId = `leave-evidence-${suffix}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateInput(tomorrow);
  const targetHeaders = userHeaders({ userId: targetUserId });

  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-LEAVE-EVID-${suffix}`,
      name: `E2E Leave Evidence ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const messageRes = await request.post(
    `${apiBase}/projects/${project.id}/chat-messages`,
    {
      data: { body: `consult-${suffix}` },
      headers: authHeaders,
    },
  );
  await ensureOk(messageRes);
  const message = await messageRes.json();

  const leaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: targetUserId,
      leaveType: 'paid',
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `with-evidence-${suffix}`,
    },
    headers: targetHeaders,
  });
  await ensureOk(leaveRes);
  const leave = await leaveRes.json();

  const annotationRes = await request.patch(
    `${apiBase}/annotations/leave_request/${leave.id}`,
    {
      data: {
        internalRefs: [{ kind: 'chat_message', id: message.id }],
      },
      headers: authHeaders,
    },
  );
  await ensureOk(annotationRes);

  const submitOkRes = await request.post(
    `${apiBase}/leave-requests/${leave.id}/submit`,
    { data: {}, headers: targetHeaders },
  );
  await ensureOk(submitOkRes);
  const submitted = await submitOkRes.json();
  expect(submitted.status).toBe('pending_manager');
});

test('hourly leave create validates time unit and stores minutes @core', async ({
  request,
}) => {
  const suffix = runId();
  const target = new Date();
  target.setDate(target.getDate() + 1);
  const targetDate = toDateInput(target);

  await withLeaveSetting(
    request,
    { timeUnitMinutes: 10, defaultWorkdayMinutes: 480 },
    async () => {
      const invalidUnitRes = await request.post(`${apiBase}/leave-requests`, {
        data: {
          userId: 'demo-user',
          leaveType: 'paid',
          startDate: targetDate,
          endDate: targetDate,
          startTime: '09:05',
          endTime: '10:00',
          notes: `hourly-invalid-${suffix}`,
        },
        headers: authHeaders,
      });
      expect(invalidUnitRes.status()).toBe(400);
      const invalidUnitJson = await invalidUnitRes.json();
      expect(invalidUnitJson?.error?.code).toBe('INVALID_TIME_UNIT');

      const leaveRes = await request.post(`${apiBase}/leave-requests`, {
        data: {
          userId: 'demo-user',
          leaveType: 'paid',
          startDate: targetDate,
          endDate: targetDate,
          startTime: '09:00',
          endTime: '10:30',
          notes: `hourly-ok-${suffix}`,
        },
        headers: authHeaders,
      });
      await ensureOk(leaveRes);
      const leave = await leaveRes.json();
      expect(leave.minutes).toBe(90);
      expect(leave.startTimeMinutes).toBe(9 * 60);
      expect(leave.endTimeMinutes).toBe(10 * 60 + 30);
      expect(leave.hours).toBeNull();
    },
  );
});

test('hourly leave submit blocks when day total exceeds defaultWorkdayMinutes @core', async ({
  request,
}) => {
  const suffix = runId();
  const target = new Date();
  target.setDate(target.getDate() + 1);
  const targetDate = toDateInput(target);

  await withLeaveSetting(
    request,
    { timeUnitMinutes: 10, defaultWorkdayMinutes: 480 },
    async () => {
      const projectRes = await request.post(`${apiBase}/projects`, {
        data: {
          code: `E2E-LEAVE-OVER-${suffix}`,
          name: `E2E Leave Overbooked ${suffix}`,
          status: 'active',
        },
        headers: authHeaders,
      });
      await ensureOk(projectRes);
      const project = await projectRes.json();

      const timeRes = await request.post(`${apiBase}/time-entries`, {
        data: {
          projectId: project.id,
          userId: 'demo-user',
          workDate: targetDate,
          minutes: 450,
        },
        headers: authHeaders,
      });
      await ensureOk(timeRes);

      const leaveRes = await request.post(`${apiBase}/leave-requests`, {
        data: {
          userId: 'demo-user',
          leaveType: 'paid',
          startDate: targetDate,
          endDate: targetDate,
          startTime: '16:00',
          endTime: '17:00',
          notes: `hourly-over-${suffix}`,
        },
        headers: authHeaders,
      });
      await ensureOk(leaveRes);
      const leave = await leaveRes.json();

      const submitRes = await request.post(
        `${apiBase}/leave-requests/${leave.id}/submit`,
        {
          data: {
            noConsultationConfirmed: true,
            noConsultationReason: `overbooked-${suffix}`,
          },
          headers: authHeaders,
        },
      );
      expect(submitRes.status()).toBe(409);
      const submitJson = await submitRes.json();
      expect(submitJson?.error?.code).toBe('TIME_ENTRY_OVERBOOKED');
      expect(submitJson?.error?.existingMinutes).toBe(450);
      expect(submitJson?.error?.requestedLeaveMinutes).toBe(60);
      expect(submitJson?.error?.totalMinutes).toBe(510);
      expect(submitJson?.error?.defaultWorkdayMinutes).toBe(480);
    },
  );
});

test('hourly leave submit uses per-user workday override for overbook check @core', async ({
  request,
}) => {
  const suffix = runId();
  const targetUserId = `leave-override-${suffix}`;
  const target = new Date();
  target.setDate(target.getDate() + 1);
  const targetDate = toDateInput(target);

  await withLeaveSetting(
    request,
    { timeUnitMinutes: 10, defaultWorkdayMinutes: 480 },
    async () => {
      const projectRes = await request.post(`${apiBase}/projects`, {
        data: {
          code: `E2E-LEAVE-OVR-${suffix}`,
          name: `E2E Leave Override ${suffix}`,
          status: 'active',
        },
        headers: authHeaders,
      });
      await ensureOk(projectRes);
      const project = await projectRes.json();

      const timeRes = await request.post(`${apiBase}/time-entries`, {
        data: {
          projectId: project.id,
          userId: targetUserId,
          workDate: targetDate,
          minutes: 250,
        },
        headers: authHeaders,
      });
      await ensureOk(timeRes);

      const overrideRes = await request.post(
        `${apiBase}/leave-calendar/workday-overrides`,
        {
          data: {
            userId: targetUserId,
            workDate: targetDate,
            workMinutes: 360,
            reasonText: `override-${suffix}`,
          },
          headers: authHeaders,
        },
      );
      await ensureOk(overrideRes);
      const override = await overrideRes.json();

      try {
        const leaveRes = await request.post(`${apiBase}/leave-requests`, {
          data: {
            userId: targetUserId,
            leaveType: 'paid',
            startDate: targetDate,
            endDate: targetDate,
            startTime: '14:00',
            endTime: '16:00',
            notes: `hourly-override-${suffix}`,
          },
          headers: authHeaders,
        });
        await ensureOk(leaveRes);
        const leave = await leaveRes.json();

        const submitRes = await request.post(
          `${apiBase}/leave-requests/${leave.id}/submit`,
          {
            data: {
              noConsultationConfirmed: true,
              noConsultationReason: `overbooked-override-${suffix}`,
            },
            headers: authHeaders,
          },
        );
        expect(submitRes.status()).toBe(409);
        const submitJson = await submitRes.json();
        expect(submitJson?.error?.code).toBe('TIME_ENTRY_OVERBOOKED');
        expect(submitJson?.error?.existingMinutes).toBe(250);
        expect(submitJson?.error?.requestedLeaveMinutes).toBe(120);
        expect(submitJson?.error?.totalMinutes).toBe(370);
        expect(submitJson?.error?.defaultWorkdayMinutes).toBe(360);
        expect(submitJson?.error?.workdayMinutes).toBe(360);
        expect(submitJson?.error?.workdayMinutesSource).toBe('user_override');
      } finally {
        const deleteOverrideRes = await request.delete(
          `${apiBase}/leave-calendar/workday-overrides/${encodeURIComponent(
            String(override.id),
          )}`,
          {
            headers: authHeaders,
          },
        );
        await ensureOk(deleteOverrideRes);
      }
    },
  );
});

test('project leader can view submitted leave list without reasons @core', async ({
  request,
}) => {
  const suffix = runId();
  const leaderUserId = `leader-${suffix}`;
  const memberUserId = `member-${suffix}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateInput(tomorrow);

  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-LEAVE-LEADER-${suffix}`,
      name: `E2E Leave Leader ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const addLeaderRes = await request.post(
    `${apiBase}/projects/${project.id}/members`,
    {
      data: { userId: leaderUserId, role: 'leader' },
      headers: authHeaders,
    },
  );
  await ensureOk(addLeaderRes);

  const addMemberRes = await request.post(
    `${apiBase}/projects/${project.id}/members`,
    {
      data: { userId: memberUserId, role: 'member' },
      headers: authHeaders,
    },
  );
  await ensureOk(addMemberRes);

  const leaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: memberUserId,
      leaveType: 'paid',
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `leader-visible-${suffix}`,
    },
    headers: userHeaders({ userId: memberUserId, projectIds: project.id }),
  });
  await ensureOk(leaveRes);
  const leave = await leaveRes.json();

  const submitRes = await request.post(
    `${apiBase}/leave-requests/${leave.id}/submit`,
    {
      data: {
        noConsultationConfirmed: true,
        noConsultationReason: `no-consult-${suffix}`,
      },
      headers: userHeaders({ userId: memberUserId, projectIds: project.id }),
    },
  );
  await ensureOk(submitRes);

  const leaderListRes = await request.get(
    `${apiBase}/leave-requests/leader?userId=${encodeURIComponent(memberUserId)}`,
    {
      headers: userHeaders({ userId: leaderUserId, projectIds: project.id }),
    },
  );
  await ensureOk(leaderListRes);
  const leaderListJson = (await leaderListRes.json()) as {
    items?: Array<{
      id: string;
      status: string;
      notes?: string;
      noConsultationReason?: string;
      visibleProjectIds?: string[];
    }>;
  };
  const target = (leaderListJson.items || []).find(
    (item) => item.id === leave.id,
  );
  expect(target).toBeTruthy();
  expect(target?.status).toBe('pending_manager');
  expect(target?.notes).toBeUndefined();
  expect(target?.noConsultationReason).toBeUndefined();
  expect(target?.visibleProjectIds).toContain(project.id);

  const nonLeaderListRes = await request.get(
    `${apiBase}/leave-requests/leader`,
    {
      headers: userHeaders({ userId: memberUserId, projectIds: project.id }),
    },
  );
  expect(nonLeaderListRes.status()).toBe(403);
});

test('paid leave entitlement APIs enforce GA group and submit returns shortage warning @core', async ({
  request,
}) => {
  const suffix = runId();
  const targetUserId = `leave-user-${suffix}`;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day2 = new Date(tomorrow);
  day2.setDate(day2.getDate() + 1);
  const baseDate = toDateInput(
    new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
  );
  const nextGrantDueDate = toDateInput(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30),
  );

  const forbiddenGrantRes = await request.post(
    `${apiBase}/leave-entitlements/grants`,
    {
      data: {
        userId: targetUserId,
        grantedMinutes: 480,
        reasonText: `forbidden-${suffix}`,
      },
      headers: authHeaders,
    },
  );
  expect(forbiddenGrantRes.status()).toBe(403);
  const forbiddenGrantJson = await forbiddenGrantRes.json();
  expect(forbiddenGrantJson?.error?.code).toBe('GENERAL_AFFAIRS_REQUIRED');

  const profileRes = await request.post(
    `${apiBase}/leave-entitlements/profiles`,
    {
      data: {
        userId: targetUserId,
        paidLeaveBaseDate: baseDate,
        nextGrantDueDate,
      },
      headers: gaHeaders,
    },
  );
  await ensureOk(profileRes);

  const grantRes = await request.post(`${apiBase}/leave-entitlements/grants`, {
    data: {
      userId: targetUserId,
      grantedMinutes: 480,
      grantDate: baseDate,
      reasonText: `grant-${suffix}`,
    },
    headers: gaHeaders,
  });
  await ensureOk(grantRes);

  const firstLeaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: targetUserId,
      leaveType: 'paid',
      startDate: toDateInput(tomorrow),
      endDate: toDateInput(tomorrow),
      hours: 8,
      notes: `first-${suffix}`,
    },
    headers: userHeaders({ userId: targetUserId }),
  });
  await ensureOk(firstLeaveRes);
  const firstLeave = await firstLeaveRes.json();
  const firstSubmitRes = await request.post(
    `${apiBase}/leave-requests/${firstLeave.id}/submit`,
    {
      data: {
        noConsultationConfirmed: true,
        noConsultationReason: `first-${suffix}`,
      },
      headers: userHeaders({ userId: targetUserId }),
    },
  );
  await ensureOk(firstSubmitRes);

  const secondLeaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: targetUserId,
      leaveType: 'paid',
      startDate: toDateInput(day2),
      endDate: toDateInput(day2),
      hours: 4,
      notes: `second-${suffix}`,
    },
    headers: userHeaders({ userId: targetUserId }),
  });
  await ensureOk(secondLeaveRes);
  const secondLeave = await secondLeaveRes.json();
  const secondSubmitRes = await request.post(
    `${apiBase}/leave-requests/${secondLeave.id}/submit`,
    {
      data: {
        noConsultationConfirmed: true,
        noConsultationReason: `second-${suffix}`,
      },
      headers: userHeaders({ userId: targetUserId }),
    },
  );
  await ensureOk(secondSubmitRes);
  const secondSubmit = await secondSubmitRes.json();
  expect(secondSubmit.status).toBe('pending_manager');
  expect(secondSubmit.shortageWarning?.code).toBe('PAID_LEAVE_ADVANCE_WARNING');
  expect(secondSubmit.shortageWarning?.shortageMinutes).toBe(240);
  expect(secondSubmit.paidLeaveBalance?.remainingMinutes).toBe(0);
  expect(secondSubmit.paidLeaveBalance?.projectedRemainingMinutes).toBe(-240);
});

test('hr leave report APIs expose upper-bound semantics and enforce date range guard @core', async ({
  request,
}) => {
  const suffix = runId();
  const targetUserId = `leave-hr-${suffix}`;
  const baseDate = '2098-01-01';
  const grantDate = '2098-12-31';
  const expiresAt = '2099-01-10';
  const expiresAtBoundary = '2099-01-31';
  const expiresAtOutside = '2099-02-01';

  const profileRes = await request.post(
    `${apiBase}/leave-entitlements/profiles`,
    {
      data: {
        userId: targetUserId,
        paidLeaveBaseDate: baseDate,
      },
      headers: gaHeaders,
    },
  );
  await ensureOk(profileRes);

  const paidGrantRes = await request.post(
    `${apiBase}/leave-entitlements/grants`,
    {
      data: {
        userId: targetUserId,
        grantedMinutes: 480,
        grantDate,
        expiresAt,
        reasonText: `hr-paid-${suffix}`,
      },
      headers: gaHeaders,
    },
  );
  await ensureOk(paidGrantRes);

  const paidGrantBoundaryRes = await request.post(
    `${apiBase}/leave-entitlements/grants`,
    {
      data: {
        userId: targetUserId,
        grantedMinutes: 60,
        grantDate,
        expiresAt: expiresAtBoundary,
        reasonText: `hr-paid-boundary-${suffix}`,
      },
      headers: gaHeaders,
    },
  );
  await ensureOk(paidGrantBoundaryRes);

  const paidGrantOutsideRes = await request.post(
    `${apiBase}/leave-entitlements/grants`,
    {
      data: {
        userId: targetUserId,
        grantedMinutes: 30,
        grantDate,
        expiresAt: expiresAtOutside,
        reasonText: `hr-paid-outside-${suffix}`,
      },
      headers: gaHeaders,
    },
  );
  await ensureOk(paidGrantOutsideRes);

  const compGrantRes = await request.post(
    `${apiBase}/leave-entitlements/comp-grants`,
    {
      data: {
        userId: targetUserId,
        leaveType: 'compensatory',
        sourceDate: '2098-12-20',
        grantDate: '2098-12-20',
        expiresAt,
        grantedMinutes: 120,
        reasonText: `hr-comp-${suffix}`,
      },
      headers: gaHeaders,
    },
  );
  await ensureOk(compGrantRes);

  const forbiddenSummaryRes = await request.get(
    `${apiBase}/leave-entitlements/hr-summary?asOfDate=2099-01-01&expiringWithinDays=30`,
    { headers: authHeaders },
  );
  expect(forbiddenSummaryRes.status()).toBe(403);
  const forbiddenSummaryBody = await forbiddenSummaryRes.json();
  expect(forbiddenSummaryBody?.error?.code).toBe('GENERAL_AFFAIRS_REQUIRED');

  const summaryRes = await request.get(
    `${apiBase}/leave-entitlements/hr-summary?asOfDate=2099-01-01&expiringWithinDays=30&limit=200`,
    { headers: gaHeaders },
  );
  await ensureOk(summaryRes);
  const summary = (await summaryRes.json()) as {
    expiring?: {
      paidGrantUpperBoundMinutes?: number;
      paidGrantItems?: Array<{
        userId?: string;
        expiresAt?: string | null;
        grantedUpperBoundMinutes?: number;
      }>;
      compGrantRemainingMinutes?: number;
      compGrantItems?: Array<{
        userId?: string;
        leaveType?: string;
        expiresAt?: string | null;
        remainingMinutes?: number;
      }>;
      paidGrantMinutes?: number;
    };
  };
  expect(summary.expiring?.paidGrantUpperBoundMinutes).not.toBeUndefined();
  expect(summary.expiring?.compGrantRemainingMinutes).not.toBeUndefined();
  expect(summary.expiring?.paidGrantMinutes).toBeUndefined();
  const paidGrantItem = (summary.expiring?.paidGrantItems || []).find(
    (item) => item.userId === targetUserId && item.expiresAt === expiresAt,
  );
  expect(paidGrantItem?.grantedUpperBoundMinutes).toBe(480);
  const paidGrantBoundaryItem = (summary.expiring?.paidGrantItems || []).find(
    (item) =>
      item.userId === targetUserId && item.expiresAt === expiresAtBoundary,
  );
  expect(paidGrantBoundaryItem?.grantedUpperBoundMinutes).toBe(60);
  const paidGrantOutsideItem = (summary.expiring?.paidGrantItems || []).find(
    (item) =>
      item.userId === targetUserId && item.expiresAt === expiresAtOutside,
  );
  expect(paidGrantOutsideItem).toBeUndefined();
  const compGrantItem = (summary.expiring?.compGrantItems || []).find(
    (item) =>
      item.userId === targetUserId &&
      item.leaveType === 'compensatory' &&
      item.expiresAt === expiresAt,
  );
  expect(compGrantItem?.remainingMinutes).toBe(120);

  const ledgerJsonRes = await request.get(
    `${apiBase}/leave-entitlements/hr-ledger?userId=${encodeURIComponent(targetUserId)}&from=2098-12-01&to=2099-01-31&limit=200`,
    { headers: gaHeaders },
  );
  await ensureOk(ledgerJsonRes);
  const ledgerJson = (await ledgerJsonRes.json()) as {
    items?: Array<{
      userId?: string;
      eventType?: string;
      direction?: string;
    }>;
  };
  expect(
    (ledgerJson.items || []).some(
      (item) =>
        item.userId === targetUserId &&
        item.eventType === 'expiry_scheduled' &&
        item.direction === 'upper_bound_debit',
    ),
  ).toBeTruthy();

  const ledgerCsvRes = await request.get(
    `${apiBase}/leave-entitlements/hr-ledger?userId=${encodeURIComponent(targetUserId)}&from=2098-12-01&to=2099-01-31&format=csv&limit=200`,
    { headers: gaHeaders },
  );
  await ensureOk(ledgerCsvRes);
  expect(String(ledgerCsvRes.headers()['content-type'] || '')).toMatch(
    /text\/csv/i,
  );
  const ledgerCsv = await ledgerCsvRes.text();
  expect(ledgerCsv).toContain('upper_bound_debit');
  expect(ledgerCsv).toContain(targetUserId);

  const invalidRangeRes = await request.get(
    `${apiBase}/leave-entitlements/hr-ledger?from=2097-01-01&to=2099-01-31`,
    { headers: gaHeaders },
  );
  expect(invalidRangeRes.status()).toBe(400);
  const invalidRangeBody = await invalidRangeRes.json();
  expect(invalidRangeBody?.error?.code).toBe('INVALID_DATE_RANGE');
});
