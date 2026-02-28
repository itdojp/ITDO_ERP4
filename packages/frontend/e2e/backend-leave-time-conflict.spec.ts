import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
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
