import { FastifyInstance } from 'fastify';
import {
  reportDeliveryDue,
  reportGroupEffort,
  reportOvertime,
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
