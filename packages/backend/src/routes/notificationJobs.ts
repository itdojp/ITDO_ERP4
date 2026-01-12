import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { runNotificationEmailDeliveries } from '../services/notificationDeliveries.js';
import { notificationDeliveryRunSchema } from './validators.js';

export async function registerNotificationJobRoutes(app: FastifyInstance) {
  app.post(
    '/jobs/notification-deliveries/run',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: notificationDeliveryRunSchema,
    },
    async (req) => {
      const body = (req.body || {}) as { dryRun?: boolean; limit?: number };
      const result = await runNotificationEmailDeliveries({
        actorId: req.user?.userId,
        dryRun: body.dryRun,
        limit: body.limit,
      });

      await logAudit({
        action: 'notification_deliveries_run',
        targetTable: 'app_notification_deliveries',
        metadata: {
          channel: 'email',
          dryRun: result.dryRun,
          created: result.created,
          processed: result.processed,
          counts: result.counts,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, { source: 'job' }),
      });

      return result;
    },
  );
}
