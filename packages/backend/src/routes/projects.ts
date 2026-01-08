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
      const data = hasCustomerIdProp ? { ...body, customerId } : { ...body };
      const project = await prisma.project.create({ data });
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
      const data = hasCustomerIdProp ? { ...body, customerId } : { ...body };
      const project = await prisma.project.update({
        where: { id: projectId },
        data,
      });
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
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectTaskSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      if (body.parentTaskId) {
        const parent = await prisma.projectTask.findUnique({
          where: { id: body.parentTaskId },
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
          parentTaskId: body.parentTaskId,
          assigneeId: body.assigneeId,
          status: body.status,
          planStart: body.planStart ? new Date(body.planStart) : null,
          planEnd: body.planEnd ? new Date(body.planEnd) : null,
          actualStart: body.actualStart ? new Date(body.actualStart) : null,
          actualEnd: body.actualEnd ? new Date(body.actualEnd) : null,
        },
      });
      return task;
    },
  );

  app.patch(
    '/projects/:projectId/tasks/:taskId',
    {
      preHandler: requireRole(['admin', 'mgmt']),
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
      if (Object.prototype.hasOwnProperty.call(body, 'parentTaskId')) {
        if (body.parentTaskId === taskId) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Parent task cannot be self',
            },
          });
        }
        if (body.parentTaskId) {
          const parent = await prisma.projectTask.findUnique({
            where: { id: body.parentTaskId },
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
          if (await hasCircularParent(taskId, body.parentTaskId)) {
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
          parentTaskId: body.parentTaskId,
          assigneeId: body.assigneeId,
          status: body.status,
          planStart: body.planStart ? new Date(body.planStart) : undefined,
          planEnd: body.planEnd ? new Date(body.planEnd) : undefined,
          actualStart: body.actualStart
            ? new Date(body.actualStart)
            : undefined,
          actualEnd: body.actualEnd ? new Date(body.actualEnd) : undefined,
        },
      });
      return task;
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
            message: 'Task has linked records and cannot be reassigned',
          },
        });
      }
      const updated = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          projectId: body.toProjectId,
        },
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
      const updated = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          deletedAt: new Date(),
          deletedReason: body.reason,
        },
      });
      return updated;
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
          include: {
            lines: { select: { id: true, quantity: true, unitPrice: true } },
          },
        });
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
          if (Math.abs(lineTotal - invoiceTotal) > 0.0001) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'manual_adjustment',
              lineTotal,
              invoiceTotal,
            });
            continue;
          }
          await prisma.$transaction([
            prisma.billingLine.update({
              where: { id: line.id },
              data: { unitPrice: body.amount },
            }),
            prisma.invoice.update({
              where: { id: invoice.id },
              data: { totalAmount: body.amount },
            }),
          ]);
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
}
