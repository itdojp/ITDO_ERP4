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

function withEnv(overrides, fn) {
  const prev = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    prev.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of prev.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function withServer(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        await fn(server);
      } finally {
        await server.close();
      }
    },
  );
}

function adminHeaders() {
  return {
    'x-user-id': 'admin-1',
    'x-roles': 'admin',
  };
}

function assertNotFound(res, expectedMessage) {
  assert.equal(res.statusCode, 404, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body?.error?.code, 'NOT_FOUND');
  assert.equal(body?.error?.message, expectedMessage);
}

function deletedProjectRoom(roomId = 'p1') {
  return {
    id: roomId,
    type: 'project',
    groupId: null,
    viewerGroupIds: null,
    deletedAt: new Date('2026-03-01T00:00:00.000Z'),
    allowExternalUsers: false,
  };
}

test('GET /projects/:projectId/chat-unread returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/project-missing/chat-unread',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-messages returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/project-missing/chat-messages',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-summary returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/project-missing/chat-summary',
          headers: adminHeaders(),
          payload: {},
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-read returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/project-missing/chat-read',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-mention-candidates returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/project-missing/chat-mention-candidates',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-ack-candidates returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/project-missing/chat-ack-candidates?q=ab',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-messages returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/project-missing/chat-messages',
          headers: adminHeaders(),
          payload: { body: 'hello' },
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-ack-requests/preview returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatSetting.findUnique': async () => null,
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/project-missing/chat-ack-requests/preview',
          headers: adminHeaders(),
          payload: { requiredUserIds: ['u-1'] },
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-ack-requests returns 404 when project does not exist', async () => {
  await withPrismaStubs(
    {
      'chatSetting.findUnique': async () => null,
      'chatRoom.findUnique': async () => null,
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/project-missing/chat-ack-requests',
          headers: adminHeaders(),
          payload: {
            body: 'ack please',
            requiredUserIds: ['u-1'],
          },
        });
        assertNotFound(res, 'Project not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-unread returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/p1/chat-unread',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-messages returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/p1/chat-messages',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-summary returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/p1/chat-summary',
          headers: adminHeaders(),
          payload: {},
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-mention-candidates returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/p1/chat-mention-candidates',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-read returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/p1/chat-read',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-messages returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/p1/chat-messages',
          headers: adminHeaders(),
          payload: { body: 'hello' },
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-ack-requests/preview returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatSetting.findUnique': async () => null,
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/p1/chat-ack-requests/preview',
          headers: adminHeaders(),
          payload: { requiredUserIds: ['u-1'] },
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('POST /projects/:projectId/chat-ack-requests returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatSetting.findUnique': async () => null,
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/p1/chat-ack-requests',
          headers: adminHeaders(),
          payload: {
            body: 'ack please',
            requiredUserIds: ['u-1'],
          },
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});

test('GET /projects/:projectId/chat-ack-candidates returns 404 when project room is deleted', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => deletedProjectRoom('p1'),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/p1/chat-ack-candidates?q=ab',
          headers: adminHeaders(),
        });
        assertNotFound(res, 'Room not found');
      });
    },
  );
});
