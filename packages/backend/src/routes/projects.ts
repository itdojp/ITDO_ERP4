import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import {
  projectSchema,
  projectPatchSchema,
  projectMemberSchema,
  projectMemberBulkSchema,
  recurringTemplateSchema,
  projectTaskSchema,
  projectTaskPatchSchema,
  projectTaskDependencySchema,
  projectBaselineSchema,
  projectMilestoneSchema,
  projectMilestonePatchSchema,
  deleteReasonSchema,
  reassignSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { logReassignment } from '../services/reassignmentLog.js';
import { parseDueDateRule } from '../services/dueDateRule.js';
import { toNumber } from '../services/utils.js';
import { findPeriodLock, toPeriodKey } from '../services/periodLock.js';
import { DocStatusValue, TimeStatusValue } from '../types.js';

type RecurringFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
type BillUpon = 'date' | 'acceptance' | 'time';

type RecurringTemplateBody = {
  frequency: RecurringFrequency;
  nextRunAt?: string;
  timezone?: string;
  defaultAmount?: number;
  defaultCurrency?: string;
  defaultTaxRate?: number;
  defaultTerms?: string;
  defaultMilestoneName?: string;
  billUpon?: BillUpon;
  dueDateRule?: unknown;
  shouldGenerateEstimate?: boolean;
  shouldGenerateInvoice?: boolean;
  isActive?: boolean;
};

async function ensureProjectIdParam(req: any, reply: any) {
  const projectId = req?.params?.projectId;
  if (!projectId) {
    return reply.status(400).send({
      error: { code: 'INVALID_PROJECT', message: 'Project id is required' },
    });
  }
  return undefined;
}

function isPrivilegedRole(roles: string[]) {
  return roles.includes('admin') || roles.includes('mgmt');
}

function parseNullableDateField(body: any, key: string) {
  const hasProp = Object.prototype.hasOwnProperty.call(body, key);
  const value = hasProp ? (body[key] ? new Date(body[key]) : null) : undefined;
  return { hasProp, value };
}

function isStartDateAfterEndDate(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
) {
  return (
    startDate instanceof Date &&
    endDate instanceof Date &&
    startDate.getTime() > endDate.getTime()
  );
}

function sendInvalidDateRangeError(
  reply: any,
  startField: string,
  endField: string,
) {
  return reply.status(400).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: `${startField} must be before or equal to ${endField}`,
    },
  });
}

function sendInvalidProjectPeriodError(reply: any) {
  return sendInvalidDateRangeError(reply, 'startDate', 'endDate');
}

async function ensureProjectLeader(req: any, reply: any, projectId: string) {
  const userId = req.user?.userId;
  if (!userId) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const leader = await prisma.projectMember.findFirst({
    where: { projectId, userId, role: 'leader' },
    select: { id: true },
  });
  if (!leader) {
    reply.code(403).send({ error: 'forbidden_project' });
    return false;
  }
  return true;
}

async function hasCircularParent(taskId: string, parentTaskId: string) {
  const visited = new Set<string>([taskId]);
  let currentId: string | null = parentTaskId;
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { parentTaskId: string | null } | null =
      await prisma.projectTask.findUnique({
        where: { id: currentId },
        select: { parentTaskId: true },
      });
    if (!current) return false;
    currentId = current.parentTaskId;
  }
  return false;
}

type TaskDependencyEdge = { fromTaskId: string; toTaskId: string };

function buildTaskDependencyGraph(edges: TaskDependencyEdge[]) {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const next = graph.get(edge.fromTaskId) ?? new Set<string>();
    next.add(edge.toTaskId);
    graph.set(edge.fromTaskId, next);
  }
  return graph;
}

function removeTaskDependency(
  graph: Map<string, Set<string>>,
  fromTaskId: string,
  toTaskId: string,
) {
  const next = graph.get(fromTaskId);
  if (!next) return;
  next.delete(toTaskId);
  if (next.size === 0) {
    graph.delete(fromTaskId);
  }
}

function addTaskDependency(
  graph: Map<string, Set<string>>,
  fromTaskId: string,
  toTaskId: string,
) {
  const next = graph.get(fromTaskId) ?? new Set<string>();
  next.add(toTaskId);
  graph.set(fromTaskId, next);
}

function hasTaskDependencyPath(
  graph: Map<string, Set<string>>,
  startId: string,
  targetId: string,
) {
  if (startId === targetId) return true;
  const visited = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = graph.get(current);
    if (!next) continue;
    for (const neighbor of next) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }
  return false;
}

