import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin',
  };
}

function userHeaders() {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
}

test('GET /chat-ack-templates denies non admin/mgmt roles', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/chat-ack-templates',
      headers: userHeaders(),
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden');
  } finally {
    await server.close();
  }
});

test('GET /chat-ack-templates rejects invalid flowType', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/chat-ack-templates?flowType=invalid-flow',
      headers: adminHeaders(),
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_FLOW_TYPE');
  } finally {
    await server.close();
  }
});

test('GET /chat-ack-templates applies flowType/actionKey filters', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let findManyArgs = null;
  await withPrismaStubs(
    {
      'chatAckTemplate.findMany': async (args) => {
        findManyArgs = args;
        return [{ id: 'tpl-1', flowType: 'invoice', actionKey: 'submit' }];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/chat-ack-templates?flowType=invoice&actionKey=submit',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
        assert.equal(findManyArgs?.where?.flowType, 'invoice');
        assert.equal(findManyArgs?.where?.actionKey, 'submit');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /chat-ack-templates normalizes recipient arrays and writes audit log', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let createArgs = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'chatAckTemplate.create': async (args) => {
        createArgs = args;
        return {
          id: 'tpl-created',
          flowType: args.data.flowType,
          actionKey: args.data.actionKey,
          isEnabled: args.data.isEnabled,
        };
      },
      'auditLog.create': async ({ data }) => {
        auditActions.push(data.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/chat-ack-templates',
          headers: adminHeaders(),
          payload: {
            flowType: 'invoice',
            actionKey: 'submit',
            messageBody: 'Please acknowledge.',
            requiredUserIds: [' user-1 ', ' user-2 '],
            requiredGroupIds: [' group-a '],
            requiredRoles: [' mgmt ', 'exec'],
            dueInHours: 48,
            remindIntervalHours: 12,
            escalationAfterHours: 24,
            escalationUserIds: [' esc-user '],
            escalationGroupIds: [' esc-group '],
            escalationRoles: [' hr '],
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.id, 'tpl-created');
      } finally {
        await server.close();
      }
    },
  );
  assert.equal(createArgs?.data?.flowType, 'invoice');
  assert.equal(createArgs?.data?.actionKey, 'submit');
  assert.deepEqual(createArgs?.data?.requiredUserIds, ['user-1', 'user-2']);
  assert.deepEqual(createArgs?.data?.requiredGroupIds, ['group-a']);
  assert.deepEqual(createArgs?.data?.requiredRoles, ['mgmt', 'exec']);
  assert.equal(createArgs?.data?.isEnabled, true);
  assert.equal(createArgs?.data?.createdBy, 'admin-user');
  assert.equal(createArgs?.data?.updatedBy, 'admin-user');
  assert.deepEqual(auditActions, ['chat_ack_template_created']);
});

test('PATCH /chat-ack-templates/:id returns NOT_FOUND when template does not exist', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'chatAckTemplate.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/chat-ack-templates/tpl-missing',
          headers: adminHeaders(),
          payload: { messageBody: 'updated' },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      } finally {
        await server.close();
      }
    },
  );
});

test('PATCH /chat-ack-templates/:id rejects invalid flowType', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'chatAckTemplate.findUnique': async () => ({
        id: 'tpl-1',
        flowType: 'invoice',
        actionKey: 'submit',
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/chat-ack-templates/tpl-1',
          headers: adminHeaders(),
          payload: { flowType: 'unknown' },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_FLOW_TYPE');
      } finally {
        await server.close();
      }
    },
  );
});

test('PATCH /chat-ack-templates/:id updates fields and writes audit log', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let updateArgs = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'chatAckTemplate.findUnique': async () => ({
        id: 'tpl-1',
        flowType: 'invoice',
        actionKey: 'submit',
      }),
      'chatAckTemplate.update': async (args) => {
        updateArgs = args;
        return {
          id: 'tpl-1',
          flowType: 'expense',
          actionKey: 'approve',
          isEnabled: false,
        };
      },
      'auditLog.create': async ({ data }) => {
        auditActions.push(data.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/chat-ack-templates/tpl-1',
          headers: adminHeaders(),
          payload: {
            flowType: 'expense',
            actionKey: 'approve',
            messageBody: 'updated body',
            requiredUserIds: [' user-x '],
            requiredGroupIds: [],
            requiredRoles: [' mgmt '],
            dueInHours: 0,
            remindIntervalHours: 2,
            escalationAfterHours: 4,
            escalationUserIds: [' esc-1 '],
            escalationGroupIds: [' esc-group '],
            escalationRoles: [' exec '],
            isEnabled: false,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.id, 'tpl-1');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(updateArgs?.where?.id, 'tpl-1');
  assert.equal(updateArgs?.data?.flowType, 'expense');
  assert.equal(updateArgs?.data?.actionKey, 'approve');
  assert.equal(updateArgs?.data?.messageBody, 'updated body');
  assert.deepEqual(updateArgs?.data?.requiredUserIds, ['user-x']);
  assert.deepEqual(updateArgs?.data?.requiredGroupIds, []);
  assert.deepEqual(updateArgs?.data?.requiredRoles, ['mgmt']);
  assert.equal(updateArgs?.data?.dueInHours, 0);
  assert.equal(updateArgs?.data?.remindIntervalHours, 2);
  assert.equal(updateArgs?.data?.escalationAfterHours, 4);
  assert.deepEqual(updateArgs?.data?.escalationUserIds, ['esc-1']);
  assert.deepEqual(updateArgs?.data?.escalationGroupIds, ['esc-group']);
  assert.deepEqual(updateArgs?.data?.escalationRoles, ['exec']);
  assert.equal(updateArgs?.data?.isEnabled, false);
  assert.equal(updateArgs?.data?.updatedBy, 'admin-user');
  assert.deepEqual(auditActions, ['chat_ack_template_updated']);
});
