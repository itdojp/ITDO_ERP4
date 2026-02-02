import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  groupCreateSchema,
  groupMemberChangeSchema,
  groupPatchSchema,
} from './validators.js';

function normalizeStringArray(
  value: unknown,
  options?: { dedupe?: boolean; max?: number },
) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  const deduped = options?.dedupe ? Array.from(new Set(items)) : items;
  return typeof options?.max === 'number'
    ? deduped.slice(0, options.max)
    : deduped;
}

async function resolveUserAccountIds(userKeys: string[]) {
  const unique = Array.from(
    new Set(userKeys.map((entry) => entry.trim()).filter(Boolean)),
  );
  if (!unique.length) {
    return { userAccountIds: [], missing: [] as string[] };
  }
  const accounts = await prisma.userAccount.findMany({
    where: {
      OR: [{ id: { in: unique } }, { userName: { in: unique } }],
    },
    select: { id: true, userName: true },
  });
  const idMap = new Map<string, string>();
  for (const account of accounts) {
    idMap.set(account.id, account.id);
    idMap.set(account.userName, account.id);
  }
  const resolved: string[] = [];
  const missing: string[] = [];
  for (const key of unique) {
    const id = idMap.get(key);
    if (id) {
      resolved.push(id);
    } else {
      missing.push(key);
    }
  }
  return { userAccountIds: Array.from(new Set(resolved)), missing };
}

async function isGroupNameTaken(displayName: string, excludeId?: string) {
  const where: Prisma.GroupAccountWhereInput = { displayName };
  if (excludeId) {
    where.NOT = { id: excludeId };
  }
  const existing = await prisma.groupAccount.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(existing);
}

