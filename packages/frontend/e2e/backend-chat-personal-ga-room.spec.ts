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
  const gaExternalId = `e2e-ga-ext-${suffix}`;
  const gaUserCreateRes = await request.post(`${apiBase}/scim/v2/Users`, {
    data: {
      externalId: gaExternalId,
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

  const groupAddRes = await request.patch(
    `${apiBase}/scim/v2/Groups/general_affairs`,
    {
      data: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'add',
            path: 'members',
            value: { members: [{ value: gaUserId }] },
          },
        ],
      },
      headers: scimHeaders,
    },
  );
  await ensureOk(groupAddRes);

  const employeeUserName = `e2e-employee-${suffix}@example.com`;
  const employeeExternalId = `e2e-employee-ext-${suffix}`;
  const employeeCreateRes = await request.post(`${apiBase}/scim/v2/Users`, {
    data: {
      externalId: employeeExternalId,
      userName: employeeUserName,
      displayName: `E2E Employee ${suffix}`,
      active: true,
    },
    headers: scimHeaders,
  });
  await ensureOk(employeeCreateRes);
  const employeeUser = await employeeCreateRes.json();
  const employeeUserScimId = employeeUser.id as string;
  expect(employeeUserScimId).toBeTruthy();

  const employeeHeaders = buildHeaders({
    userId: employeeExternalId,
    roles: ['user'],
  });
  const gaHeaders = buildHeaders({
    userId: gaExternalId,
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
      typeof room?.id === 'string' &&
      room.id.startsWith('pga_'),
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
  expect(posted?.userId).toBe(gaExternalId);
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
    msgItems.some((item) => item?.body === messageBody && item?.userId === gaExternalId),
  ).toBe(true);

  const renamedEmployeeUserName = `e2e-employee-renamed-${suffix}@example.com`;
  const scimEmployeeUpdateRes = await request.put(
    `${apiBase}/scim/v2/Users/${encodeURIComponent(employeeUserScimId)}`,
    {
      data: {
        id: employeeUserScimId,
        externalId: employeeExternalId,
        userName: renamedEmployeeUserName,
        displayName: `E2E Employee ${suffix}`,
        active: true,
      },
      headers: scimHeaders,
    },
  );
  await ensureOk(scimEmployeeUpdateRes);

  const employeeRoomsAfterRenameRes = await request.get(`${apiBase}/chat-rooms`, {
    headers: employeeHeaders,
  });
  await ensureOk(employeeRoomsAfterRenameRes);
  const employeeRoomsAfterRename = await employeeRoomsAfterRenameRes.json();
  const itemsAfterRename = Array.isArray(employeeRoomsAfterRename.items)
    ? (employeeRoomsAfterRename.items as any[])
    : [];
  expect(itemsAfterRename.some((room) => room?.id === roomId)).toBe(true);

  const pmReadRes = await request.get(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages?limit=1`,
    { headers: pmHeaders },
  );
  expect(pmReadRes.status()).toBe(403);
  const pmReadBody = await pmReadRes.json();
  expect(pmReadBody?.error?.code ?? pmReadBody?.error).toBe(
    'forbidden_room_member',
  );

  const pmPostRes = await request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages`,
    { data: { body: `pm should not post ${suffix}` }, headers: pmHeaders },
  );
  expect(pmPostRes.status()).toBe(403);
  const pmPostBody = await pmPostRes.json();
  expect(pmPostBody?.error?.code ?? pmPostBody?.error).toBe(
    'forbidden_room_member',
  );
});
