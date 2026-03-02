import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { diffInDays, parseDateParam, toDateOnly } from '../utils/date.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { sendCsv, toCsv } from '../utils/csv.js';
import {
  computePaidLeaveBalance,
  GENERAL_AFFAIRS_GROUP_ACCOUNT_ID,
  resolveLeaveRequestMinutesWithCalendar,
} from '../services/leaveEntitlements.js';
import { ensureLeaveSetting } from '../services/leaveSettings.js';
import {
  COMP_LEAVE_TYPES,
  computeCompLeaveBalance,
  expireCompLeaveGrants,
  normalizeCompLeaveType,
} from '../services/leaveCompGrants.js';
import {
  leaveCompBalanceQuerySchema,
  leaveCompGrantCreateSchema,
  leaveCompGrantListQuerySchema,
  leaveEntitlementBalanceQuerySchema,
  leaveEntitlementProfileUpsertSchema,
  leaveGrantCreateSchema,
  leaveGrantListQuerySchema,
  leaveHrLedgerQuerySchema,
  leaveHrSummaryQuerySchema,
} from './validators.js';

function normalizeListLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(300, Math.floor(value)));
}

function isPrivileged(roles: string[]) {
  return roles.includes('admin') || roles.includes('mgmt');
}

function hasGeneralAffairsGroup(req: FastifyRequest) {
  const groups = req.user?.groupAccountIds || [];
  return groups.includes(GENERAL_AFFAIRS_GROUP_ACCOUNT_ID);
}

function resolveTargetUserId(options: {
  requestedUserId?: string;
  currentUserId?: string | null;
  privileged: boolean;
}) {
  const requested = (options.requestedUserId || '').trim();
  if (options.privileged) {
    return requested || (options.currentUserId ?? null);
  }
  return options.currentUserId ?? null;
}

