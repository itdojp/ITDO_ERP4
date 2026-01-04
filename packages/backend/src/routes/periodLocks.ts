import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { periodLockSchema } from './validators.js';

export async function registerPeriodLockRoutes(app: FastifyInstance) {
  app.get(
    '/period-locks',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { scope, projectId, period } = req.query as {
        scope?: string;
        projectId?: string;
        period?: string;
      };
      const where: Record<string, unknown> = {};
      if (scope) where.scope = scope;
      if (projectId) where.projectId = projectId;
      if (period) where.period = period;
      const items = await prisma.periodLock.findMany({
        where,
        orderBy: { closedAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/period-locks',
    { preHandler: requireRole(['admin', 'mgmt']), schema: periodLockSchema },
    async (req, reply) => {
      const body = req.body as {
        period: string;
        scope: string;
        projectId?: string;
        reason?: string;
      };
      if (body.scope === 'project' && !body.projectId) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_PROJECT_ID',
            message: 'projectId is required',
          },
        });
      }
      if (body.scope === 'global' && body.projectId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SCOPE',
            message: 'projectId must be empty for global scope',
          },
        });
      }
      const existing = await prisma.periodLock.findFirst({
        where: {
          period: body.period,
          scope: body.scope,
          projectId: body.projectId ?? null,
        },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({
          error: {
            code: 'ALREADY_EXISTS',
            message: 'Period lock already exists',
          },
        });
      }
      if (body.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: body.projectId },
          select: { id: true },
        });
        if (!project) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Project not found' },
          });
        }
      }
      const created = await prisma.periodLock.create({
        data: {
          period: body.period,
          scope: body.scope,
          projectId: body.projectId ?? null,
          reason: body.reason,
          closedAt: new Date(),
          closedBy: req.user?.userId,
        },
      });
      return created;
    },
  );

  app.delete(
    '/period-locks/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await prisma.periodLock.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Period lock not found' },
        });
      }
      await prisma.periodLock.delete({ where: { id } });
      return { ok: true };
    },
  );
}