export async function registerGroupRoutes(app: FastifyInstance) {
  app.get(
    '/groups',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const groups = await prisma.groupAccount.findMany({
        select: {
          id: true,
          displayName: true,
          externalId: true,
          active: true,
          scimMeta: true,
          updatedAt: true,
          _count: { select: { memberships: true } },
        },
        orderBy: { displayName: 'asc' },
      });
      return {
        items: groups.map((group) => ({
          id: group.id,
          displayName: group.displayName,
          externalId: group.externalId,
          active: group.active,
          updatedAt: group.updatedAt,
          memberCount: group._count.memberships,
          isScimManaged: Boolean(group.externalId || group.scimMeta),
        })),
      };
    },
  );

  app.get(
    '/groups/:groupId/members',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { groupId } = req.params as { groupId: string };
      const group = await prisma.groupAccount.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
      if (!group) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Group not found' },
        });
      }
      const members = await prisma.userGroup.findMany({
        where: { groupId },
        include: {
          user: {
            select: {
              id: true,
              userName: true,
              displayName: true,
              active: true,
              deletedAt: true,
            },
          },
        },
        orderBy: { userId: 'asc' },
      });
      return {
        items: members.map((member) => ({
          userAccountId: member.user.id,
          userId: member.user.userName,
          displayName: member.user.displayName,
          active: member.user.active,
          deletedAt: member.user.deletedAt,
        })),
      };
    },
  );

  app.post(
    '/groups',
    { preHandler: requireRole(['admin', 'mgmt']), schema: groupCreateSchema },
    async (req, reply) => {
      const actorId = req.user?.userId || null;
      if (!actorId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const body = req.body as {
        displayName: string;
        active?: boolean;
        userIds?: string[];
      };
      const displayName =
        typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (!displayName) {
        return reply.status(400).send({
          error: {
            code: 'DISPLAY_NAME_REQUIRED',
            message: 'displayName is required',
          },
        });
      }
      if (await isGroupNameTaken(displayName)) {
        return reply.status(409).send({
          error: { code: 'GROUP_EXISTS', message: 'group already exists' },
        });
      }
      const userIds = normalizeStringArray(body.userIds, {
        dedupe: true,
        max: 200,
      });
      const { userAccountIds, missing } = await resolveUserAccountIds(userIds);
      if (missing.length) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_USERS',
            message: `missing users: ${missing.join(', ')}`,
            missing,
          },
        });
      }
      const created = await prisma.groupAccount.create({
        data: {
          displayName,
          active: body.active ?? true,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      if (userAccountIds.length) {
        await prisma.userGroup.createMany({
          data: userAccountIds.map((userId) => ({
            groupId: created.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
      await logAudit({
        action: 'group_created',
        targetTable: 'GroupAccount',
        targetId: created.id,
        metadata: {
          displayName,
          active: created.active,
          memberCount: userAccountIds.length,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return {
        id: created.id,
        displayName: created.displayName,
        active: created.active,
      };
    },
  );

  app.patch(
    '/groups/:groupId',
    { preHandler: requireRole(['admin', 'mgmt']), schema: groupPatchSchema },
    async (req, reply) => {
      const actorId = req.user?.userId || null;
      if (!actorId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const { groupId } = req.params as { groupId: string };
      const current = await prisma.groupAccount.findUnique({
        where: { id: groupId },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Group not found' },
        });
      }
      const body = req.body as {
        displayName?: string;
        active?: boolean;
      };
      const displayNameRaw =
        typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (body.displayName !== undefined && !displayNameRaw) {
        return reply.status(400).send({
          error: {
            code: 'DISPLAY_NAME_REQUIRED',
            message: 'displayName is required',
          },
        });
      }
      if (
        body.displayName !== undefined &&
        displayNameRaw !== current.displayName &&
        (await isGroupNameTaken(displayNameRaw, groupId))
      ) {
        return reply.status(409).send({
          error: { code: 'GROUP_EXISTS', message: 'group already exists' },
        });
      }
      const updated = await prisma.groupAccount.update({
        where: { id: groupId },
        data: {
          ...(body.displayName !== undefined
            ? { displayName: displayNameRaw }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          updatedBy: actorId,
        },
      });
      await logAudit({
        action: 'group_updated',
        targetTable: 'GroupAccount',
        targetId: updated.id,
        metadata: {
          displayName: updated.displayName,
          active: updated.active,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return {
        id: updated.id,
        displayName: updated.displayName,
        active: updated.active,
      };
    },
  );

  app.post(
    '/groups/:groupId/members',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: groupMemberChangeSchema,
    },
    async (req, reply) => {
      const actorId = req.user?.userId || null;
      if (!actorId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const { groupId } = req.params as { groupId: string };
      const group = await prisma.groupAccount.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
      if (!group) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Group not found' },
        });
      }
      const body = req.body as { userIds: string[] };
      const userIds = normalizeStringArray(body.userIds, {
        dedupe: true,
        max: 200,
      });
      const { userAccountIds, missing } = await resolveUserAccountIds(userIds);
      if (missing.length) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_USERS',
            message: `missing users: ${missing.join(', ')}`,
            missing,
          },
        });
      }
      if (!userAccountIds.length) {
        return { ok: true, added: 0 };
      }
      await prisma.userGroup.createMany({
        data: userAccountIds.map((userId) => ({ groupId, userId })),
        skipDuplicates: true,
      });
      await logAudit({
        action: 'group_members_added',
        targetTable: 'UserGroup',
        metadata: {
          groupId,
          addedCount: userAccountIds.length,
          addedUserAccountIds: userAccountIds.slice(0, 20),
          truncated: userAccountIds.length > 20,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return { ok: true, added: userAccountIds.length };
    },
  );

  app.delete(
    '/groups/:groupId/members',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: groupMemberChangeSchema,
    },
    async (req, reply) => {
      const actorId = req.user?.userId || null;
      if (!actorId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const { groupId } = req.params as { groupId: string };
      const group = await prisma.groupAccount.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
      if (!group) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Group not found' },
        });
      }
      const body = req.body as { userIds: string[] };
      const userIds = normalizeStringArray(body.userIds, {
        dedupe: true,
        max: 200,
      });
      const { userAccountIds, missing } = await resolveUserAccountIds(userIds);
      if (missing.length) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_USERS',
            message: `missing users: ${missing.join(', ')}`,
            missing,
          },
        });
      }
      if (!userAccountIds.length) {
        return { ok: true, removed: 0 };
      }
      await prisma.userGroup.deleteMany({
        where: { groupId, userId: { in: userAccountIds } },
      });
      await logAudit({
        action: 'group_members_removed',
        targetTable: 'UserGroup',
        metadata: {
          groupId,
          removedCount: userAccountIds.length,
          removedUserAccountIds: userAccountIds.slice(0, 20),
          truncated: userAccountIds.length > 20,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return { ok: true, removed: userAccountIds.length };
    },
  );
}
