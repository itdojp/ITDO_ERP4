import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { runNotificationEmailDeliveries } from '../services/notificationDeliveries.js';
import { runDailyReportMissingNotifications } from '../services/dailyReportMissing.js';
import {
  dailyReportMissingRunSchema,
  notificationDeliveryRunSchema,
} from './validators.js';

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

  app.post(
    '/jobs/daily-report-missing/run',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: dailyReportMissingRunSchema,
    },
    async (req) => {
      const body = (req.body || {}) as {
        targetDate?: string;
        dryRun?: boolean;
      };
      const result = await runDailyReportMissingNotifications({
        targetDate: body.targetDate,
        dryRun: body.dryRun,
        actorId: req.user?.userId,
      });

      await logAudit({
        action: 'daily_report_missing_run',
        targetTable: 'app_notifications',
        metadata: {
          targetDate: result.targetDate,
          dryRun: result.dryRun,
          missingCount: result.missingCount,
          createdNotifications: result.createdNotifications,
          skippedExistingNotifications: result.skippedExistingNotifications,
          alerted: result.alerted,
          closedAlerts: result.closedAlerts,
          skipped: result.skipped,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, { source: 'job' }),
      });

      return result;
    },
  );
}
