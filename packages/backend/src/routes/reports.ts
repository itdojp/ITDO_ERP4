import { FastifyInstance } from 'fastify';
import {
  reportDeliveryDue,
  reportGroupEffort,
  reportOvertime,
  reportProjectProfitByGroup,
  reportProjectProfitByUser,
  reportProjectProfit,
  reportProjectEffort,
} from '../services/reports.js';
import { requireRole } from '../services/rbac.js';

export async function registerReportRoutes(app: FastifyInstance) {
  app.get(
    '/reports/project-effort/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const res = await reportProjectEffort(
        projectId,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const res = await reportProjectProfit(
        projectId,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId/by-user',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, userIds } = req.query as {
        from?: string;
        to?: string;
        userIds?: string;
      };
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await reportProjectProfitByUser(
        projectId,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
        ids.length ? ids : undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId/by-group',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, userIds, label } = req.query as {
        from?: string;
        to?: string;
        userIds?: string;
        label?: string;
      };
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (!ids.length) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'userIds is required' },
        });
      }
      const res = await reportProjectProfitByGroup(
        projectId,
        ids,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
        label,
      );
      return res;
    },
  );

  app.get(
    '/reports/group-effort',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { userIds, from, to } = req.query as {
        userIds?: string;
        from?: string;
        to?: string;
      };
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await reportGroupEffort(
        ids,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
      );
      return { items: res };
    },
  );

  app.get(
    '/reports/overtime/:userId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { userId } = req.params as { userId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const res = await reportOvertime(
        userId,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/delivery-due',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { from, to, projectId } = req.query as {
        from?: string;
        to?: string;
        projectId?: string;
      };
      const res = await reportDeliveryDue(
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined,
        projectId,
      );
      return { items: res };
    },
  );
}
