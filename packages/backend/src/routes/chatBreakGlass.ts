import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { hasProjectAccess, requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { ensureChatRoomContentAccess } from '../services/chatRoomAccess.js';
import {
  chatBreakGlassRejectSchema,
  chatBreakGlassRequestSchema,
} from './validators.js';
import { parseLimit } from './chat/shared/inputParsers.js';
import { parseDateParam } from '../utils/date.js';

function resolveEffectiveApproverRole(roles: string[]) {
  if (roles.includes('exec')) return 'exec';
  if (roles.includes('mgmt')) return 'mgmt';
  return null;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export async function registerChatBreakGlassRoutes(app: FastifyInstance) {
  const allowedRoles = ['mgmt', 'exec'];
  const chatRoles = ['admin', 'mgmt', 'user', 'hr', 'exec', 'external_chat'];

  app.get(
    '/projects/:projectId/chat-break-glass-events',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (
        !roles.includes('exec') &&
        !hasProjectAccess(roles, projectIds, projectId)
      ) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }

      const items = await prisma.chatBreakGlassRequest.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          reasonCode: true,
          requesterUserId: true,
          viewerUserId: true,
          targetFrom: true,
          targetUntil: true,
          ttlHours: true,
          approved1At: true,
          approved2At: true,
          rejectedAt: true,
          grantedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { items };
    },
  );

  app.get(
    '/chat-rooms/:roomId/chat-break-glass-events',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const roles = req.user?.roles || [];
      const userId = req.user?.userId || '';

      const canSeeAllRooms =
        roles.includes('admin') ||
        roles.includes('mgmt') ||
        roles.includes('exec');
      if (!canSeeAllRooms) {
        if (!userId) {
          return reply.status(400).send({
            error: { code: 'MISSING_USER_ID', message: 'user id is required' },
          });
        }
        const projectIds = req.user?.projectIds || [];
        const groupIds = Array.isArray(req.user?.groupIds)
          ? req.user.groupIds
          : [];
        const groupAccountIds = Array.isArray(req.user?.groupAccountIds)
          ? req.user.groupAccountIds
          : [];
        const access = await ensureChatRoomContentAccess({
          roomId,
          userId,
          roles,
          projectIds,
          groupIds,
          groupAccountIds,
        });
        if (!access.ok) {
          return reply.status(access.reason === 'not_found' ? 404 : 403).send({
            error: {
              code:
                access.reason === 'not_found'
                  ? 'NOT_FOUND'
                  : access.reason === 'forbidden_project'
                    ? 'FORBIDDEN_PROJECT'
                    : access.reason === 'forbidden_external_room'
                      ? 'FORBIDDEN_EXTERNAL_ROOM'
                      : 'FORBIDDEN_ROOM_MEMBER',
              message: 'Access to this room is forbidden',
            },
          });
        }
      }

      const items = await prisma.chatBreakGlassRequest.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          reasonCode: true,
          requesterUserId: true,
          viewerUserId: true,
          targetFrom: true,
          targetUntil: true,
          ttlHours: true,
          approved1At: true,
          approved2At: true,
          rejectedAt: true,
          grantedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { items };
    },
  );

  app.post(
    '/chat-break-glass/requests',
    {
      schema: chatBreakGlassRequestSchema,
      preHandler: requireRole(allowedRoles),
    },
    async (req, reply) => {
      const roles = req.user?.roles || [];
      if (roles.includes('admin')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN_ROLE', message: 'admin cannot request' },
        });
      }
      const requesterUserId = req.user?.userId;
      if (!requesterUserId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const body = req.body as {
        projectId?: string;
        roomId?: string;
        viewerUserId?: string;
        reasonCode: string;
        reasonText: string;
        targetFrom?: string;
        targetUntil?: string;
        ttlHours?: number;
      };
      const projectId = body.projectId?.trim() || null;
      const roomId = body.roomId?.trim() || null;
      if (!projectId && !roomId) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_TARGET',
            message: 'projectId or roomId is required',
          },
        });
      }

      const now = new Date();
      const targetUntil = parseDateParam(body.targetUntil) || now;
      const targetFrom =
        parseDateParam(body.targetFrom) ||
        new Date(targetUntil.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (body.targetUntil && !parseDateParam(body.targetUntil)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'Invalid targetUntil date-time',
          },
        });
      }
      if (body.targetFrom && !parseDateParam(body.targetFrom)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'Invalid targetFrom date-time',
          },
        });
      }
      if (targetFrom.getTime() > targetUntil.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_RANGE',
            message: 'targetFrom must be <= targetUntil',
          },
        });
      }

      const ttlHoursRaw = body.ttlHours;
      const ttlHours =
        typeof ttlHoursRaw === 'number' && Number.isFinite(ttlHoursRaw)
          ? Math.floor(ttlHoursRaw)
          : 24;
      if (ttlHours < 1 || ttlHours > 168) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TTL',
            message: 'ttlHours must be between 1 and 168',
          },
        });
      }

      const viewerUserId = (
        body.viewerUserId?.trim() || requesterUserId
      ).trim();
      if (!viewerUserId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_VIEWER',
            message: 'viewerUserId is required',
          },
        });
      }

      const created = await prisma.chatBreakGlassRequest.create({
        data: {
          targetType: projectId ? 'project' : 'room',
          projectId,
          roomId,
          requesterUserId,
          viewerUserId,
          reasonCode: body.reasonCode.trim(),
          reasonText: body.reasonText.trim(),
          targetFrom,
          targetUntil,
          ttlHours,
          status: 'requested',
        },
      });

      await logAudit({
        action: 'chat_break_glass_requested',
        targetTable: 'chat_break_glass_requests',
        targetId: created.id,
        reasonCode: created.reasonCode,
        reasonText: created.reasonText,
        metadata: {
          targetType: created.targetType,
          projectId: created.projectId,
          roomId: created.roomId,
          requesterUserId: created.requesterUserId,
          viewerUserId: created.viewerUserId,
          targetFrom: created.targetFrom?.toISOString() || null,
          targetUntil: created.targetUntil?.toISOString() || null,
          ttlHours: created.ttlHours,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        id: created.id,
        status: created.status,
        targetType: created.targetType,
        projectId: created.projectId,
        roomId: created.roomId,
        requesterUserId: created.requesterUserId,
        viewerUserId: created.viewerUserId,
        reasonCode: created.reasonCode,
        targetFrom: created.targetFrom,
        targetUntil: created.targetUntil,
        ttlHours: created.ttlHours,
        createdAt: created.createdAt,
      };
    },
  );

  app.post(
    '/chat-break-glass/requests/:id/approve',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const roles = req.user?.roles || [];
      if (roles.includes('admin')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN_ROLE', message: 'admin cannot approve' },
        });
      }
      const approverUserId = req.user?.userId;
      if (!approverUserId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const approverRole = resolveEffectiveApproverRole(roles);
      if (!approverRole) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN_ROLE', message: 'role is not allowed' },
        });
      }

      const { id } = req.params as { id: string };
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.chatBreakGlassRequest.findUnique({
          where: { id },
        });
        if (!current) return null;
        if (current.status === 'rejected') {
          return { ok: false as const, error: 'already_rejected' as const };
        }
        if (current.status === 'approved') {
          return { ok: false as const, error: 'already_approved' as const };
        }
        if (current.requesterUserId === approverUserId) {
          return {
            ok: false as const,
            error: 'requester_cannot_approve' as const,
          };
        }
        if (
          current.approved1By === approverUserId ||
          current.approved2By === approverUserId
        ) {
          return { ok: false as const, error: 'duplicate_approver' as const };
        }

        if (!current.approved1By) {
          const next = await tx.chatBreakGlassRequest.update({
            where: { id },
            data: {
              approved1By: approverUserId,
              approved1Role: approverRole,
              approved1At: now,
            },
          });
          return { ok: true as const, request: next, step: 1 as const };
        }

        const firstRole = current.approved1Role;
        if (firstRole && firstRole === approverRole) {
          return {
            ok: false as const,
            error: 'same_role_not_allowed' as const,
          };
        }

        const grantedAt = now;
        const expiresAt = addHours(grantedAt, current.ttlHours);
        const next = await tx.chatBreakGlassRequest.update({
          where: { id },
          data: {
            approved2By: approverUserId,
            approved2Role: approverRole,
            approved2At: now,
            status: 'approved',
            grantedAt,
            expiresAt,
          },
        });
        return { ok: true as const, request: next, step: 2 as const };
      });

      if (!updated) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Request not found' },
        });
      }
      if (!updated.ok) {
        const code = updated.error;
        const status =
          code === 'already_rejected' || code === 'already_approved'
            ? 409
            : 400;
        return reply.status(status).send({
          error: { code: code.toUpperCase(), message: code },
        });
      }

      const request = updated.request;
      await logAudit({
        action: 'chat_break_glass_approved',
        targetTable: 'chat_break_glass_requests',
        targetId: request.id,
        reasonCode: request.reasonCode,
        metadata: {
          step: updated.step,
          approverUserId,
          approverRole,
          status: request.status,
          projectId: request.projectId,
          roomId: request.roomId,
          viewerUserId: request.viewerUserId,
          expiresAt: request.expiresAt?.toISOString() || null,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        id: request.id,
        status: request.status,
        approved1By: request.approved1By,
        approved1Role: request.approved1Role,
        approved1At: request.approved1At,
        approved2By: request.approved2By,
        approved2Role: request.approved2Role,
        approved2At: request.approved2At,
        grantedAt: request.grantedAt,
        expiresAt: request.expiresAt,
      };
    },
  );

  app.post(
    '/chat-break-glass/requests/:id/reject',
    {
      schema: chatBreakGlassRejectSchema,
      preHandler: requireRole(allowedRoles),
    },
    async (req, reply) => {
      const roles = req.user?.roles || [];
      if (roles.includes('admin')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN_ROLE', message: 'admin cannot reject' },
        });
      }
      const rejecterUserId = req.user?.userId;
      if (!rejecterUserId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const rejecterRole = resolveEffectiveApproverRole(roles);
      if (!rejecterRole) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN_ROLE', message: 'role is not allowed' },
        });
      }
      const body = req.body as { reason: string };
      const reason = body.reason.trim();
      if (!reason) {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'reason is required' },
        });
      }

      const { id } = req.params as { id: string };
      const now = new Date();
      const current = await prisma.chatBreakGlassRequest.findUnique({
        where: { id },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Request not found' },
        });
      }
      if (current.status === 'rejected') {
        return reply.status(409).send({
          error: { code: 'ALREADY_REJECTED', message: 'already_rejected' },
        });
      }
      if (current.status === 'approved') {
        return reply.status(409).send({
          error: { code: 'ALREADY_APPROVED', message: 'already_approved' },
        });
      }
      if (current.requesterUserId === rejecterUserId) {
        return reply.status(400).send({
          error: {
            code: 'REQUESTER_CANNOT_REJECT',
            message: 'requester_cannot_reject',
          },
        });
      }

      const updated = await prisma.chatBreakGlassRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedBy: rejecterUserId,
          rejectedRole: rejecterRole,
          rejectedAt: now,
          rejectedReason: reason,
        },
      });

      await logAudit({
        action: 'chat_break_glass_rejected',
        targetTable: 'chat_break_glass_requests',
        targetId: updated.id,
        reasonCode: updated.reasonCode,
        metadata: {
          rejecterUserId,
          rejecterRole,
          rejectedReason: reason,
          projectId: updated.projectId,
          roomId: updated.roomId,
          viewerUserId: updated.viewerUserId,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        id: updated.id,
        status: updated.status,
        rejectedBy: updated.rejectedBy,
        rejectedRole: updated.rejectedRole,
        rejectedAt: updated.rejectedAt,
      };
    },
  );

  app.get(
    '/chat-break-glass/requests',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const {
        status,
        projectId,
        roomId,
        viewerUserId,
        requesterUserId,
        since,
        until,
        limit,
      } = req.query as {
        status?: string;
        projectId?: string;
        roomId?: string;
        viewerUserId?: string;
        requesterUserId?: string;
        since?: string;
        until?: string;
        limit?: string;
      };

      const take = parseLimit(limit);
      if (!take) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LIMIT',
            message: 'limit must be a positive integer',
          },
        });
      }

      const sinceDate = parseDateParam(since);
      if (since && !sinceDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid since date-time' },
        });
      }
      const untilDate = parseDateParam(until);
      if (until && !untilDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid until date-time' },
        });
      }

      const where: Prisma.ChatBreakGlassRequestWhereInput = {};
      if (status) {
        where.status = status.trim();
      }
      if (projectId) {
        where.projectId = projectId.trim();
      }
      if (roomId) {
        where.roomId = roomId.trim();
      }
      if (viewerUserId) {
        where.viewerUserId = viewerUserId.trim();
      }
      if (requesterUserId) {
        where.requesterUserId = requesterUserId.trim();
      }
      if (sinceDate || untilDate) {
        where.createdAt = {
          ...(sinceDate ? { gte: sinceDate } : {}),
          ...(untilDate ? { lte: untilDate } : {}),
        };
      }

      const items = await prisma.chatBreakGlassRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          targetType: true,
          projectId: true,
          roomId: true,
          requesterUserId: true,
          viewerUserId: true,
          reasonCode: true,
          reasonText: true,
          targetFrom: true,
          targetUntil: true,
          ttlHours: true,
          status: true,
          approved1By: true,
          approved1Role: true,
          approved1At: true,
          approved2By: true,
          approved2Role: true,
          approved2At: true,
          rejectedBy: true,
          rejectedRole: true,
          rejectedAt: true,
          rejectedReason: true,
          grantedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { items };
    },
  );

  app.get(
    '/chat-break-glass/requests/:id/messages',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const roles = req.user?.roles || [];
      if (roles.includes('admin')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN_ROLE', message: 'admin cannot access' },
        });
      }
      const actorUserId = req.user?.userId;
      if (!actorUserId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }

      const { id } = req.params as { id: string };
      const request = await prisma.chatBreakGlassRequest.findUnique({
        where: { id },
      });
      if (!request) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Request not found' },
        });
      }
      if (request.viewerUserId !== actorUserId) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_VIEWER',
            message: 'Only the granted viewer can access',
          },
        });
      }
      if (request.status !== 'approved' || !request.expiresAt) {
        return reply.status(403).send({
          error: {
            code: 'NOT_GRANTED',
            message: 'Request is not approved',
          },
        });
      }
      const now = new Date();
      if (request.expiresAt.getTime() <= now.getTime()) {
        return reply.status(403).send({
          error: { code: 'EXPIRED', message: 'Request has expired' },
        });
      }
      let targetRoomId: string | null = null;
      if (request.targetType === 'project') {
        targetRoomId = request.projectId || null;
      } else if (request.targetType === 'room') {
        targetRoomId = request.roomId || null;
      } else {
        return reply.status(400).send({
          error: {
            code: 'UNSUPPORTED_TARGET',
            message: 'Only project/room target is supported',
          },
        });
      }
      if (!targetRoomId) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_TARGET',
            message: 'projectId or roomId is required',
          },
        });
      }

      const { limit, before, tag } = req.query as {
        limit?: string;
        before?: string;
        tag?: string;
      };
      const take = parseLimit(limit);
      if (!take) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LIMIT',
            message: 'limit must be a positive integer',
          },
        });
      }
      const beforeDate = parseDateParam(before);
      if (before && !beforeDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid before date' },
        });
      }

      const trimmedTag = typeof tag === 'string' ? tag.trim() : '';
      if (trimmedTag.length > 32) {
        return reply.status(400).send({
          error: { code: 'INVALID_TAG', message: 'Tag is too long' },
        });
      }

      const createdAt =
        request.targetFrom && request.targetUntil
          ? { gte: request.targetFrom, lte: request.targetUntil }
          : request.targetFrom
            ? { gte: request.targetFrom }
            : request.targetUntil
              ? { lte: request.targetUntil }
              : undefined;

      const where: Prisma.ChatMessageWhereInput = {
        roomId: targetRoomId,
        deletedAt: null,
        createdAt,
      };
      if (beforeDate) {
        where.createdAt = createdAt
          ? { ...createdAt, lt: beforeDate }
          : { lt: beforeDate };
      }
      if (trimmedTag) {
        where.tags = { array_contains: [trimmedTag] };
      }

      const items = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          ackRequest: { include: { acks: true } },
          attachments: {
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
              createdBy: true,
            },
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      await prisma.chatBreakGlassAccessLog.create({
        data: {
          requestId: request.id,
          actorUserId,
          action: 'view_messages',
          metadata: {
            targetType: request.targetType,
            projectId: request.projectId,
            roomId: request.roomId,
            targetFrom: request.targetFrom?.toISOString() || null,
            targetUntil: request.targetUntil?.toISOString() || null,
            before: beforeDate?.toISOString() || null,
            tag: trimmedTag || null,
            limit: take,
            returnedCount: items.length,
          } as Prisma.InputJsonValue,
        },
      });

      await logAudit({
        action: 'chat_break_glass_accessed',
        targetTable: 'chat_break_glass_requests',
        targetId: request.id,
        reasonCode: request.reasonCode,
        metadata: {
          actorUserId,
          action: 'view_messages',
          targetType: request.targetType,
          projectId: request.projectId,
          roomId: request.roomId,
          returnedCount: items.length,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return { items };
    },
  );
}
