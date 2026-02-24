import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(TEST_DIR, '..');

function runRecorderCheck(options = {}) {
  const tokenClaims = options.tokenClaims || {
    sub: 'principal-user',
    act: { sub: 'agent-bot' },
    scp: ['read-only'],
    roles: ['admin'],
  };
  const scenario = options.scenario || 'readSuccess';
  const script = `
    import { SignJWT, exportSPKI, generateKeyPair } from 'jose';

    process.env.DATABASE_URL = process.env.DATABASE_URL || '${MIN_DATABASE_URL}';
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_ISSUER = 'test-issuer';
    process.env.JWT_AUDIENCE = 'test-audience';
    process.env.ACTION_POLICY_ENFORCEMENT_PRESET = 'phase2_core';
    process.env.ACTION_POLICY_REQUIRED_ACTIONS = '';
    process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS = '';
    const tokenClaims = JSON.parse(process.env.TEST_TOKEN_CLAIMS || '{}');
    const scenario = String(process.env.TEST_SCENARIO || 'readSuccess');

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    process.env.JWT_PUBLIC_KEY = await exportSPKI(publicKey);

    const { prisma } = await import('./dist/services/db.js');
    const capture = {};

    prisma.userAccount.findUnique = async () => null;
    prisma.projectMember.findMany = async () => [];
    if (scenario === 'readSuccess') {
      prisma.project.groupBy = async () => [{ status: 'active', _count: { _all: 1 } }];
      prisma.invoice.groupBy = async () => [{ status: 'draft', _count: { _all: 1 }, _sum: { totalAmount: 1000 } }];
      prisma.timeEntry.groupBy = async () => [{ status: 'approved', _count: { _all: 1 }, _sum: { minutes: 60 } }];
      prisma.expense.groupBy = async () => [{ status: 'approved', _count: { _all: 1 }, _sum: { amount: 500 } }];
      prisma.approvalInstance.groupBy = async () => [{ status: 'pending_qa', flowType: 'invoice', _count: { _all: 1 } }];
    }
    if (scenario === 'policyDenied' || scenario === 'approvalRequired') {
      prisma.invoice.findUnique = async () => ({
        id: 'inv-001',
        status: 'approved',
        projectId: 'proj-001',
        invoiceNo: 'INV-001',
      });
      if (scenario === 'policyDenied') {
        prisma.actionPolicy.findMany = async () => [];
      } else {
        prisma.actionPolicy.findMany = async () => [
          {
            id: 'policy-allow-send',
            flowType: 'invoice',
            actionKey: 'send',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ];
        prisma.approvalInstance.findFirst = async () => null;
      }
    }

    prisma.agentRun.create = async ({ data }) => {
      capture.runCreate = data;
      return { id: 'run-001' };
    };
    prisma.agentRun.findUnique = async () => ({
      metadata: { routePath: '/project-360' },
    });
    prisma.agentStep.create = async ({ data }) => {
      capture.stepCreate = data;
      return { id: 'step-001' };
    };
    prisma.agentStep.update = async ({ data }) => {
      capture.stepUpdate = data;
      return { id: 'step-001' };
    };
    prisma.agentRun.update = async ({ data }) => {
      capture.runUpdate = data;
      return { id: 'run-001' };
    };
    prisma.decisionRequest.create = async ({ data }) => {
      capture.decisionCreate = data;
      return { id: 'decision-001' };
    };
    prisma.auditLog.create = async ({ data }) => {
      capture.auditCreate = data;
      return { id: 'audit-001' };
    };
    prisma.$transaction = async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(prisma);
    };

    const token = await new SignJWT(tokenClaims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(process.env.JWT_ISSUER)
      .setAudience(process.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const { buildServer } = await import('./dist/server.js');
    const server = await buildServer({ logger: false });
    try {
      const req = (() => {
        if (scenario === 'policyDenied' || scenario === 'approvalRequired') {
          return { method: 'POST', url: '/invoices/inv-001/send' };
        }
        return { method: 'GET', url: '/project-360' };
      })();
      const res = await server.inject({
        method: req.method,
        url: req.url,
        headers: { authorization: 'Bearer ' + token },
      });
      process.stdout.write(JSON.stringify({
        statusCode: res.statusCode,
        capture,
      }));
    } finally {
      await server.close();
    }
  `;

  return spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: MIN_DATABASE_URL,
      TEST_TOKEN_CLAIMS: JSON.stringify(tokenClaims),
      TEST_SCENARIO: scenario,
    },
    encoding: 'utf8',
  });
}