function normalizeDateOnlyString(value: Date | null | undefined) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function normalizeBoundedInt(
  value: unknown,
  defaultValue: number,
  minValue: number,
  maxValue: number,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.min(maxValue, Math.max(minValue, Math.floor(value)));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

const MAX_HR_LEDGER_RANGE_DAYS = 366;

export async function registerLeaveEntitlementRoutes(app: FastifyInstance) {
  app.get(
    '/leave-entitlements/balance',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveEntitlementBalanceQuerySchema,
    },
    async (req, reply) => {
      const query = req.query as { userId?: string; leaveRequestId?: string };
      const roles = req.user?.roles || [];
      const privileged = isPrivileged(roles);
      const currentUserId = req.user?.userId ?? null;
      const requestedUserId = (query.userId || '').trim();
      const targetUserId = resolveTargetUserId({
        requestedUserId,
        currentUserId,
        privileged,
      });
      if (!targetUserId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_USER_ID',
            message: 'userId is required',
          },
        });
      }
      if (!privileged && requestedUserId && requestedUserId !== targetUserId) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      let additionalRequestedMinutes = 0;
      const leaveRequestId = (query.leaveRequestId || '').trim();
      if (leaveRequestId) {
        const leave = await prisma.leaveRequest.findUnique({
          where: { id: leaveRequestId },
          select: {
            id: true,
            userId: true,
            leaveType: true,
            status: true,
            startDate: true,
            endDate: true,
            hours: true,
            minutes: true,
            startTimeMinutes: true,
            endTimeMinutes: true,
          },
        });
        if (!leave || leave.userId !== targetUserId) {
          return reply.status(404).send({
            error: {
              code: 'LEAVE_REQUEST_NOT_FOUND',
              message: 'leaveRequestId was not found for target user',
            },
          });
        }
        if (
          leave.leaveType === 'paid' &&
          (leave.status === 'draft' || leave.status === 'rejected')
        ) {
          const setting = await prisma.leaveSetting.findUnique({
            where: { id: 'default' },
            select: { defaultWorkdayMinutes: true },
          });
          additionalRequestedMinutes =
            await resolveLeaveRequestMinutesWithCalendar({
              leave,
              userId: targetUserId,
              defaultWorkdayMinutes: setting?.defaultWorkdayMinutes ?? 480,
            });
        }
      }

      const balance = await computePaidLeaveBalance({
        userId: targetUserId,
        additionalRequestedMinutes,
        actorId: req.user?.userId ?? null,
      });
      return balance;
    },
  );

  app.get(
    '/leave-entitlements/comp-balance',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveCompBalanceQuerySchema,
    },
    async (req, reply) => {
      const query = req.query as {
        userId?: string;
        leaveType?: string;
        asOfDate?: string;
      };
      const roles = req.user?.roles || [];
      const privileged = isPrivileged(roles);
      const currentUserId = req.user?.userId ?? null;
      const requestedUserId = (query.userId || '').trim();
      const targetUserId = resolveTargetUserId({
        requestedUserId,
        currentUserId,
        privileged,
      });
      if (!targetUserId) {
        return reply.status(400).send({
          error: { code: 'INVALID_USER_ID', message: 'userId is required' },
        });
      }
      if (!privileged && requestedUserId && requestedUserId !== targetUserId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const leaveType = normalizeCompLeaveType(query.leaveType);
      if (query.leaveType !== undefined && !leaveType) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LEAVE_TYPE',
            message: 'leaveType must be compensatory or substitute',
          },
        });
      }
      const asOfDateRaw = (query.asOfDate || '').trim();
      const asOfDate = asOfDateRaw ? parseDateParam(asOfDateRaw) : new Date();
      if (!asOfDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'asOfDate must be YYYY-MM-DD',
          },
        });
      }
      const targets = leaveType ? [leaveType] : [...COMP_LEAVE_TYPES];
      const items = await Promise.all(
        targets.map((targetLeaveType) =>
          computeCompLeaveBalance({
            userId: targetUserId,
            leaveType: targetLeaveType,
            asOfDate,
            actorId: req.user?.userId ?? null,
          }),
        ),
      );
      return {
        userId: targetUserId,
        asOfDate: asOfDate.toISOString().slice(0, 10),
        items,
      };
    },
  );

  app.get(
    '/leave-entitlements/comp-grants',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveCompGrantListQuerySchema,
    },
    async (req, reply) => {
      const query = req.query as {
        userId?: string;
        leaveType?: string;
        limit?: number;
      };
      const roles = req.user?.roles || [];
      const privileged = isPrivileged(roles);
      const currentUserId = req.user?.userId ?? null;
      const requestedUserId = (query.userId || '').trim();
      const targetUserId = resolveTargetUserId({
        requestedUserId,
        currentUserId,
        privileged,
      });
      if (!targetUserId) {
        return reply.status(400).send({
          error: { code: 'INVALID_USER_ID', message: 'userId is required' },
        });
      }
      if (!privileged && requestedUserId && requestedUserId !== targetUserId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const leaveType = normalizeCompLeaveType(query.leaveType);
      if (query.leaveType !== undefined && !leaveType) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LEAVE_TYPE',
            message: 'leaveType must be compensatory or substitute',
          },
        });
      }
      await expireCompLeaveGrants({
        actorId: req.user?.userId ?? null,
      });
      const take = normalizeListLimit(query.limit);
      const items = await prisma.leaveCompGrant.findMany({
        where: {
          userId: targetUserId,
          ...(leaveType ? { leaveType } : {}),
        },
        select: {
          id: true,
          userId: true,
          leaveType: true,
          sourceDate: true,
          grantDate: true,
          expiresAt: true,
          grantedMinutes: true,
          remainingMinutes: true,
          status: true,
          reasonText: true,
          sourceTimeEntryIds: true,
          consumedAt: true,
          expiredAt: true,
          revokedAt: true,
          createdAt: true,
          createdBy: true,
        },
        orderBy: [
          { expiresAt: 'asc' },
          { sourceDate: 'asc' },
          { createdAt: 'asc' },
        ],
        take,
      });
      return { items };
    },
  );

  app.post(
    '/leave-entitlements/comp-grants',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveCompGrantCreateSchema,
    },
    async (req, reply) => {
      if (!hasGeneralAffairsGroup(req)) {
        return reply.status(403).send({
          error: {
            code: 'GENERAL_AFFAIRS_REQUIRED',
            message: 'general_affairs group membership is required',
          },
        });
      }
      const body = req.body as {
        userId: string;
        leaveType: string;
        sourceDate: string;
        grantDate?: string;
        expiresAt: string;
        grantedMinutes: number;
        reasonText: string;
        sourceTimeEntryIds?: string[];
      };
      const userId = body.userId.trim();
      const leaveType = normalizeCompLeaveType(body.leaveType);
      const reasonText = body.reasonText.trim();
      if (!userId || !leaveType || !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'userId, leaveType, reasonText are required',
          },
        });
      }
      const sourceDate = parseDateParam(body.sourceDate);
      const grantDateRaw =
        typeof body.grantDate === 'string' ? body.grantDate.trim() : '';
      const grantDate = grantDateRaw
        ? parseDateParam(grantDateRaw)
        : sourceDate;
      const expiresAt = parseDateParam(body.expiresAt);
      if (!sourceDate || !grantDate || !expiresAt) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'sourceDate/grantDate/expiresAt must be YYYY-MM-DD',
          },
        });
      }
      if (grantDate.getTime() < sourceDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'grantDate must be equal to or after sourceDate',
          },
        });
      }
      const effectiveStartTime = Math.max(
        sourceDate.getTime(),
        grantDate.getTime(),
      );
      if (expiresAt.getTime() < effectiveStartTime) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'expiresAt must be equal to or after sourceDate/grantDate',
          },
        });
      }
      const grantedMinutes = Math.floor(Number(body.grantedMinutes));
      if (!Number.isFinite(grantedMinutes) || grantedMinutes < 1) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'grantedMinutes must be a positive integer',
          },
        });
      }
      const sourceTimeEntryIds = Array.from(
        new Set(
          Array.isArray(body.sourceTimeEntryIds)
            ? body.sourceTimeEntryIds
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
            : [],
        ),
      );
      if (sourceTimeEntryIds.length > 0) {
        const entries = await prisma.timeEntry.findMany({
          where: { id: { in: sourceTimeEntryIds } },
          select: {
            id: true,
            userId: true,
            workDate: true,
            status: true,
            deletedAt: true,
          },
        });
        if (entries.length !== sourceTimeEntryIds.length) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_SOURCE_TIME_ENTRIES',
              message: 'some sourceTimeEntryIds were not found',
            },
          });
        }
        const sourceDateKey = normalizeDateOnlyString(sourceDate);
        const invalid = entries.some((entry) => {
          if (entry.deletedAt) return true;
          if (entry.userId !== userId) return true;
          if (entry.status !== 'approved') return true;
          return normalizeDateOnlyString(entry.workDate) !== sourceDateKey;
        });
        if (invalid) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_SOURCE_TIME_ENTRIES',
              message:
                'sourceTimeEntryIds must be approved entries for the same user/sourceDate',
            },
          });
        }
      }
      const actorId = req.user?.userId ?? null;
      const grant = await prisma.leaveCompGrant.create({
        data: {
          userId,
          leaveType,
          sourceDate,
          grantDate,
          expiresAt,
          grantedMinutes,
          remainingMinutes: grantedMinutes,
          status: 'active',
          reasonText,
          sourceTimeEntryIds:
            sourceTimeEntryIds.length > 0 ? sourceTimeEntryIds : undefined,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await logAudit({
        action: 'leave_comp_grant_created',
        targetTable: 'leave_comp_grants',
        targetId: grant.id,
        reasonText,
        metadata: {
          userId,
          leaveType,
          sourceDate: sourceDate.toISOString().slice(0, 10),
          grantDate: grantDate.toISOString().slice(0, 10),
          expiresAt: expiresAt.toISOString().slice(0, 10),
          grantedMinutes,
          sourceTimeEntryIds,
        },
        ...auditContextFromRequest(req),
      });
      return grant;
    },
  );

  app.get(
    '/leave-entitlements/grants',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveGrantListQuerySchema,
    },
    async (req, reply) => {
      const query = req.query as { userId?: string; limit?: number };
      const roles = req.user?.roles || [];
      const privileged = isPrivileged(roles);
      const currentUserId = req.user?.userId ?? null;
      const requestedUserId = (query.userId || '').trim();
      const targetUserId = resolveTargetUserId({
        requestedUserId,
        currentUserId,
        privileged,
      });
      if (!targetUserId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_USER_ID',
            message: 'userId is required',
          },
        });
      }
      if (!privileged && requestedUserId && requestedUserId !== targetUserId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const take = normalizeListLimit(query.limit);
      const items = await prisma.leaveGrant.findMany({
        where: { userId: targetUserId },
        select: {
          id: true,
          userId: true,
          profileId: true,
          grantDate: true,
          expiresAt: true,
          grantedMinutes: true,
          reasonText: true,
          createdAt: true,
          createdBy: true,
        },
        orderBy: [{ grantDate: 'desc' }, { createdAt: 'desc' }],
        take,
      });
      return { items };
    },
  );

  app.post(
    '/leave-entitlements/profiles',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveEntitlementProfileUpsertSchema,
    },
    async (req, reply) => {
      if (!hasGeneralAffairsGroup(req)) {
        return reply.status(403).send({
          error: {
            code: 'GENERAL_AFFAIRS_REQUIRED',
            message: 'general_affairs group membership is required',
          },
        });
      }

      const body = req.body as {
        userId: string;
        paidLeaveBaseDate: string;
        nextGrantDueDate?: string | null;
      };
      const userId = body.userId.trim();
      const paidLeaveBaseDate = parseDateParam(body.paidLeaveBaseDate);
      if (!userId || !paidLeaveBaseDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'userId and paidLeaveBaseDate are required',
          },
        });
      }

      const nextGrantDueDateRaw =
        typeof body.nextGrantDueDate === 'string'
          ? body.nextGrantDueDate.trim()
          : '';
      const nextGrantDueDate = nextGrantDueDateRaw
        ? parseDateParam(nextGrantDueDateRaw)
        : null;
      if (nextGrantDueDateRaw && !nextGrantDueDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'nextGrantDueDate must be YYYY-MM-DD',
          },
        });
      }

      const actorId = req.user?.userId ?? null;
      const profile = await prisma.leaveEntitlementProfile.upsert({
        where: { userId },
        create: {
          userId,
          paidLeaveBaseDate,
          nextGrantDueDate: nextGrantDueDate ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          paidLeaveBaseDate,
          nextGrantDueDate: nextGrantDueDate ?? null,
          updatedBy: actorId,
        },
      });
      const paidLeaveBaseDateStr = paidLeaveBaseDate.toISOString().slice(0, 10);
      const nextGrantDueDateStr = nextGrantDueDate
        ? nextGrantDueDate.toISOString().slice(0, 10)
        : null;

      await logAudit({
        action: 'leave_entitlement_profile_upserted',
        targetTable: 'leave_entitlement_profiles',
        targetId: profile.id,
        metadata: {
          userId,
          paidLeaveBaseDate: paidLeaveBaseDateStr,
          nextGrantDueDate: nextGrantDueDateStr,
        },
        ...auditContextFromRequest(req),
      });

      return profile;
    },
  );

  app.post(
    '/leave-entitlements/grants',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveGrantCreateSchema,
    },
    async (req, reply) => {
      if (!hasGeneralAffairsGroup(req)) {
        return reply.status(403).send({
          error: {
            code: 'GENERAL_AFFAIRS_REQUIRED',
            message: 'general_affairs group membership is required',
          },
        });
      }

      const body = req.body as {
        userId: string;
        grantedMinutes: number;
        grantDate?: string;
        expiresAt?: string | null;
        reasonText: string;
      };
      const userId = body.userId.trim();
      if (!userId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'userId is required',
          },
        });
      }
      const reasonText = body.reasonText.trim();
      if (!reasonText) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'reasonText is required',
          },
        });
      }

      const grantedMinutes = Math.floor(Number(body.grantedMinutes));
      if (!Number.isInteger(grantedMinutes) || grantedMinutes < 1) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'grantedMinutes must be a positive integer',
          },
        });
      }

      const grantDate = body.grantDate?.trim()
        ? parseDateParam(body.grantDate.trim())
        : new Date();
      if (!grantDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'grantDate must be YYYY-MM-DD',
          },
        });
      }
      const expiresAtRaw =
        typeof body.expiresAt === 'string' ? body.expiresAt.trim() : '';
      const expiresAt = expiresAtRaw ? parseDateParam(expiresAtRaw) : null;
      if (expiresAtRaw && !expiresAt) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'expiresAt must be YYYY-MM-DD',
          },
        });
      }
      if (expiresAt && expiresAt.getTime() < grantDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'expiresAt must be equal to or after grantDate',
          },
        });
      }

      const profile = await prisma.leaveEntitlementProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!profile) {
        return reply.status(400).send({
          error: {
            code: 'LEAVE_ENTITLEMENT_PROFILE_REQUIRED',
            message:
              'Leave entitlement profile is required before adding grants',
          },
        });
      }

      const actorId = req.user?.userId ?? null;
      const grant = await prisma.leaveGrant.create({
        data: {
          profileId: profile.id,
          userId,
          grantDate,
          expiresAt,
          grantedMinutes,
          reasonText,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });

      await logAudit({
        action: 'leave_grant_created',
        targetTable: 'leave_grants',
        targetId: grant.id,
        reasonText,
        metadata: {
          userId,
          profileId: profile.id,
          grantDate: grantDate.toISOString().slice(0, 10),
          expiresAt: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
          grantedMinutes,
        },
        ...auditContextFromRequest(req),
      });

      const balance = await computePaidLeaveBalance({
        userId,
        actorId,
      });

      return { grant, balance };
    },
  );

  app.get(
    '/leave-entitlements/hr-summary',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveHrSummaryQuerySchema,
    },
    async (req, reply) => {
      if (!hasGeneralAffairsGroup(req)) {
        return reply.status(403).send({
          error: {
            code: 'GENERAL_AFFAIRS_REQUIRED',
            message: 'general_affairs group membership is required',
          },
        });
      }
      const query = req.query as {
        asOfDate?: string;
        staleDays?: number;
        expiringWithinDays?: number;
        limit?: number;
      };
      const asOfDateRaw = (query.asOfDate || '').trim();
      const asOfDate = asOfDateRaw ? parseDateParam(asOfDateRaw) : new Date();
      if (!asOfDate) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'asOfDate must be YYYY-MM-DD',
          },
        });
      }
      const asOf = toDateOnly(asOfDate);
      const staleDays = normalizeBoundedInt(query.staleDays, 14, 1, 365);
      const expiringWithinDays = normalizeBoundedInt(
        query.expiringWithinDays,
        60,
        1,
        365,
      );
      const limit = normalizeBoundedInt(query.limit, 50, 1, 200);
      const staleBefore = addDays(asOf, -staleDays);
      const expiringUntil = addDays(asOf, expiringWithinDays + 1);

      const [pendingTotal, stalePendingCount, stalePendingItems] =
        await Promise.all([
          prisma.leaveRequest.count({
            where: { status: 'pending_manager' },
          }),
          prisma.leaveRequest.count({
            where: {
              status: 'pending_manager',
              createdAt: { lt: staleBefore },
            },
          }),
          prisma.leaveRequest.findMany({
            where: {
              status: 'pending_manager',
              createdAt: { lt: staleBefore },
            },
            select: {
              id: true,
              userId: true,
              leaveType: true,
              startDate: true,
              endDate: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
          }),
        ]);
      const [paidExpiringItems, compExpiringItems] = await Promise.all([
        prisma.leaveGrant.findMany({
          where: {
            expiresAt: {
              not: null,
              gte: asOf,
              lt: expiringUntil,
            },
          },
          select: {
            id: true,
            userId: true,
            grantDate: true,
            expiresAt: true,
            grantedMinutes: true,
          },
          orderBy: { expiresAt: 'asc' },
          take: limit,
        }),
        prisma.leaveCompGrant.findMany({
          where: {
            status: 'active',
            expiresAt: {
              gte: asOf,
              lt: expiringUntil,
            },
          },
          select: {
            id: true,
            userId: true,
            leaveType: true,
            grantDate: true,
            expiresAt: true,
            remainingMinutes: true,
          },
          orderBy: { expiresAt: 'asc' },
          take: limit,
        }),
      ]);
      const paidExpiringMinutes = paidExpiringItems.reduce(
        (sum, item) => sum + Math.max(0, item.grantedMinutes),
        0,
      );
      const compExpiringMinutes = compExpiringItems.reduce(
        (sum, item) => sum + Math.max(0, item.remainingMinutes),
        0,
      );
      return {
        asOfDate: normalizeDateOnlyString(asOf),
        staleDays,
        expiringWithinDays,
        pending: {
          total: pendingTotal,
          stale: stalePendingCount,
          staleItems: stalePendingItems.map((item) => ({
            id: item.id,
            userId: item.userId,
            leaveType: item.leaveType,
            startDate: normalizeDateOnlyString(item.startDate),
            endDate: normalizeDateOnlyString(item.endDate),
            createdAt: item.createdAt.toISOString(),
          })),
        },
        expiring: {
          paidGrantCount: paidExpiringItems.length,
          paidGrantUpperBoundMinutes: paidExpiringMinutes,
          paidGrantItems: paidExpiringItems.map((item) => ({
            id: item.id,
            userId: item.userId,
            grantDate: normalizeDateOnlyString(item.grantDate),
            expiresAt: normalizeDateOnlyString(item.expiresAt),
            grantedUpperBoundMinutes: item.grantedMinutes,
          })),
          compGrantCount: compExpiringItems.length,
          compGrantRemainingMinutes: compExpiringMinutes,
          compGrantItems: compExpiringItems.map((item) => ({
            id: item.id,
            userId: item.userId,
            leaveType: item.leaveType,
            grantDate: normalizeDateOnlyString(item.grantDate),
            expiresAt: normalizeDateOnlyString(item.expiresAt),
            remainingMinutes: item.remainingMinutes,
          })),
        },
      };
    },
  );

  app.get(
    '/leave-entitlements/hr-ledger',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveHrLedgerQuerySchema,
    },
    async (req, reply) => {
      if (!hasGeneralAffairsGroup(req)) {
        return reply.status(403).send({
          error: {
            code: 'GENERAL_AFFAIRS_REQUIRED',
            message: 'general_affairs group membership is required',
          },
        });
      }
      const query = req.query as {
        userId?: string;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
        format?: 'json' | 'csv';
      };
      const format = query.format === 'csv' ? 'csv' : 'json';
      const from = query.from?.trim()
        ? parseDateParam(query.from.trim())
        : null;
      const to = query.to?.trim() ? parseDateParam(query.to.trim()) : null;
      if ((query.from && !from) || (query.to && !to)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'from/to must be YYYY-MM-DD',
          },
        });
      }
      const toDateOnlyDefault = toDateOnly(new Date());
      const rangeTo = to ? toDateOnly(to) : toDateOnlyDefault;
      const rangeFrom = from ? toDateOnly(from) : addDays(rangeTo, -90);
      if (rangeFrom.getTime() > rangeTo.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'from must be equal to or before to',
          },
        });
      }
      const rangeDays = diffInDays(rangeFrom, rangeTo);
      if (rangeDays > MAX_HR_LEDGER_RANGE_DAYS) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: `from/to range must be within ${MAX_HR_LEDGER_RANGE_DAYS} days`,
          },
        });
      }
      const rangeToExclusive = addDays(rangeTo, 1);
      const limit = normalizeBoundedInt(query.limit, 500, 1, 2000);
      const offset = normalizeBoundedInt(query.offset, 0, 0, 100000);
      const userId = (query.userId || '').trim();

      const [paidGrants, approvedPaidLeaves, expiringPaidGrants] =
        await Promise.all([
          prisma.leaveGrant.findMany({
            where: {
              ...(userId ? { userId } : {}),
              grantDate: { gte: rangeFrom, lt: rangeToExclusive },
            },
            select: {
              id: true,
              userId: true,
              grantDate: true,
              expiresAt: true,
              grantedMinutes: true,
              reasonText: true,
            },
            orderBy: [{ grantDate: 'asc' }, { id: 'asc' }],
          }),
          prisma.leaveRequest.findMany({
            where: {
              ...(userId ? { userId } : {}),
              status: 'approved',
              leaveType: 'paid',
              startDate: { lt: rangeToExclusive },
              endDate: { gte: rangeFrom },
            },
            select: {
              id: true,
              userId: true,
              leaveType: true,
              startDate: true,
              endDate: true,
              hours: true,
              minutes: true,
              startTimeMinutes: true,
              endTimeMinutes: true,
              notes: true,
            },
            orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
          }),
          prisma.leaveGrant.findMany({
            where: {
              ...(userId ? { userId } : {}),
              expiresAt: { not: null, gte: rangeFrom, lt: rangeToExclusive },
            },
            select: {
              id: true,
              userId: true,
              expiresAt: true,
              grantedMinutes: true,
            },
            orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          }),
        ]);
      const leaveSetting = await ensureLeaveSetting({
        actorId: req.user?.userId ?? null,
      });
      const workdayMinutesCacheByUser = new Map<string, Map<string, number>>();
      const usageRows = await Promise.all(
        approvedPaidLeaves.map(async (leave) => {
          const cache =
            workdayMinutesCacheByUser.get(leave.userId) ??
            new Map<string, number>();
          workdayMinutesCacheByUser.set(leave.userId, cache);
          const minutes = await resolveLeaveRequestMinutesWithCalendar({
            leave,
            userId: leave.userId,
            defaultWorkdayMinutes: leaveSetting.defaultWorkdayMinutes,
            workdayMinutesCache: cache,
          });
          return {
            eventDate: normalizeDateOnlyString(leave.startDate) || '',
            userId: leave.userId,
            eventType: 'usage',
            direction: 'debit',
            minutes,
            sourceTable: 'leave_requests',
            sourceId: leave.id,
            expiresAt: null as string | null,
            note: leave.notes || null,
          };
        }),
      );
      const ledgerRows = [
        ...paidGrants.map((grant) => ({
          eventDate: normalizeDateOnlyString(grant.grantDate) || '',
          userId: grant.userId,
          eventType: 'grant',
          direction: 'credit',
          minutes: grant.grantedMinutes,
          sourceTable: 'leave_grants',
          sourceId: grant.id,
          expiresAt: normalizeDateOnlyString(grant.expiresAt),
          note: grant.reasonText || null,
        })),
        ...usageRows,
        ...expiringPaidGrants.map((grant) => ({
          eventDate: normalizeDateOnlyString(grant.expiresAt) || '',
          userId: grant.userId,
          eventType: 'expiry_scheduled',
          direction: 'upper_bound_debit',
          minutes: grant.grantedMinutes,
          sourceTable: 'leave_grants',
          sourceId: grant.id,
          expiresAt: normalizeDateOnlyString(grant.expiresAt),
          note: 'Upper bound based on granted minutes; actual expired minutes may be lower.' as
            | string
            | null,
        })),
      ].sort((left, right) => {
        if (left.eventDate !== right.eventDate) {
          return left.eventDate.localeCompare(right.eventDate);
        }
        if (left.userId !== right.userId) {
          return left.userId.localeCompare(right.userId);
        }
        return left.sourceId.localeCompare(right.sourceId);
      });
      const totalCount = ledgerRows.length;
      const pagedRows = ledgerRows.slice(offset, offset + limit);
      if (format === 'csv') {
        const headers = [
          'eventDate',
          'userId',
          'eventType',
          'direction',
          'minutes',
          'sourceTable',
          'sourceId',
          'expiresAt',
          'note',
        ];
        const rows = pagedRows.map((item) => [
          item.eventDate,
          item.userId,
          item.eventType,
          item.direction,
          item.minutes,
          item.sourceTable,
          item.sourceId,
          item.expiresAt,
          item.note,
        ]);
        const csv = toCsv(headers, rows);
        const filename = `leave-ledger-${normalizeDateOnlyString(rangeFrom)}-${normalizeDateOnlyString(rangeTo)}.csv`;
        return sendCsv(reply, filename, csv);
      }
      return {
        from: normalizeDateOnlyString(rangeFrom),
        to: normalizeDateOnlyString(rangeTo),
        totalCount,
        limit,
        offset,
        items: pagedRows,
      };
    },
  );
}
