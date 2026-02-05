import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { runNotificationEmailDeliveries } from '../services/notificationDeliveries.js';
import { runDailyReportMissingNotifications } from '../services/dailyReportMissing.js';
import { runChatAckReminders } from '../services/chatAckReminders.js';
import { runChatRoomAclMismatchAlerts } from '../services/chatRoomAclAlerts.js';
import { runLeaveUpcomingNotifications } from '../services/leaveUpcomingNotifications.js';
import {
  dailyReportMissingRunSchema,
  chatAckReminderRunSchema,
  chatRoomAclAlertRunSchema,
  notificationDeliveryRunSchema,
  leaveUpcomingRunSchema,
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
    '/jobs/chat-ack-reminders/run',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: chatAckReminderRunSchema,
    },
    async (req) => {
      const body = (req.body || {}) as { dryRun?: boolean; limit?: number };
      const result = await runChatAckReminders({
        actorId: req.user?.userId,
        dryRun: body.dryRun,
        limit: body.limit,
      });

      await logAudit({
        action: 'chat_ack_reminders_run',
        targetTable: 'app_notifications',
        metadata: result as unknown as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, { source: 'job' }),
      });

      return result;
    },
  );

  app.post(
    '/jobs/chat-room-acl-alerts/run',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: chatRoomAclAlertRunSchema,
    },
    async (req) => {
      const body = (req.body || {}) as { dryRun?: boolean; limit?: number };
      const result = await runChatRoomAclMismatchAlerts({
        actorId: req.user?.userId,
        dryRun: body.dryRun,
        limit: body.limit,
      });

      await logAudit({
        action: 'chat_room_acl_alerts_run',
        targetTable: 'app_notifications',
        metadata: result as unknown as Prisma.InputJsonValue,
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

  app.post(
    '/jobs/leave-upcoming/run',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: leaveUpcomingRunSchema,
    },
    async (req) => {
      const body = (req.body || {}) as {
        targetDate?: string;
        dryRun?: boolean;
      };
      const result = await runLeaveUpcomingNotifications({
        targetDate: body.targetDate,
        dryRun: body.dryRun,
        actorId: req.user?.userId,
      });

      await logAudit({
        action: 'leave_upcoming_run',
        targetTable: 'app_notifications',
        metadata: {
          targetDate: result.targetDate,
          dryRun: result.dryRun,
          matchedCount: result.matchedCount,
          createdNotifications: result.createdNotifications,
          skippedExistingNotifications: result.skippedExistingNotifications,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req, { source: 'job' }),
      });

      return result;
    },
  );
}