test('agent run recorder: delegated request stores run/step and links audit metadata', () => {
  const result = runRecorderCheck();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.statusCode, 200);

  const runCreate = payload.capture?.runCreate;
  assert.equal(runCreate?.source, 'agent');
  assert.equal(runCreate?.principalUserId, 'principal-user');
  assert.equal(runCreate?.actorUserId, 'agent-bot');

  const stepCreate = payload.capture?.stepCreate;
  assert.equal(stepCreate?.runId, 'run-001');
  assert.equal(stepCreate?.kind, 'api_request');
  assert.equal(stepCreate?.status, 'running');

  const runUpdate = payload.capture?.runUpdate;
  assert.equal(runUpdate?.status, 'completed');
  assert.equal(runUpdate?.httpStatus, 200);

  const stepUpdate = payload.capture?.stepUpdate;
  assert.equal(stepUpdate?.status, 'completed');
  assert.equal(stepUpdate?.errorCode ?? null, null);

  assert.equal(payload.capture?.decisionCreate, undefined);

  const auditCreate = payload.capture?.auditCreate;
  assert.equal(auditCreate?.action, 'project_360_viewed');
  assert.equal(auditCreate?.metadata?._agent?.runId, 'run-001');
});

test('agent run recorder: non delegated token does not create agent run records', () => {
  const result = runRecorderCheck({
    tokenClaims: {
      sub: 'principal-user',
      roles: ['admin'],
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.statusCode, 200);
  assert.equal(payload.capture?.runCreate, undefined);
  assert.equal(payload.capture?.stepCreate, undefined);
  assert.equal(payload.capture?.runUpdate, undefined);
  assert.equal(payload.capture?.stepUpdate, undefined);
  assert.equal(payload.capture?.decisionCreate, undefined);
  const auditCreate = payload.capture?.auditCreate;
  assert.equal(auditCreate?.metadata?._agent, undefined);
});

test('agent run recorder: policy_denied opens policy_override decision request', () => {
  const result = runRecorderCheck({
    scenario: 'policyDenied',
    tokenClaims: {
      sub: 'principal-user',
      act: { sub: 'agent-bot' },
      scp: ['write-limited'],
      roles: ['admin'],
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.statusCode, 403);

  const runUpdate = payload.capture?.runUpdate;
  assert.equal(runUpdate?.status, 'failed');
  assert.equal(runUpdate?.httpStatus, 403);
  assert.equal(runUpdate?.errorCode, 'policy_denied');
  assert.equal(typeof runUpdate?.metadata?.decisionRequestId, 'string');

  const stepUpdate = payload.capture?.stepUpdate;
  assert.equal(stepUpdate?.status, 'failed');
  assert.equal(stepUpdate?.errorCode, 'policy_denied');
  assert.equal(stepUpdate?.output?.statusCode, 403);

  const decisionCreate = payload.capture?.decisionCreate;
  assert.equal(decisionCreate?.decisionType, 'policy_override');
  assert.equal(decisionCreate?.status, 'open');
  assert.equal(decisionCreate?.reasonText, 'policy_denied');
  assert.equal(decisionCreate?.metadata?.method, 'POST');
  assert.equal(decisionCreate?.metadata?.statusCode, 403);
});

test('agent run recorder: approval_required opens approval_required decision request', () => {
  const result = runRecorderCheck({
    scenario: 'approvalRequired',
    tokenClaims: {
      sub: 'principal-user',
      act: { sub: 'agent-bot' },
      scp: ['write-limited'],
      roles: ['admin'],
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.statusCode, 403);

  const runUpdate = payload.capture?.runUpdate;
  assert.equal(runUpdate?.status, 'failed');
  assert.equal(runUpdate?.httpStatus, 403);
  assert.equal(runUpdate?.errorCode, 'approval_required');
  assert.equal(typeof runUpdate?.metadata?.decisionRequestId, 'string');

  const stepUpdate = payload.capture?.stepUpdate;
  assert.equal(stepUpdate?.status, 'failed');
  assert.equal(stepUpdate?.errorCode, 'approval_required');
  assert.equal(stepUpdate?.output?.statusCode, 403);

  const decisionCreate = payload.capture?.decisionCreate;
  assert.equal(decisionCreate?.decisionType, 'approval_required');
  assert.equal(decisionCreate?.status, 'open');
  assert.equal(decisionCreate?.reasonText, 'approval_required');
  assert.equal(decisionCreate?.metadata?.method, 'POST');
  assert.equal(decisionCreate?.metadata?.statusCode, 403);
});
