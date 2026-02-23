import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUserContextFromJwtPayload,
  evaluateDelegatedScope,
} from '../dist/plugins/auth.js';

test('buildUserContextFromJwtPayload: principal/actor/scopes are mapped', () => {
  const user = buildUserContextFromJwtPayload({
    sub: 'principal-user',
    act: { sub: 'agent-bot' },
    scp: ['read-only'],
    roles: ['user'],
    jti: 'tok-001',
    aud: ['erp4-agent'],
    exp: 1900000000,
  });

  assert.equal(user?.userId, 'principal-user');
  assert.equal(user?.auth?.principalUserId, 'principal-user');
  assert.equal(user?.auth?.actorUserId, 'agent-bot');
  assert.deepEqual(user?.auth?.scopes, ['read-only']);
  assert.equal(user?.auth?.tokenId, 'tok-001');
  assert.deepEqual(user?.auth?.audience, ['erp4-agent']);
  assert.equal(user?.auth?.expiresAt, 1900000000);
  assert.equal(user?.auth?.delegated, true);
});

test('evaluateDelegatedScope: read-only scope allows GET', () => {
  const decision = evaluateDelegatedScope(
    {
      userId: 'principal-user',
      roles: ['user'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['read-only'],
        delegated: true,
      },
    },
    'GET',
  );

  assert.equal(decision.allowed, true);
});

test('evaluateDelegatedScope: read-only scope denies POST', () => {
  const decision = evaluateDelegatedScope(
    {
      userId: 'principal-user',
      roles: ['user'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['read-only'],
        delegated: true,
      },
    },
    'POST',
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'scope_denied');
});

test('evaluateDelegatedScope: write-limited scope allows POST', () => {
  const decision = evaluateDelegatedScope(
    {
      userId: 'principal-user',
      roles: ['user'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['write-limited'],
        delegated: true,
      },
    },
    'POST',
  );

  assert.equal(decision.allowed, true);
});
