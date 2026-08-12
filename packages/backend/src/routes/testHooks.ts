import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';

const knowledgeLlmE2ePolicyMarker = '__erp4_e2e_knowledge_llm__';
const knowledgeLlmTestConfigFields = new Set([
  'softLimitMicros',
  'hardLimitMicros',
  'requestsPerHour',
]);
const maximumE2eCostMicros = 9_223_372_036_854_775_807n;

function boundedMicros(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    return null;
  }
  const parsed = BigInt(value);
  return parsed <= maximumE2eCostMicros ? parsed : null;
}

function boundedRequestsPerHour(value: unknown): number | null {
  return Number.isSafeInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= 1000
    ? Number(value)
    : null;
}

function isTestHookEnabled() {
  return (
    process.env.E2E_ENABLE_TEST_HOOKS === '1' && process.env.NODE_ENV === 'test'
  );
}

export async function registerTestHookRoutes(app: FastifyInstance) {
  if (!isTestHookEnabled()) return;

  if (process.env.KNOWLEDGE_EXTERNAL_LLM_PROVIDER === 'stub') {
    app.post(
      '/__test__/knowledge-llm/configure',
      {
        preHandler: [
          requireRole(['admin', 'mgmt']),
          requireCanonicalKnowledgeActor,
        ],
      },
      async (req, reply) => {
        const body = (req.body || {}) as {
          softLimitMicros?: unknown;
          hardLimitMicros?: unknown;
          requestsPerHour?: unknown;
        };
        const softLimitMicros = boundedMicros(body.softLimitMicros);
        const hardLimitMicros = boundedMicros(body.hardLimitMicros);
        const requestsPerHour = boundedRequestsPerHour(body.requestsPerHour);
        const actorUserId = knowledgeActorFromRequest(req).userId;
        if (
          Object.keys(body).some(
            (field) => !knowledgeLlmTestConfigFields.has(field),
          ) ||
          softLimitMicros === null ||
          hardLimitMicros === null ||
          softLimitMicros > hardLimitMicros ||
          requestsPerHour === null ||
          !actorUserId
        ) {
          return reply.code(400).send({
            error: { code: 'INVALID_KNOWLEDGE_LLM_TEST_CONFIG' },
          });
        }

        const existing = await prisma.knowledgeLlmBudgetPolicy.findMany({
          where: { subjectType: 'user', subjectId: actorUserId },
          select: { id: true, version: true, active: true, createdBy: true },
        });
        if (
          existing.some(
            (policy) =>
              policy.active && policy.createdBy !== knowledgeLlmE2ePolicyMarker,
          )
        ) {
          return reply.code(409).send({
            error: { code: 'KNOWLEDGE_LLM_TEST_POLICY_CONFLICT' },
          });
        }
        const version =
          existing.reduce(
            (maximum, policy) => Math.max(maximum, policy.version),
            0,
          ) + 1;
        await prisma.$transaction(async (transaction) => {
          await transaction.knowledgeLlmBudgetPolicy.updateMany({
            where: {
              subjectType: 'user',
              subjectId: actorUserId,
              active: true,
              createdBy: knowledgeLlmE2ePolicyMarker,
            },
            data: { active: false, updatedBy: knowledgeLlmE2ePolicyMarker },
          });
          await transaction.knowledgeLlmBudgetPolicy.create({
            data: {
              subjectType: 'user',
              subjectId: actorUserId,
              currency: 'JPY',
              timezone: 'Asia/Tokyo',
              softLimitMicros,
              hardLimitMicros,
              requestsPerHour,
              version,
              createdBy: knowledgeLlmE2ePolicyMarker,
              updatedBy: knowledgeLlmE2ePolicyMarker,
            },
          });
        });
        return {
          budgetConfigured: true,
          policyVersion: version,
        };
      },
    );
  }

  app.post(
    '/__test__/evidence-snapshots/reset',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const body = (req.body || {}) as { approvalInstanceId?: unknown };
      const approvalInstanceId =
        typeof body.approvalInstanceId === 'string'
          ? body.approvalInstanceId.trim()
          : '';
      if (!approvalInstanceId) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_APPROVAL_INSTANCE_ID',
            message: 'approvalInstanceId is required',
          },
        });
      }
      const result = await prisma.evidenceSnapshot.deleteMany({
        where: { approvalInstanceId },
      });
      return { deletedCount: result.count };
    },
  );

  app.post(
    '/__test__/agent-runs/seed-audit-log',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const body = (req.body || {}) as {
        action?: unknown;
        targetTable?: unknown;
        targetId?: unknown;
      };
      const action =
        typeof body.action === 'string' && body.action.trim()
          ? body.action.trim()
          : 'agent_run_seeded';
      const targetTable =
        typeof body.targetTable === 'string' && body.targetTable.trim()
          ? body.targetTable.trim()
          : 'invoices';
      const targetId =
        typeof body.targetId === 'string' && body.targetId.trim()
          ? body.targetId.trim()
          : `seed-${randomUUID()}`;
      const requestId = `test-agent-run-${randomUUID()}`;
      const now = new Date();

      const run = await prisma.agentRun.create({
        data: {
          requestId,
          source: 'agent',
          principalUserId: 'test-principal-user',
          actorUserId: 'test-agent-bot',
          scopes: ['write-limited'],
          method: 'POST',
          path: '/invoices/:id/send',
          status: 'failed',
          httpStatus: 403,
          errorCode: 'policy_denied',
          metadata: {
            routePath: '/invoices/:id/send',
            requestId,
          },
          startedAt: now,
          finishedAt: now,
        },
      });

      const step = await prisma.agentStep.create({
        data: {
          runId: run.id,
          stepOrder: 1,
          kind: 'api_request',
          name: 'POST /invoices/:id/send',
          status: 'failed',
          errorCode: 'policy_denied',
          startedAt: now,
          finishedAt: now,
          input: {
            requestId,
            method: 'POST',
            path: '/invoices/:id/send',
          },
          output: {
            statusCode: 403,
            errorCode: 'policy_denied',
          },
        },
      });

      const decision = await prisma.decisionRequest.create({
        data: {
          runId: run.id,
          stepId: step.id,
          decisionType: 'policy_override',
          status: 'open',
          title: 'policy_denied',
          reasonText: 'policy_denied',
          targetTable,
          targetId,
          requestedBy: req.user?.userId,
          requestedAt: now,
          metadata: {
            requestId,
            routePath: '/invoices/:id/send',
            method: 'POST',
            statusCode: 403,
            errorCode: 'policy_denied',
          },
        },
      });

      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          metadata: {
            routePath: '/invoices/:id/send',
            requestId,
            decisionRequestId: decision.id,
          },
        },
      });

      const audit = await prisma.auditLog.create({
        data: {
          action,
          userId: req.user?.userId,
          actorRole: req.user?.roles?.[0] || null,
          actorGroupId: req.user?.groupIds?.[0] || null,
          requestId,
          source: 'agent',
          targetTable,
          targetId,
          metadata: {
            _request: { id: requestId, source: 'agent' },
            _agent: { runId: run.id, decisionRequestId: decision.id },
            _auth: {
              principalUserId: 'test-principal-user',
              actorUserId: 'test-agent-bot',
              scopes: ['write-limited'],
            },
          },
        },
      });

      return {
        runId: run.id,
        stepId: step.id,
        decisionRequestId: decision.id,
        auditLogId: audit.id,
        action,
        targetTable,
        targetId,
      };
    },
  );
}
