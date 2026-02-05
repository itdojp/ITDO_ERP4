import { FastifyInstance } from 'fastify';
import { dailyReportSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import {
  isWithinEditableDays,
  parseDateParam,
  toDateOnly,
} from '../utils/date.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { getEditableDays } from '../services/worklogSetting.js';
import { createDailyReportNotifications } from '../services/appNotifications.js';

export async function registerDailyReportRoutes(app: FastifyInstance) {
  app.post(
    '/daily-reports',
    {
      schema: dailyReportSchema,
      preHandler: requireRole(['admin', 'mgmt', 'user']),
    },
    async (req, reply) => {
      const body = req.body as any;
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        body.userId = currentUserId;
      }
      const parsedReportDate = parseDateParam(body.reportDate);
      if (!parsedReportDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid reportDate' },
        });
      }
      const reportDate = toDateOnly(parsedReportDate);
      const editableDays = await getEditableDays();
      const isEditableByDate = isWithinEditableDays(reportDate, editableDays);
      if (!isEditableByDate && !isPrivileged) {
        return reply.status(403).send({
          error: {
            code: 'WORKLOG_LOCKED',
            message: 'Daily report is locked for modification',
            details: { editableDays, editWindowExpired: true },
          },
        });
      }
      if (!isEditableByDate && isPrivileged && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'REASON_REQUIRED',
            message: 'reasonText is required for override',
          },
        });
      }
      const actorId = req.user?.userId ?? null;
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.dailyReport.findUnique({
          where: { userId_reportDate: { userId: body.userId, reportDate } },
        });
        if (!existing) {
          const created = await tx.dailyReport.create({
            data: {
              userId: body.userId,
              reportDate,
              content: body.content,
              linkedProjectIds:
                body.linkedProjectIds?.length > 0
                  ? body.linkedProjectIds
                  : undefined,
              status: body.status ?? undefined,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
          await tx.dailyReportRevision.create({
            data: {
              dailyReportId: created.id,
              version: 1,
              content: created.content,
              linkedProjectIds: created.linkedProjectIds ?? undefined,
              status: created.status ?? undefined,
              reasonText: reasonText || undefined,
              createdBy: actorId,
            },
          });
          return { report: created, created: true };
        }
        const latest = await tx.dailyReportRevision.findFirst({
          where: { dailyReportId: existing.id },
          orderBy: { version: 'desc' },
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        const updated = await tx.dailyReport.update({
          where: { id: existing.id },
          data: {
            content: body.content,
            linkedProjectIds:
              body.linkedProjectIds?.length > 0
                ? body.linkedProjectIds
                : undefined,
            status: body.status ?? undefined,
            updatedBy: actorId,
          },
        });
        await tx.dailyReportRevision.create({
          data: {
            dailyReportId: updated.id,
            version: nextVersion,
            content: updated.content,
            linkedProjectIds: updated.linkedProjectIds ?? undefined,
            status: updated.status ?? undefined,
            reasonText: reasonText || undefined,
            createdBy: actorId,
          },
        });
        return { report: updated, created: false };
      });

      await logAudit({
        action: result.created
          ? 'daily_report_created'
          : 'daily_report_updated',
        targetTable: 'daily_reports',
        targetId: result.report.id,
        reasonText: reasonText || undefined,
        metadata: {
          reportDate: reportDate.toISOString().slice(0, 10),
          editableDays,
          editWindowExpired: !isEditableByDate,
        },
        ...auditContextFromRequest(req),
      });
      await createDailyReportNotifications({
        userId: result.report.userId,
        reportDate: reportDate.toISOString().slice(0, 10),
        actorUserId: actorId,
        kind: result.created
          ? 'daily_report_submitted'
          : 'daily_report_updated',
      });
      return result.report;
    },
  );

  app.get(
    '/daily-reports',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { userId, reportDate, from, to } = req.query as {
        userId?: string;
        reportDate?: string;
        from?: string;
        to?: string;
      };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const where: { userId?: string; reportDate?: any } = {};
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        where.userId = currentUserId;
      } else if (userId) {
        where.userId = userId;
      }
      if (reportDate) {
        const parsed = parseDateParam(reportDate);
        if (!parsed) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid reportDate' },
          });
        }
        where.reportDate = toDateOnly(parsed);
      } else if (from || to) {
        const range: { gte?: Date; lte?: Date } = {};
        if (from) {
          const parsedFrom = parseDateParam(from);
          if (!parsedFrom) {
            return reply.status(400).send({
              error: { code: 'INVALID_DATE', message: 'Invalid from' },
            });
          }
          range.gte = toDateOnly(parsedFrom);
        }
        if (to) {
          const parsedTo = parseDateParam(to);
          if (!parsedTo) {
            return reply.status(400).send({
              error: { code: 'INVALID_DATE', message: 'Invalid to' },
            });
          }
          range.lte = toDateOnly(parsedTo);
        }
        where.reportDate = range;
      }
      const reports = await prisma.dailyReport.findMany({
        where,
        orderBy: { reportDate: 'desc' },
        take: 50,
      });
      return { items: reports };
    },
  );

  app.get(
    '/daily-reports/:id/revisions',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const report = await prisma.dailyReport.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!report) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Daily report not found' },
        });
      }
      if (!isPrivileged && report.userId !== currentUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }
      const items = await prisma.dailyReportRevision.findMany({
        where: { dailyReportId: id },
        orderBy: { version: 'desc' },
        take: 30,
      });
      return { items };
    },
  );
}
