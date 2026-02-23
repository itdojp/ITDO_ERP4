import { FastifyInstance } from 'fastify';
import { createApiErrorResponse } from '../services/errors.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';

export async function registerAgentRunRoutes(app: FastifyInstance) {
  app.get(
    '/agent-runs/:id',
    { preHandler: requireRole(['admin', 'mgmt', 'exec']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const runId = String(id || '').trim();
      if (!runId) {
        return reply.status(400).send(
          createApiErrorResponse('INVALID_ID', 'id is required', {
            category: 'validation',
          }),
        );
      }

      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        include: {
          steps: {
            orderBy: [{ stepOrder: 'asc' }, { createdAt: 'asc' }],
            include: {
              decisions: {
                orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }],
              },
            },
          },
          decisionRequests: {
            where: { stepId: null },
            orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });

      if (!run) {
        return reply.status(404).send(
          createApiErrorResponse('NOT_FOUND', 'AgentRun not found', {
            category: 'not_found',
          }),
        );
      }

      await logAudit({
        ...auditContextFromRequest(req),
        action: 'agent_run_viewed',
        targetTable: 'agent_runs',
        targetId: run.id,
        metadata: {
          stepCount: run.steps.length,
          decisionCount: run.decisionRequests.length,
        },
      });

      return run;
    },
  );
}