function normalizeParentId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function hasCircularProjectParent(projectId: string, parentId: string) {
  const visited = new Set<string>([projectId]);
  let currentId: string | null = parentId;
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { parentId: string | null } | null =
      await prisma.project.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
    if (!current) return false;
    currentId = current.parentId;
  }
  return false;
}

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req) => {
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (
        !roles.includes('admin') &&
        !roles.includes('mgmt') &&
        projectIds.length === 0
      ) {
        return { items: [] };
      }
      const where =
        roles.includes('admin') || roles.includes('mgmt')
          ? { deletedAt: null }
          : projectIds.length
            ? { id: { in: projectIds }, deletedAt: null }
            : { id: { in: [] as string[] } };
      const projects = await prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items: projects };
    },
  );

  app.post(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectSchema },
    async (req, reply) => {
      const body = req.body as any;
      const hasCustomerIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'customerId',
      );
      const customerId =
        hasCustomerIdProp && body.customerId !== ''
          ? (body.customerId ?? null)
          : null;
      const { hasProp: hasStartDateProp, value: startDate } =
        parseNullableDateField(body, 'startDate');
      const { hasProp: hasEndDateProp, value: endDate } =
        parseNullableDateField(body, 'endDate');
      if (isStartDateAfterEndDate(startDate, endDate)) {
        return sendInvalidProjectPeriodError(reply);
      }
      if (customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      const data = {
        ...body,
        ...(hasCustomerIdProp ? { customerId } : {}),
        ...(hasStartDateProp ? { startDate } : {}),
        ...(hasEndDateProp ? { endDate } : {}),
      };
      const userId = req.user?.userId;
      const project = await prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: {
            ...data,
            createdBy: userId,
          },
        });
        await tx.chatRoom.create({
          data: {
            id: created.id,
            type: 'project',
            name: created.code,
            isOfficial: true,
            projectId: created.id,
            createdBy: userId,
          },
        });
        return created;
      });
      return project;
    },
  );

  app.patch(
    '/projects/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectPatchSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const current = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const hasParentIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'parentId',
      );
      const nextParentId = hasParentIdProp
        ? normalizeParentId(body.parentId)
        : (current.parentId ?? null);
      const currentParentId = current.parentId ?? null;
      const parentChanged = hasParentIdProp && nextParentId !== currentParentId;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (parentChanged && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REASON',
            message: 'reasonText is required when changing project parent',
          },
        });
      }
      if (parentChanged) {
        if (nextParentId === projectId) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARENT',
              message: 'Project cannot be its own parent',
            },
          });
        }
        if (nextParentId) {
          const parent = await prisma.project.findUnique({
            where: { id: nextParentId },
            select: { id: true, deletedAt: true },
          });
          if (!parent || parent.deletedAt) {
            return reply.status(404).send({
              error: {
                code: 'NOT_FOUND',
                message: 'Parent project not found',
              },
            });
          }
          if (await hasCircularProjectParent(projectId, nextParentId)) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Parent project creates circular reference',
              },
            });
          }
        }
      }
      const hasCustomerIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'customerId',
      );
      const customerId =
        hasCustomerIdProp && body.customerId !== ''
          ? (body.customerId ?? null)
          : null;
      if (hasCustomerIdProp && customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      const { hasProp: hasStartDateProp, value: startDate } =
        parseNullableDateField(body, 'startDate');
      const { hasProp: hasEndDateProp, value: endDate } =
        parseNullableDateField(body, 'endDate');
      const effectiveStartDate =
        startDate === undefined ? current.startDate : startDate;
      const effectiveEndDate =
        endDate === undefined ? current.endDate : endDate;
      if (isStartDateAfterEndDate(effectiveStartDate, effectiveEndDate)) {
        return sendInvalidProjectPeriodError(reply);
      }
      const data = { ...body };
      if (hasCustomerIdProp) data.customerId = customerId;
      if (hasParentIdProp) data.parentId = nextParentId;
      if (hasStartDateProp) data.startDate = startDate;
      if (hasEndDateProp) data.endDate = endDate;
      delete data.reasonText;
      const project = await prisma.project.update({
        where: { id: projectId },
        data,
      });
      if (parentChanged) {
        await logAudit({
          action: 'project_parent_updated',
          targetTable: 'projects',
          targetId: projectId,
          reasonText,
          metadata: {
            fromParentId: currentParentId,
            toParentId: nextParentId,
          },
          ...auditContextFromRequest(req),
        });
      }
      return project;
    },
  );

  app.get(
    '/projects/:projectId/members',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const roles = req.user?.roles || [];
      if (!isPrivilegedRole(roles)) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return;
      }
      const items = await prisma.projectMember.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
      });
      return { items };
    },
  );

  app.get(
    '/projects/:projectId/member-candidates',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { q } = req.query as { q?: string };
      const roles = req.user?.roles || [];
      if (!isPrivilegedRole(roles)) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return;
      }
      const keyword = (q || '').trim().slice(0, 64);
      if (keyword.length < 2) {
        return { items: [] };
      }
      const escapedKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      const likePattern = `%${escapedKeyword}%`;
      const users = await prisma.$queryRaw<
        Array<{
          userName: string;
          displayName: string | null;
          department: string | null;
        }>
      >`
        SELECT
          ua."userName",
          ua."displayName",
          ua."department"
        FROM "UserAccount" AS ua
        WHERE ua."active" = true
          AND (
            ua."userName" ILIKE ${likePattern} ESCAPE '\\'
            OR ua."displayName" ILIKE ${likePattern} ESCAPE '\\'
            OR ua."givenName" ILIKE ${likePattern} ESCAPE '\\'
            OR ua."familyName" ILIKE ${likePattern} ESCAPE '\\'
            OR ua."department" ILIKE ${likePattern} ESCAPE '\\'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ProjectMember" AS pm
            WHERE pm."projectId" = ${projectId}
              AND pm."userId" = ua."userName"
          )
        ORDER BY ua."userName" ASC
        LIMIT 20
      `;
      return {
        items: users.map((user) => ({
          userId: user.userName,
          displayName: user.displayName,
          department: user.department,
        })),
      };
    },
  );

  app.post(
    '/projects/:projectId/members',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
      schema: projectMemberSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as { userId: string; role?: 'member' | 'leader' };
      const roles = req.user?.roles || [];
      const isPrivileged = isPrivilegedRole(roles);
      if (!isPrivileged) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return;
      }
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const requestedRole = body.role ?? 'member';
      if (!isPrivileged && requestedRole !== 'member') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_ROLE_ASSIGNMENT',
            message: 'Project leaders can only assign members',
          },
        });
      }
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: body.userId } },
      });
      if (!isPrivileged && existing?.role === 'leader') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_LEADER_CHANGE',
            message: 'Project leaders cannot change leader roles',
          },
        });
      }
      if (existing && existing.role === requestedRole) {
        return existing;
      }
      const data = {
        role: requestedRole,
        updatedBy: req.user?.userId,
      };
      let member = existing
        ? await prisma.projectMember.update({
            where: { id: existing.id },
            data,
          })
        : null;
      let auditAction = existing
        ? 'project_member_role_updated'
        : 'project_member_added';
      let previousRole = existing?.role ?? null;
      if (!member) {
        try {
          member = await prisma.projectMember.create({
            data: {
              projectId,
              userId: body.userId,
              role: requestedRole,
              createdBy: req.user?.userId,
              updatedBy: req.user?.userId,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === 'P2002') {
              const fallback = await prisma.projectMember.findUnique({
                where: { projectId_userId: { projectId, userId: body.userId } },
              });
              if (!fallback) throw err;
              if (!isPrivileged && fallback.role === 'leader') {
                return reply.status(403).send({
                  error: {
                    code: 'FORBIDDEN_LEADER_CHANGE',
                    message: 'Project leaders cannot change leader roles',
                  },
                });
              }
              if (fallback.role === requestedRole) {
                return fallback;
              }
              previousRole = fallback.role;
              auditAction = 'project_member_role_updated';
              member = await prisma.projectMember.update({
                where: { id: fallback.id },
                data,
              });
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
      if (!member) {
        return reply.status(500).send({
          error: {
            code: 'PROJECT_MEMBER_SAVE_FAILED',
            message: 'Project member could not be saved',
          },
        });
      }
      await logAudit({
        ...auditContextFromRequest(req),
        action: auditAction,
        targetTable: 'ProjectMember',
        targetId: member.id,
        metadata: {
          projectId,
          userId: body.userId,
          role: requestedRole,
          previousRole,
        },
      });
      return member;
    },
  );

  app.post(
    '/projects/:projectId/members/bulk',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
      schema: projectMemberBulkSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        items: Array<{ userId: string; role?: 'member' | 'leader' }>;
      };
      const roles = req.user?.roles || [];
      const isPrivileged = isPrivilegedRole(roles);
      if (!isPrivileged) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return;
      }
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      const actorId = req.user?.userId;
      const failureDetails: Array<{ userId: string | null; reason: string }> =
        [];
      let added = 0;
      let skipped = 0;
      let failed = 0;
      const seen = new Set<string>();
      const normalized: Array<{ userId: string; role: 'member' | 'leader' }> =
        [];

      for (const item of body.items) {
        const userId = item.userId.trim();
        if (!userId) {
          failed += 1;
          if (failureDetails.length < 5) {
            failureDetails.push({ userId: null, reason: 'missing_user_id' });
          }
          continue;
        }
        const requestedRole = item.role === 'leader' ? 'leader' : 'member';
        if (!isPrivileged && requestedRole !== 'member') {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN_ROLE_ASSIGNMENT',
              message: 'Project leaders can only assign members',
            },
          });
        }
        if (seen.has(userId)) {
          skipped += 1;
          continue;
        }
        seen.add(userId);
        normalized.push({ userId, role: requestedRole });
      }

      if (normalized.length === 0) {
        return { added, skipped, failed, failures: failureDetails };
      }

      const existing = await prisma.projectMember.findMany({
        where: {
          projectId,
          userId: { in: normalized.map((item) => item.userId) },
        },
        select: { userId: true },
      });
      const existingSet = new Set(existing.map((member) => member.userId));

      for (const item of normalized) {
        if (existingSet.has(item.userId)) {
          skipped += 1;
          continue;
        }
        try {
          const member = await prisma.projectMember.create({
            data: {
              projectId,
              userId: item.userId,
              role: item.role,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
          added += 1;
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'project_member_added',
            targetTable: 'ProjectMember',
            targetId: member.id,
            metadata: {
              projectId,
              userId: item.userId,
              role: item.role,
              source: 'bulk',
            },
          });
        } catch (err) {
          if (req.log && typeof req.log.warn === 'function') {
            req.log.warn(
              { err, projectId, userId: item.userId },
              'Failed to create project member in bulk import',
            );
          }
          failed += 1;
          if (failureDetails.length < 5) {
            failureDetails.push({
              userId: item.userId,
              reason: 'create_failed',
            });
          }
        }
      }

      return { added, skipped, failed, failures: failureDetails };
    },
  );

  app.delete(
    '/projects/:projectId/members/:userId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId, userId: targetUserId } = req.params as {
        projectId: string;
        userId: string;
      };
      const roles = req.user?.roles || [];
      const isPrivileged = isPrivilegedRole(roles);
      if (!isPrivileged) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return;
      }
      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: targetUserId } },
      });
      if (!member) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project member not found' },
        });
      }
      if (!isPrivileged && member.role === 'leader') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_MEMBER_REMOVAL',
            message: 'Project leaders cannot remove leaders',
          },
        });
      }
      await prisma.projectMember.delete({ where: { id: member.id } });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'project_member_removed',
        targetTable: 'ProjectMember',
        targetId: member.id,
        metadata: {
          projectId,
          userId: targetUserId,
          role: member.role,
        },
      });
      return { ok: true };
    },
  );

  app.get(
    '/projects/:projectId/tasks',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const items = await prisma.projectTask.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.post(
    '/projects/:projectId/tasks',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const parentTaskId = normalizeParentId(body.parentTaskId);
      const hasProgressPercentProp = Object.prototype.hasOwnProperty.call(
        body,
        'progressPercent',
      );
      const progressPercent = hasProgressPercentProp
        ? body.progressPercent
        : undefined;
      const { value: planStart } = parseNullableDateField(body, 'planStart');
      const { value: planEnd } = parseNullableDateField(body, 'planEnd');
      const { value: actualStart } = parseNullableDateField(
        body,
        'actualStart',
      );
      const { value: actualEnd } = parseNullableDateField(body, 'actualEnd');
      if (isStartDateAfterEndDate(planStart, planEnd)) {
        return sendInvalidDateRangeError(reply, 'planStart', 'planEnd');
      }
      if (isStartDateAfterEndDate(actualStart, actualEnd)) {
        return sendInvalidDateRangeError(reply, 'actualStart', 'actualEnd');
      }
      if (parentTaskId) {
        const parent = await prisma.projectTask.findUnique({
          where: { id: parentTaskId },
          select: { projectId: true, deletedAt: true },
        });
        if (!parent || parent.deletedAt) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Parent task not found' },
          });
        }
        if (parent.projectId !== projectId) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Parent task belongs to another project',
            },
          });
        }
      }
      const task = await prisma.projectTask.create({
        data: {
          projectId,
          name: body.name,
          parentTaskId,
          assigneeId: body.assigneeId,
          status: body.status,
          progressPercent: progressPercent ?? null,
          planStart: planStart ?? null,
          planEnd: planEnd ?? null,
          actualStart: actualStart ?? null,
          actualEnd: actualEnd ?? null,
        },
      });
      return task;
    },
  );

  app.patch(
    '/projects/:projectId/tasks/:taskId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskPatchSchema,
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const current = await prisma.projectTask.findUnique({
        where: { id: taskId },
      });
      if (!current || current.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (current.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      const hasProgressPercentProp = Object.prototype.hasOwnProperty.call(
        body,
        'progressPercent',
      );
      const progressPercent = hasProgressPercentProp
        ? body.progressPercent
        : undefined;
      const { hasProp: hasPlanStartProp, value: planStart } =
        parseNullableDateField(body, 'planStart');
      const { hasProp: hasPlanEndProp, value: planEnd } =
        parseNullableDateField(body, 'planEnd');
      const { hasProp: hasActualStartProp, value: actualStart } =
        parseNullableDateField(body, 'actualStart');
      const { hasProp: hasActualEndProp, value: actualEnd } =
        parseNullableDateField(body, 'actualEnd');
      const effectivePlanStart =
        planStart === undefined ? current.planStart : planStart;
      const effectivePlanEnd =
        planEnd === undefined ? current.planEnd : planEnd;
      if (isStartDateAfterEndDate(effectivePlanStart, effectivePlanEnd)) {
        return sendInvalidDateRangeError(reply, 'planStart', 'planEnd');
      }
      const effectiveActualStart =
        actualStart === undefined ? current.actualStart : actualStart;
      const effectiveActualEnd =
        actualEnd === undefined ? current.actualEnd : actualEnd;
      if (isStartDateAfterEndDate(effectiveActualStart, effectiveActualEnd)) {
        return sendInvalidDateRangeError(reply, 'actualStart', 'actualEnd');
      }
      const hasParentTaskIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'parentTaskId',
      );
      const nextParentTaskId = hasParentTaskIdProp
        ? normalizeParentId(body.parentTaskId)
        : undefined;
      const currentParentTaskId = current.parentTaskId ?? null;
      const parentChanged =
        hasParentTaskIdProp && nextParentTaskId !== currentParentTaskId;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (parentChanged && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REASON',
            message: 'reasonText is required when changing task parent',
          },
        });
      }
      if (hasParentTaskIdProp) {
        if (nextParentTaskId === taskId) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Parent task cannot be self',
            },
          });
        }
        if (nextParentTaskId) {
          const parent = await prisma.projectTask.findUnique({
            where: { id: nextParentTaskId },
            select: { projectId: true, deletedAt: true },
          });
          if (!parent || parent.deletedAt) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Parent task not found' },
            });
          }
          if (parent.projectId !== projectId) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Parent task belongs to another project',
              },
            });
          }
          if (await hasCircularParent(taskId, nextParentTaskId)) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Parent task creates circular reference',
              },
            });
          }
        }
      }
      const task = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          name: body.name,
          parentTaskId: hasParentTaskIdProp ? nextParentTaskId : undefined,
          assigneeId: body.assigneeId,
          status: body.status,
          progressPercent: hasProgressPercentProp ? progressPercent : undefined,
          planStart: hasPlanStartProp ? planStart : undefined,
          planEnd: hasPlanEndProp ? planEnd : undefined,
          actualStart: hasActualStartProp ? actualStart : undefined,
          actualEnd: hasActualEndProp ? actualEnd : undefined,
        },
      });
      if (parentChanged) {
        await logAudit({
          action: 'project_task_parent_updated',
          targetTable: 'project_tasks',
          targetId: taskId,
          reasonText,
          metadata: {
            projectId,
            fromParentTaskId: currentParentTaskId,
            toParentTaskId: nextParentTaskId ?? null,
          },
          ...auditContextFromRequest(req),
        });
      }
      return task;
    },
  );

  app.get(
    '/projects/:projectId/tasks/:taskId/dependencies',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true, deletedAt: true },
      });
      if (!task || task.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (task.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      const deps = await prisma.projectTaskDependency.findMany({
        where: { projectId, toTaskId: taskId, fromTask: { deletedAt: null } },
        select: { fromTaskId: true },
        orderBy: { createdAt: 'asc' },
      });
      return { predecessorIds: deps.map((dep) => dep.fromTaskId) };
    },
  );

  app.put(
    '/projects/:projectId/tasks/:taskId/dependencies',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskDependencySchema,
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const rawPredecessorIds: unknown[] = Array.isArray(body.predecessorIds)
        ? body.predecessorIds
        : [];
      const predecessorIds: string[] = Array.from(
        new Set(
          rawPredecessorIds
            .map((value) => String(value).trim())
            .filter((value) => value.length > 0),
        ),
      );
      if (predecessorIds.includes(taskId)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task cannot depend on itself',
          },
        });
      }
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true, deletedAt: true },
      });
      if (!task || task.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (task.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }

      if (predecessorIds.length) {
        const predecessors = await prisma.projectTask.findMany({
          where: { id: { in: predecessorIds }, projectId, deletedAt: null },
          select: { id: true },
        });
        if (predecessors.length !== predecessorIds.length) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Predecessor task not found',
            },
          });
        }
      }

      const existing = await prisma.projectTaskDependency.findMany({
        where: { projectId, toTaskId: taskId },
        select: { fromTaskId: true },
      });
      const existingIds = new Set(existing.map((dep) => dep.fromTaskId));
      const desiredIds = new Set(predecessorIds);
      const toAdd = predecessorIds.filter((id) => !existingIds.has(id));
      const toRemove = Array.from(existingIds).filter(
        (id) => !desiredIds.has(id),
      );

      if (toAdd.length) {
        const edges = await prisma.projectTaskDependency.findMany({
          where: {
            projectId,
            fromTask: { deletedAt: null },
            toTask: { deletedAt: null },
          },
          select: { fromTaskId: true, toTaskId: true },
        });
        const graph = buildTaskDependencyGraph(edges);
        for (const fromTaskId of toRemove) {
          removeTaskDependency(graph, fromTaskId, taskId);
        }
        for (const fromTaskId of toAdd) {
          if (hasTaskDependencyPath(graph, taskId, fromTaskId)) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Task dependency creates circular reference',
              },
            });
          }
          addTaskDependency(graph, fromTaskId, taskId);
        }
      }

      const userId = req.user?.userId;
      await prisma.$transaction(async (tx) => {
        if (toRemove.length) {
          await tx.projectTaskDependency.deleteMany({
            where: {
              projectId,
              toTaskId: taskId,
              fromTaskId: { in: toRemove },
            },
          });
        }
        if (toAdd.length) {
          await tx.projectTaskDependency.createMany({
            data: toAdd.map((fromTaskId) => ({
              projectId,
              fromTaskId,
              toTaskId: taskId,
              createdBy: userId,
            })),
            skipDuplicates: true,
          });
        }
      });

      return { predecessorIds, added: toAdd.length, removed: toRemove.length };
    },
  );

  app.post(
    '/projects/:projectId/tasks/:taskId/reassign',
    { preHandler: requireRole(['admin', 'mgmt']), schema: reassignSchema },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const moveTimeEntries = body.moveTimeEntries === true;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (!reasonText) {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'reasonText is required' },
        });
      }
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
      });
      if (!task || task.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (task.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      const targetProject = await prisma.project.findUnique({
        where: { id: body.toProjectId },
        select: { id: true },
      });
      if (!targetProject) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Target project not found' },
        });
      }
      const [
        childCount,
        timeCount,
        dependencyCount,
        estimateCount,
        invoiceCount,
        poCount,
      ] = await Promise.all([
        prisma.projectTask.count({
          where: { parentTaskId: taskId, deletedAt: null },
        }),
        prisma.timeEntry.count({
          where: { taskId, deletedAt: null },
        }),
        prisma.projectTaskDependency.count({
          where: {
            projectId,
            OR: [{ fromTaskId: taskId }, { toTaskId: taskId }],
          },
        }),
        prisma.estimateLine.count({ where: { taskId } }),
        prisma.billingLine.count({ where: { taskId } }),
        prisma.purchaseOrderLine.count({ where: { taskId } }),
      ]);
      if (
        childCount > 0 ||
        (!moveTimeEntries && timeCount > 0) ||
        dependencyCount > 0 ||
        estimateCount > 0 ||
        invoiceCount > 0 ||
        poCount > 0
      ) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task has linked records and cannot be reassigned',
          },
        });
      }
      let timeEntries: {
        id: string;
        projectId: string;
        taskId: string | null;
        workDate: Date;
        status: string;
        billedInvoiceId: string | null;
      }[] = [];
      if (moveTimeEntries && timeCount > 0) {
        timeEntries = await prisma.timeEntry.findMany({
          where: { taskId, deletedAt: null },
          select: {
            id: true,
            projectId: true,
            taskId: true,
            workDate: true,
            status: true,
            billedInvoiceId: true,
          },
        });
        const billedEntry = timeEntries.find((entry) => entry.billedInvoiceId);
        if (billedEntry) {
          return reply.status(400).send({
            error: {
              code: 'BILLED',
              message: 'Time entry already billed',
            },
          });
        }
        const approvedEntry = timeEntries.find(
          (entry) => entry.status === TimeStatusValue.approved,
        );
        if (approvedEntry) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_STATUS',
              message: 'Time entry approved',
            },
          });
        }
        const pendingApproval = await prisma.approvalInstance.findFirst({
          where: {
            targetTable: 'time_entries',
            targetId: { in: timeEntries.map((entry) => entry.id) },
            status: {
              in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
            },
          },
          select: { id: true },
        });
        if (pendingApproval) {
          return reply.status(400).send({
            error: {
              code: 'PENDING_APPROVAL',
              message: 'Approval in progress',
            },
          });
        }
        const lockCache = new Map<string, boolean>();
        const isLocked = async (periodKey: string, targetProjectId: string) => {
          const cacheKey = `${periodKey}:${targetProjectId}`;
          if (lockCache.has(cacheKey)) return lockCache.get(cacheKey) ?? false;
          const lock = await findPeriodLock(periodKey, targetProjectId);
          const locked = Boolean(lock);
          lockCache.set(cacheKey, locked);
          return locked;
        };
        for (const entry of timeEntries) {
          const periodKey = toPeriodKey(entry.workDate);
          const fromLocked = await isLocked(periodKey, entry.projectId);
          if (fromLocked) {
            return reply.status(400).send({
              error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
            });
          }
          if (body.toProjectId !== entry.projectId) {
            const toLocked = await isLocked(periodKey, body.toProjectId);
            if (toLocked) {
              return reply.status(400).send({
                error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
              });
            }
          }
        }
      }
      const updated = await prisma.$transaction(async (tx) => {
        const taskUpdate = await tx.projectTask.update({
          where: { id: taskId },
          data: {
            projectId: body.toProjectId,
          },
        });
        if (moveTimeEntries && timeEntries.length) {
          await tx.timeEntry.updateMany({
            where: { id: { in: timeEntries.map((entry) => entry.id) } },
            data: { projectId: body.toProjectId },
          });
        }
        return taskUpdate;
      });
      await logAudit({
        action: 'reassignment',
        targetTable: 'project_tasks',
        targetId: taskId,
        reasonCode: body.reasonCode,
        reasonText,
        metadata: {
          fromProjectId: projectId,
          toProjectId: body.toProjectId,
          fromTaskId: taskId,
          toTaskId: taskId,
          movedTimeEntries: moveTimeEntries ? timeEntries.length : 0,
        },
        ...auditContextFromRequest(req),
      });
      await logReassignment({
        targetTable: 'project_tasks',
        targetId: taskId,
        fromProjectId: projectId,
        toProjectId: body.toProjectId,
        fromTaskId: taskId,
        toTaskId: taskId,
        reasonCode: body.reasonCode,
        reasonText,
        createdBy: req.user?.userId,
      });
      if (moveTimeEntries && timeEntries.length) {
        const auditContext = auditContextFromRequest(req);
        await Promise.all(
          timeEntries.map((entry) =>
            logAudit({
              action: 'reassignment',
              targetTable: 'time_entries',
              targetId: entry.id,
              reasonCode: body.reasonCode,
              reasonText,
              metadata: {
                fromProjectId: entry.projectId,
                toProjectId: body.toProjectId,
                fromTaskId: entry.taskId,
                toTaskId: entry.taskId,
              },
              ...auditContext,
            }),
          ),
        );
        await Promise.all(
          timeEntries.map((entry) =>
            logReassignment({
              targetTable: 'time_entries',
              targetId: entry.id,
              fromProjectId: entry.projectId,
              toProjectId: body.toProjectId,
              fromTaskId: entry.taskId,
              toTaskId: entry.taskId,
              reasonCode: body.reasonCode,
              reasonText,
              createdBy: req.user?.userId,
            }),
          ),
        );
      }
      return updated;
    },
  );

  app.post(
    '/projects/:projectId/tasks/:taskId/delete',
    { preHandler: requireRole(['admin', 'mgmt']), schema: deleteReasonSchema },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
      });
      if (!task || task.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (task.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      const [childCount, timeCount, estimateCount, invoiceCount, poCount] =
        await Promise.all([
          prisma.projectTask.count({
            where: { parentTaskId: taskId, deletedAt: null },
          }),
          prisma.timeEntry.count({
            where: { taskId, deletedAt: null },
          }),
          prisma.estimateLine.count({ where: { taskId } }),
          prisma.billingLine.count({ where: { taskId } }),
          prisma.purchaseOrderLine.count({ where: { taskId } }),
        ]);
      if (
        childCount > 0 ||
        timeCount > 0 ||
        estimateCount > 0 ||
        invoiceCount > 0 ||
        poCount > 0
      ) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task has linked records and cannot be deleted',
          },
        });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.projectTask.update({
          where: { id: taskId },
          data: {
            deletedAt: new Date(),
            deletedReason: body.reason,
          },
        });
        await tx.projectTaskDependency.deleteMany({
          where: {
            projectId,
            OR: [{ fromTaskId: taskId }, { toTaskId: taskId }],
          },
        });
        return updated;
      });
      return updated;
    },
  );

  app.get(
    '/projects/:projectId/baselines',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const items = await prisma.projectBaseline.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/projects/:projectId/baselines/:baselineId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId, baselineId } = req.params as {
        projectId: string;
        baselineId: string;
      };
      const baseline = await prisma.projectBaseline.findUnique({
        where: { id: baselineId },
        include: {
          tasks: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!baseline || baseline.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Baseline not found' },
        });
      }
      if (baseline.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Baseline already deleted',
          },
        });
      }
      return baseline;
    },
  );

  app.post(
    '/projects/:projectId/baselines',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectBaselineSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const roles = req.user?.roles || [];
      const isPrivileged = isPrivilegedRole(roles);
      if (!isPrivileged) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return;
      }
      const body = req.body as any;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const baselineName = name || `baseline-${new Date().toISOString()}`;
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const tasks = await prisma.projectTask.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          planStart: true,
          planEnd: true,
          progressPercent: true,
        },
      });
      const createdBy = req.user?.userId;
      const baseline = await prisma.$transaction(async (tx) => {
        const baseline = await tx.projectBaseline.create({
          data: {
            projectId,
            name: baselineName,
            createdBy,
          },
        });
        if (tasks.length) {
          await tx.projectBaselineTask.createMany({
            data: tasks.map((task) => ({
              baselineId: baseline.id,
              taskId: task.id,
              name: task.name,
              status: task.status,
              planStart: task.planStart,
              planEnd: task.planEnd,
              progressPercent: task.progressPercent,
              createdBy,
            })),
            skipDuplicates: true,
          });
        }
        return baseline;
      });
      return { ...baseline, taskCount: tasks.length };
    },
  );

  app.post(
    '/projects/:projectId/milestones',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectMilestoneSchema,
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const milestone = await prisma.projectMilestone.create({
        data: {
          projectId,
          name: body.name,
          amount: body.amount,
          billUpon: body.billUpon || 'date',
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          taxRate: body.taxRate,
        },
      });
      return milestone;
    },
  );

  app.get(
    '/projects/:projectId/milestones',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const items = await prisma.projectMilestone.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.patch(
    '/projects/:projectId/milestones/:milestoneId',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectMilestonePatchSchema,
    },
    async (req, reply) => {
      const { projectId, milestoneId } = req.params as {
        projectId: string;
        milestoneId: string;
      };
      const body = req.body as any;
      const milestone = await prisma.projectMilestone.findUnique({
        where: { id: milestoneId },
      });
      if (!milestone || milestone.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Milestone not found' },
        });
      }
      if (milestone.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Milestone already deleted',
          },
        });
      }
      const lockedInvoice = await prisma.invoice.findFirst({
        where: {
          milestoneId,
          deletedAt: null,
          status: { not: 'draft' },
        },
        select: { id: true },
      });
      if (lockedInvoice) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Milestone has submitted invoices and cannot be updated',
          },
        });
      }
      const updated = await prisma.projectMilestone.update({
        where: { id: milestoneId },
        data: {
          name: body.name,
          amount: body.amount,
          billUpon: body.billUpon,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          taxRate: body.taxRate,
        },
      });
      if (typeof body.amount === 'number') {
        const draftInvoices = await prisma.invoice.findMany({
          where: { milestoneId, deletedAt: null, status: 'draft' },
          select: {
            id: true,
            totalAmount: true,
            lines: { select: { id: true, quantity: true, unitPrice: true } },
          },
        });
        const amountTolerance = 0.0001;
        const updates: Prisma.PrismaPromise<unknown>[] = [];
        const updatedInvoiceIds: string[] = [];
        for (const invoice of draftInvoices) {
          if (invoice.lines.length !== 1) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'line_count',
              lineCount: invoice.lines.length,
            });
            continue;
          }
          const line = invoice.lines[0];
          if (!line) continue;
          const quantity = toNumber(line.quantity);
          if (quantity !== 1) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'quantity',
              quantity,
            });
            continue;
          }
          const lineTotal = quantity * toNumber(line.unitPrice);
          const invoiceTotal = toNumber(invoice.totalAmount);
          if (Math.abs(lineTotal - invoiceTotal) > amountTolerance) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'manual_adjustment',
              lineTotal,
              invoiceTotal,
            });
            continue;
          }
          updates.push(
            prisma.billingLine.update({
              where: { id: line.id },
              data: { unitPrice: body.amount },
            }),
            prisma.invoice.update({
              where: { id: invoice.id },
              data: { totalAmount: body.amount },
            }),
          );
          updatedInvoiceIds.push(invoice.id);
        }
        if (updates.length) {
          try {
            await prisma.$transaction(updates);
          } catch (err) {
            console.error('[milestone] invoice sync failed', {
              milestoneId,
              invoiceIds: updatedInvoiceIds,
              error: err,
            });
          }
        }
      }
      return updated;
    },
  );

  app.post(
    '/projects/:projectId/milestones/:milestoneId/delete',
    { preHandler: requireRole(['admin', 'mgmt']), schema: deleteReasonSchema },
    async (req, reply) => {
      const { projectId, milestoneId } = req.params as {
        projectId: string;
        milestoneId: string;
      };
      const body = req.body as any;
      const milestone = await prisma.projectMilestone.findUnique({
        where: { id: milestoneId },
      });
      if (!milestone || milestone.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Milestone not found' },
        });
      }
      if (milestone.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Milestone already deleted',
          },
        });
      }
      const linkedInvoice = await prisma.invoice.findFirst({
        where: {
          milestoneId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (linkedInvoice) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Milestone has linked invoices and cannot be deleted',
          },
        });
      }
      const updated = await prisma.projectMilestone.update({
        where: { id: milestoneId },
        data: {
          deletedAt: new Date(),
          deletedReason: body.reason,
        },
      });
      return updated;
    },
  );

  app.get(
    '/projects/:id/recurring-template',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const params = req.params as { id: string };
      const template = await prisma.recurringProjectTemplate.findUnique({
        where: { projectId: params.id },
      });
      return template;
    },
  );

  app.post(
    '/projects/:id/recurring-template',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: recurringTemplateSchema,
    },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as RecurringTemplateBody;
      const project = await prisma.project.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      let dueDateRule: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'dueDateRule')) {
        try {
          const parsed = parseDueDateRule(body.dueDateRule);
          dueDateRule =
            parsed === null ? Prisma.DbNull : (parsed as Prisma.InputJsonValue);
        } catch (err) {
          req.log.error({ err }, 'Failed to parse dueDateRule');
          return reply.code(400).send({
            error: {
              code: 'INVALID_DUE_DATE_RULE',
              message: 'dueDateRule is invalid',
              details: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
      const data = {
        frequency: body.frequency,
        nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : undefined,
        timezone: body.timezone,
        defaultAmount: body.defaultAmount,
        defaultCurrency: body.defaultCurrency,
        defaultTaxRate: body.defaultTaxRate,
        defaultTerms: body.defaultTerms,
        defaultMilestoneName: body.defaultMilestoneName,
        billUpon: body.billUpon,
        dueDateRule,
        shouldGenerateEstimate: body.shouldGenerateEstimate,
        shouldGenerateInvoice: body.shouldGenerateInvoice,
        isActive: body.isActive,
      };
      const template = await prisma.recurringProjectTemplate.upsert({
        where: { projectId: params.id },
        create: {
          projectId: params.id,
          ...data,
        },
        update: data,
      });
      return template;
    },
  );

  app.get(
    '/projects/:id/recurring-generation-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const project = await prisma.project.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const { limit, templateId, periodKey } = req.query as {
        limit?: string;
        templateId?: string;
        periodKey?: string;
      };
      const takeRaw = limit ? Number(limit) : 50;
      const take =
        Number.isFinite(takeRaw) && takeRaw > 0
          ? Math.min(Math.floor(takeRaw), 200)
          : 50;
      const where: Record<string, unknown> = { projectId: id };
      if (templateId) where.templateId = templateId;
      if (periodKey) where.periodKey = periodKey;
      const items = await prisma.recurringGenerationLog.findMany({
        where,
        orderBy: [{ runAt: 'desc' }, { createdAt: 'desc' }],
        take,
      });
      return { items };
    },
  );
}
