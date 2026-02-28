import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const scimToken = process.env.E2E_SCIM_BEARER_TOKEN || 'e2e-scim-token';

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const buildHeaders = (input: {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
}) => ({
  'x-user-id': input.userId,
  'x-roles': input.roles.join(','),
  'x-project-ids': (input.projectIds ?? []).join(','),
  'x-group-ids': (input.groupIds ?? []).join(','),
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('personal GA room is created on SCIM user create and is accessible to GA only @core', async ({
  request,
}) => {
  const suffix = runId();
  const scimHeaders = { authorization: `Bearer ${scimToken}` };

  const gaUserName = `e2e-ga-${suffix}@example.com`;
  const gaUserCreateRes = await request.post(`${apiBase}/scim/v2/Users`, {
    data: {
      userName: gaUserName,
      displayName: `E2E GA ${suffix}`,
      active: true,
    },
    headers: scimHeaders,
  });
  await ensureOk(gaUserCreateRes);
  const gaUser = await gaUserCreateRes.json();
  const gaUserId = gaUser.id as string;
  expect(gaUserId).toBeTruthy();

  const groupCreateRes = await request.post(`${apiBase}/scim/v2/Groups`, {
    data: {
      displayName: 'general_affairs',
      members: [{ value: gaUserId }],
    },
    headers: scimHeaders,
  });
  await ensureOk(groupCreateRes);

  const employeeUserName = `e2e-employee-${suffix}@example.com`;
  const employeeCreateRes = await request.post(`${apiBase}/scim/v2/Users`, {
    data: {
      userName: employeeUserName,
      displayName: `E2E Employee ${suffix}`,
      active: true,
    },
    headers: scimHeaders,
  });
  await ensureOk(employeeCreateRes);

  const employeeHeaders = buildHeaders({
    userId: employeeUserName,
    roles: ['user'],
  });
  const gaHeaders = buildHeaders({
    userId: gaUserName,
    roles: ['hr'],
    groupIds: ['general_affairs'],
  });
  const pmHeaders = buildHeaders({
    userId: `e2e-pm-${suffix}@example.com`,
    roles: ['mgmt'],
    groupIds: ['mgmt'],
  });

  const employeeRoomsRes = await request.get(`${apiBase}/chat-rooms`, {
    headers: employeeHeaders,
  });
  await ensureOk(employeeRoomsRes);
  const employeeRooms = await employeeRoomsRes.json();
  const employeeItems = Array.isArray(employeeRooms.items)
    ? (employeeRooms.items as any[])
    : [];
  const personalRoom = employeeItems.find(
    (room) =>
      room?.type === 'private_group' &&
      room?.isOfficial === true &&
      typeof room?.name === 'string' &&
      room.name.includes(employeeUserName),
  );
  expect(personalRoom).toBeTruthy();
  const roomId = personalRoom.id as string;
  expect(roomId).toBeTruthy();

  const gaRoomsRes = await request.get(`${apiBase}/chat-rooms`, {
    headers: gaHeaders,
  });
  await ensureOk(gaRoomsRes);
  const gaRooms = await gaRoomsRes.json();
  const gaItems = Array.isArray(gaRooms.items) ? (gaRooms.items as any[]) : [];
  expect(gaItems.some((room) => room?.id === roomId)).toBe(true);

  const messageBody = `E2E personal GA message ${suffix}`;
  const postRes = await request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages`,
    {
      data: { body: messageBody },
      headers: gaHeaders,
    },
  );
  await ensureOk(postRes);
  const posted = await postRes.json();
  expect(posted?.roomId).toBe(roomId);
  expect(posted?.userId).toBe(gaUserName);
  expect(posted?.body).toBe(messageBody);

  const employeeMessagesRes = await request.get(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages?limit=10`,
    { headers: employeeHeaders },
  );
  await ensureOk(employeeMessagesRes);
  const employeeMessages = await employeeMessagesRes.json();
  const msgItems = Array.isArray(employeeMessages.items)
    ? (employeeMessages.items as any[])
    : [];
  expect(
    msgItems.some((item) => item?.body === messageBody && item?.userId === gaUserName),
  ).toBe(true);

  const pmReadRes = await request.get(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages?limit=1`,
    { headers: pmHeaders },
  );
  expect(pmReadRes.status()).toBe(403);
  const pmReadBody = await pmReadRes.json();
  expect(pmReadBody?.error).toBe('forbidden_room_member');

  const pmPostRes = await request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages`,
    { data: { body: `pm should not post ${suffix}` }, headers: pmHeaders },
  );
  expect(pmPostRes.status()).toBe(403);
  const pmPostBody = await pmPostRes.json();
  expect(pmPostBody?.error).toBe('forbidden_room_member');
});

