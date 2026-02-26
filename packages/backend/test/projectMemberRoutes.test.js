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

function userHeaders(userId = 'member-user') {
  return {
    'x-user-id': userId,
    'x-roles': 'user',
    'x-project-ids': '00000000-0000-0000-0000-000000000001',
  };
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

test('POST /projects/:id/members forbidden response does not destabilize server', async () => {
  await withPrismaStubs(
    {
      'projectMember.findFirst': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const projectId = '00000000-0000-0000-0000-000000000001';
        const requestBody = {
          userId: 'candidate@example.com',
          role: 'member',
        };

        const forbidden1 = await server.inject({
          method: 'POST',
          url: `/projects/${projectId}/members`,
          headers: userHeaders('member-1'),
          payload: requestBody,
        });
        assert.equal(forbidden1.statusCode, 403, forbidden1.body);
        const forbidden1Body = JSON.parse(forbidden1.body);
        const forbidden1Code =
          typeof forbidden1Body?.error === 'string'
            ? forbidden1Body.error
            : forbidden1Body?.error?.code;
        assert.equal(forbidden1Code, 'forbidden_project');

        const health = await server.inject({ method: 'GET', url: '/health' });
        assert.equal(health.statusCode, 200, health.body);

        const forbidden2 = await server.inject({
          method: 'POST',
          url: `/projects/${projectId}/members`,
          headers: userHeaders('member-2'),
          payload: requestBody,
        });
        assert.equal(forbidden2.statusCode, 403, forbidden2.body);
        const forbidden2Body = JSON.parse(forbidden2.body);
        const forbidden2Code =
          typeof forbidden2Body?.error === 'string'
            ? forbidden2Body.error
            : forbidden2Body?.error?.code;
        assert.equal(forbidden2Code, 'forbidden_project');
      });
    },
  );
});
