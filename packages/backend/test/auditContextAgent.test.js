import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditContextFromRequest,
  buildAuditMetadata,
} from '../dist/services/audit.js';

test('auditContextFromRequest: delegated auth uses source=agent and principal/actor metadata', () => {
  const req = {
    id: 'req-001',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'node-test' },
    agentRun: { runId: 'run-001', stepId: 'step-001' },
    user: {
      userId: 'principal-user',
      roles: ['user'],
      groupIds: ['group-a'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['read-only'],
        tokenId: 'tok-001',
        audience: ['erp4-agent'],
        expiresAt: 1900000000,
        delegated: true,
      },
    },
  };

  const ctx = auditContextFromRequest(req);
  assert.equal(ctx.source, 'agent');
  assert.equal(ctx.principalUserId, 'principal-user');
  assert.equal(ctx.actorUserId, 'agent-bot');
  assert.deepEqual(ctx.authScopes, ['read-only']);
  assert.equal(ctx.authTokenId, 'tok-001');
  assert.deepEqual(ctx.authAudience, ['erp4-agent']);
  assert.equal(ctx.authExpiresAt, 1900000000);
  assert.equal(ctx.agentRunId, 'run-001');
});

test('auditContextFromRequest: non delegated auth keeps source=api', () => {
  const req = {
    id: 'req-002',
    ip: '127.0.0.1',
    headers: {},
    user: {
      userId: 'normal-user',
      roles: ['admin'],
      groupIds: [],
      auth: {
        principalUserId: 'normal-user',
        actorUserId: 'normal-user',
        scopes: [],
        delegated: false,
      },
    },
  };

  const ctx = auditContextFromRequest(req);
  assert.equal(ctx.source, 'api');
  assert.equal(ctx.principalUserId, 'normal-user');
  assert.equal(ctx.actorUserId, 'normal-user');
});

test('buildAuditMetadata: merges delegated context with existing metadata', () => {
  const metadata = buildAuditMetadata({
    action: 'test_action',
    requestId: 'req-003',
    source: 'agent',
    agentRunId: 'run-003',
    decisionRequestId: 'decision-003',
    principalUserId: 'principal-user',
    actorUserId: 'agent-bot',
    authScopes: ['read-only'],
    authTokenId: 'tok-003',
    authAudience: ['erp4-agent'],
    authExpiresAt: 1900000001,
    metadata: { existing: 'value' },
  });

  assert.equal(metadata.existing, 'value');
  assert.deepEqual(metadata._request, { id: 'req-003', source: 'agent' });
  assert.deepEqual(metadata._agent, {
    runId: 'run-003',
    decisionRequestId: 'decision-003',
  });
  assert.deepEqual(metadata._auth, {
    principalUserId: 'principal-user',
    actorUserId: 'agent-bot',
    scopes: ['read-only'],
    tokenId: 'tok-003',
    audience: ['erp4-agent'],
    expiresAt: 1900000001,
  });
});
