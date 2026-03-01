import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { parseDateParam } from '../utils/date.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  computePaidLeaveBalance,
  GENERAL_AFFAIRS_GROUP_ACCOUNT_ID,
  resolveLeaveRequestMinutesWithCalendar,
} from '../services/leaveEntitlements.js';
import {
  leaveEntitlementBalanceQuerySchema,
  leaveEntitlementProfileUpsertSchema,
  leaveGrantCreateSchema,
  leaveGrantListQuerySchema,
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
}
