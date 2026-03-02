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
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateInput(tomorrow);

  const leaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: 'demo-user',
      leaveType: 'paid',
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `no-evidence-${suffix}`,
    },
    headers: authHeaders,
  });
  await ensureOk(leaveRes);
  const leave = await leaveRes.json();

  const submitMissingRes = await request.post(
    `${apiBase}/leave-requests/${leave.id}/submit`,
    { data: {}, headers: authHeaders },
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
      headers: authHeaders,
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
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateInput(tomorrow);

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
      userId: 'demo-user',
      leaveType: 'paid',
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `with-evidence-${suffix}`,
    },
    headers: authHeaders,
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
    { data: {}, headers: authHeaders },
  );
  await ensureOk(submitOkRes);
  const submitted = await submitOkRes.json();
  expect(submitted.status).toBe('pending_manager');
});

test('leave submit auto-approves when leave type does not require approval @core', async ({
  request,
}) => {
  const suffix = runId();
  const leaveTypeCode = `e2e_auto_${Date.now().toString(36)}_${randomUUID().slice(
    0,
    6,
  )}`.toLowerCase();
  const leaveUserId = `leave-auto-${suffix}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateInput(tomorrow);

  const leaveTypeRes = await request.post(`${apiBase}/leave-types`, {
    data: {
      code: leaveTypeCode,
      name: `E2E Auto Approve ${suffix}`,
      isPaid: true,
      unit: 'daily',
      requiresApproval: false,
      attachmentPolicy: 'none',
      active: true,
    },
    headers: authHeaders,
  });
  await ensureOk(leaveTypeRes);

  const leaveRes = await request.post(`${apiBase}/leave-requests`, {
    data: {
      userId: leaveUserId,
      leaveType: leaveTypeCode,
      startDate: tomorrowStr,
      endDate: tomorrowStr,
      hours: 8,
      notes: `auto-approve-${suffix}`,
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
        noConsultationReason: `auto-approve-${suffix}`,
      },
      headers: authHeaders,
    },
  );
  await ensureOk(submitRes);
  const submitted = await submitRes.json();
  expect(submitted.status).toBe('approved');

  const instancesRes = await request.get(
    `${apiBase}/approval-instances?flowType=leave`,
    { headers: authHeaders },
  );
  await ensureOk(instancesRes);
  const instancesPayload = (await instancesRes.json()) as {
    items?: Array<{ targetId?: string; status?: string }>;
  };
  const matched = (instancesPayload.items || []).find(
    (item) =>
      item?.targetId === leave.id &&
      item?.status !== 'approved' &&
      item?.status !== 'rejected' &&
      item?.status !== 'cancelled',
  );
  expect(matched).toBeUndefined();
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
