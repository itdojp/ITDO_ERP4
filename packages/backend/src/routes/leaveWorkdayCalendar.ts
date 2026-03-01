import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { parseDateParam, toDateOnly } from '../utils/date.js';
import {
  leaveCompanyHolidayListQuerySchema,
  leaveCompanyHolidayUpsertSchema,
  leaveWorkdayOverrideListQuerySchema,
  leaveWorkdayOverrideUpsertSchema,
} from './validators.js';

function parseLimit(value: unknown, fallback: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function normalizeDateOnly(value: unknown) {
  const parsed = parseDateParam(
    typeof value === 'string' ? value.trim() : undefined,
  );
  return parsed ? toDateOnly(parsed) : null;
}

function isPrivilegedLeaveCalendarRole(roles: string[]) {
  return (
    roles.includes('admin') || roles.includes('mgmt') || roles.includes('hr')
  );
}

export async function registerLeaveWorkdayCalendarRoutes(app: FastifyInstance) {
  app.get(
    '/leave-calendar/company-holidays',
    {
      preHandler: requireRole(['admin', 'mgmt', 'hr', 'user']),
      schema: leaveCompanyHolidayListQuerySchema,
    },
    async (req, reply) => {
      const { from, to, limit } = req.query as {
        from?: string;
        to?: string;
        limit?: number;
      };
      const fromDate = normalizeDateOnly(from);
      const toDate = normalizeDateOnly(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'from must be a valid date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'to must be a valid date' },
        });
      }
      if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'from must be less than or equal to to',
          },
        });
      }

      const where = {
        ...(fromDate || toDate
          ? {
              holidayDate: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate
                  ? { lt: new Date(toDate.getTime() + 24 * 60 * 60 * 1000) }
                  : {}),
              },
            }
          : {}),
      };
      const rows = await prisma.leaveCompanyHoliday.findMany({
        where,
        orderBy: { holidayDate: 'asc' },
        take: parseLimit(limit, 180, 366),
      });
      return { items: rows };
    },
  );

  app.post(
    '/leave-calendar/company-holidays',
    {
      preHandler: requireRole(['admin', 'mgmt', 'hr']),
      schema: leaveCompanyHolidayUpsertSchema,
    },
    async (req, reply) => {
      const actorId = req.user?.userId ?? null;
      const body = req.body as { holidayDate: string; name?: string };
      const holidayDate = normalizeDateOnly(body.holidayDate);
      if (!holidayDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'holidayDate must be a valid date',
          },
        });
      }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const row = await prisma.leaveCompanyHoliday.upsert({
        where: { holidayDate },
        create: {
          holidayDate,
          name: name || null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          name: name || null,
          updatedBy: actorId,
        },
      });
      await logAudit({
        action: 'leave_company_holiday_upserted',
        targetTable: 'leave_company_holidays',
        targetId: row.id,
        metadata: {
          holidayDate: row.holidayDate.toISOString().slice(0, 10),
          name: row.name,
        },
        ...auditContextFromRequest(req),
      });
      return row;
    },
  );

  app.delete(
    '/leave-calendar/company-holidays/:holidayDate',
    { preHandler: requireRole(['admin', 'mgmt', 'hr']) },
    async (req, reply) => {
      const actorId = req.user?.userId ?? null;
      const { holidayDate: holidayDateRaw } = req.params as {
        holidayDate: string;
      };
      const holidayDate = normalizeDateOnly(holidayDateRaw);
      if (!holidayDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'holidayDate must be a valid date',
          },
        });
      }
      const existing = await prisma.leaveCompanyHoliday.findUnique({
        where: { holidayDate },
      });
      if (!existing) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Company holiday not found' },
        });
      }
      await prisma.leaveCompanyHoliday.delete({ where: { holidayDate } });
      await logAudit({
        action: 'leave_company_holiday_deleted',
        targetTable: 'leave_company_holidays',
        targetId: existing.id,
        metadata: {
          holidayDate: existing.holidayDate.toISOString().slice(0, 10),
          updatedBy: actorId,
        },
        ...auditContextFromRequest(req),
      });
      return { ok: true };
    },
  );

  app.get(
    '/leave-calendar/workday-overrides',
    {
      preHandler: requireRole(['admin', 'mgmt', 'hr', 'user']),
      schema: leaveWorkdayOverrideListQuerySchema,
    },
    async (req, reply) => {
      const {
        userId: requestedUserId,
        from,
        to,
        limit,
      } = req.query as {
        userId?: string;
        from?: string;
        to?: string;
        limit?: number;
      };
      const actorUserId = req.user?.userId ?? null;
      const roles = req.user?.roles || [];
      const isPrivileged = isPrivilegedLeaveCalendarRole(roles);

      const targetUserId = (requestedUserId || actorUserId || '').trim();
      if (!targetUserId) {
        return reply.status(400).send({
          error: { code: 'INVALID_USER', message: 'userId is required' },
        });
      }
      if (!isPrivileged && actorUserId !== targetUserId) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
      }

      const fromDate = normalizeDateOnly(from);
      const toDate = normalizeDateOnly(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'from must be a valid date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'to must be a valid date' },
        });
      }
      if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'from must be less than or equal to to',
          },
        });
      }

      const rows = await prisma.leaveWorkdayOverride.findMany({
        where: {
          userId: targetUserId,
          ...(fromDate || toDate
            ? {
                workDate: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate
                    ? { lt: new Date(toDate.getTime() + 24 * 60 * 60 * 1000) }
                    : {}),
                },
              }
            : {}),
        },
        orderBy: { workDate: 'asc' },
        take: parseLimit(limit, 180, 366),
      });
      return { items: rows };
    },
  );

  app.post(
    '/leave-calendar/workday-overrides',
    {
      preHandler: requireRole(['admin', 'mgmt', 'hr']),
      schema: leaveWorkdayOverrideUpsertSchema,
    },
    async (req, reply) => {
      const actorId = req.user?.userId ?? null;
      const body = req.body as {
        userId: string;
        workDate: string;
        workMinutes: number;
        reasonText?: string;
      };
      const userId = body.userId.trim();
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'INVALID_USER', message: 'userId is required' },
        });
      }
      const workDate = normalizeDateOnly(body.workDate);
      if (!workDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'workDate must be a valid date',
          },
        });
      }
      const workMinutes = Math.max(
        0,
        Math.min(24 * 60, Math.floor(body.workMinutes)),
      );
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      const row = await prisma.leaveWorkdayOverride.upsert({
        where: { userId_workDate: { userId, workDate } },
        create: {
          userId,
          workDate,
          workMinutes,
          reasonText: reasonText || null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          workMinutes,
          reasonText: reasonText || null,
          updatedBy: actorId,
        },
      });
      await logAudit({
        action: 'leave_workday_override_upserted',
        targetTable: 'leave_workday_overrides',
        targetId: row.id,
        metadata: {
          userId: row.userId,
          workDate: row.workDate.toISOString().slice(0, 10),
          workMinutes: row.workMinutes,
        },
        ...auditContextFromRequest(req),
      });
      return row;
    },
  );

  app.delete(
    '/leave-calendar/workday-overrides/:id',
    { preHandler: requireRole(['admin', 'mgmt', 'hr']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await prisma.leaveWorkdayOverride.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Workday override not found' },
        });
      }
      await prisma.leaveWorkdayOverride.delete({ where: { id } });
      await logAudit({
        action: 'leave_workday_override_deleted',
        targetTable: 'leave_workday_overrides',
        targetId: existing.id,
        metadata: {
          userId: existing.userId,
          workDate: existing.workDate.toISOString().slice(0, 10),
        },
        ...auditContextFromRequest(req),
      });
      return { ok: true };
    },
  );
}
