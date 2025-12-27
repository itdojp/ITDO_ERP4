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

function parseDateParam(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function registerReportRoutes(app: FastifyInstance) {
  app.get(
    '/reports/project-effort/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportProjectEffort(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportProjectProfit(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId/by-user',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, userIds } = req.query as {
        from?: string;
        to?: string;
        userIds?: string;
      };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await reportProjectProfitByUser(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
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
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (!ids.length) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'userIds query parameter is required and must be a comma-separated list of user IDs',
          },
        });
      }
      const res = await reportProjectProfitByGroup(
        projectId,
        ids,
        fromDate ?? undefined,
        toDate ?? undefined,
        label,
      );
      return res;
    },
  );

  app.get(
    '/reports/group-effort',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { userIds, from, to } = req.query as {
        userIds?: string;
        from?: string;
        to?: string;
      };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await reportGroupEffort(
        ids,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      return { items: res };
    },
  );

  app.get(
    '/reports/overtime/:userId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportOvertime(
        userId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      return res;
    },
  );

  app.get(
    '/reports/delivery-due',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { from, to, projectId } = req.query as {
        from?: string;
        to?: string;
        projectId?: string;
      };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportDeliveryDue(
        fromDate ?? undefined,
        toDate ?? undefined,
        projectId,
      );
      return { items: res };
    },
  );
}
