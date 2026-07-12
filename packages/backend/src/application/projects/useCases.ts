import { Prisma } from '@prisma/client';

import type { AuditContext } from '../../services/audit.js';
import { logAudit as defaultLogAudit } from '../../services/audit.js';
import {
  createProjectCreatedNotifications as defaultCreateProjectCreatedNotifications,
  createProjectMemberAddedNotifications as defaultCreateProjectMemberAddedNotifications,
  createProjectStatusChangedNotifications as defaultCreateProjectStatusChangedNotifications,
} from '../../services/appNotifications.js';
import { prisma as defaultPrisma } from '../../services/db.js';
import {
  findPeriodLock as defaultFindPeriodLock,
  toPeriodKey as defaultToPeriodKey,
} from '../../services/periodLock.js';
import { logReassignment as defaultLogReassignment } from '../../services/reassignmentLog.js';
import { normalizeParentId } from '../../services/taskDependencyGraph.js';
import { DocStatusValue, TimeStatusValue } from '../../types.js';

export type ProjectActorContext = {
  userId?: string | null;
  roles: string[];
  projectIds?: string[];
};

export type ProjectMemberRole = 'member' | 'leader';

export type ProjectApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type ProjectApplicationResult<T> =
  { ok: true; value: T } | ProjectApplicationFailure;

export type ProjectApplicationLogger = {
  warn?: (payload: unknown, message?: string) => void;
};

type ProjectNotificationItem = { userId: string; role: ProjectMemberRole };

type ProjectApplicationPorts = {
  db: any;
  createProjectCreatedNotifications: typeof defaultCreateProjectCreatedNotifications;
  createProjectMemberAddedNotifications: typeof defaultCreateProjectMemberAddedNotifications;
  createProjectStatusChangedNotifications: typeof defaultCreateProjectStatusChangedNotifications;
  findPeriodLock: typeof defaultFindPeriodLock;
  toPeriodKey: typeof defaultToPeriodKey;
  logAudit: typeof defaultLogAudit;
  logReassignment: typeof defaultLogReassignment;
};

export type ProjectApplicationPortOverrides = Partial<ProjectApplicationPorts>;

const defaultPorts: ProjectApplicationPorts = {
  db: defaultPrisma,
  createProjectCreatedNotifications: defaultCreateProjectCreatedNotifications,
  createProjectMemberAddedNotifications:
    defaultCreateProjectMemberAddedNotifications,
  createProjectStatusChangedNotifications:
    defaultCreateProjectStatusChangedNotifications,
  findPeriodLock: defaultFindPeriodLock,
  toPeriodKey: defaultToPeriodKey,
  logAudit: defaultLogAudit,
  logReassignment: defaultLogReassignment,
};

function ports(
  overrides?: ProjectApplicationPortOverrides,
): ProjectApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): ProjectApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): ProjectApplicationFailure {
  return { ok: false, statusCode, body };
}

function isApplicationFailure(
  value: unknown,
): value is ProjectApplicationFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok?: unknown }).ok === false
  );
}

export function isPrivilegedProjectRole(roles: string[]): boolean {
  return roles.includes('admin') || roles.includes('mgmt');
}

function actorUserId(actor: ProjectActorContext): string | null {
  return typeof actor.userId === 'string' && actor.userId.trim()
    ? actor.userId
    : null;
}

function projectIds(actor: ProjectActorContext): string[] {
  return Array.isArray(actor.projectIds) ? actor.projectIds : [];
}

function parseNullableDateField(body: Record<string, unknown>, key: string) {
  const hasProp = Object.prototype.hasOwnProperty.call(body, key);
  const raw = hasProp ? body[key] : undefined;
  const value = hasProp ? (raw ? new Date(raw as string) : null) : undefined;
  return { hasProp, value };
}

function isStartDateAfterEndDate(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
): boolean {
  return (
    startDate instanceof Date &&
    endDate instanceof Date &&
    startDate.getTime() > endDate.getTime()
  );
}

function invalidDateRangeError(startField: string, endField: string) {
  return fail(400, {
    error: {
      code: 'VALIDATION_ERROR',
      message: `${startField} must be before or equal to ${endField}`,
    },
  });
}

function invalidProjectPeriodError() {
  return invalidDateRangeError('startDate', 'endDate');
}

async function hasCircularProjectParent(
  p: ProjectApplicationPorts,
  projectId: string,
  parentId: string,
): Promise<boolean> {
  const visited = new Set<string>([projectId]);
  let currentId: string | null = parentId;
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { parentId: string | null } | null =
      await p.db.project.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
    if (!current) return false;
    currentId = current.parentId;
  }
  return false;
}

async function ensureProjectLeaderPermission(input: {
  p: ProjectApplicationPorts;
  actor: ProjectActorContext;
  projectId: string;
}): Promise<ProjectApplicationFailure | null> {
  const userId = actorUserId(input.actor);
  if (!userId) return fail(401, { error: 'unauthorized' });
  const leader = await input.p.db.projectMember.findFirst({
    where: { projectId: input.projectId, userId, role: 'leader' },
    select: { id: true },
  });
  if (!leader) return fail(403, { error: 'forbidden_project' });
  return null;
}

async function ensureMembershipAccess(input: {
  p: ProjectApplicationPorts;
  actor: ProjectActorContext;
  projectId: string;
}): Promise<{ isPrivileged: boolean } | ProjectApplicationFailure> {
  const isPrivileged = isPrivilegedProjectRole(input.actor.roles);
  if (!isPrivileged) {
    const denied = await ensureProjectLeaderPermission(input);
    if (denied) return denied;
  }
  return { isPrivileged };
}

async function tryCreateProjectMemberAddedNotifications(input: {
  p: ProjectApplicationPorts;
  logger?: ProjectApplicationLogger;
  projectId: string;
  actorUserId?: string | null;
  items: ProjectNotificationItem[];
  source: 'single' | 'bulk';
}) {
  const actorId =
    typeof input.actorUserId === 'string' ? input.actorUserId.trim() : '';
  if (!actorId) return;
  if (input.items.length === 0) return;
  try {
    await input.p.createProjectMemberAddedNotifications({
      projectId: input.projectId,
      actorUserId: actorId,
      items: input.items,
      source: input.source,
    });
  } catch (err) {
    input.logger?.warn?.(
      { err, projectId: input.projectId },
      'Failed to create project member added notifications',
    );
  }
}

export async function listProjects(input: {
  actor: ProjectActorContext;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const roles = input.actor.roles;
  const allowedProjectIds = projectIds(input.actor);
  if (
    !roles.includes('admin') &&
    !roles.includes('mgmt') &&
    allowedProjectIds.length === 0
  ) {
    return ok({ items: [] });
  }
  const where =
    roles.includes('admin') || roles.includes('mgmt')
      ? { deletedAt: null }
      : allowedProjectIds.length
        ? { id: { in: allowedProjectIds }, deletedAt: null }
        : { id: { in: [] as string[] } };
  const projects = await p.db.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok({ items: projects });
}

export async function createProject(input: {
  body: Record<string, unknown>;
  actor: ProjectActorContext;
  logger?: ProjectApplicationLogger;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<unknown>> {
  const p = ports(input.ports);
  const body = input.body;
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
  const { hasProp: hasEndDateProp, value: endDate } = parseNullableDateField(
    body,
    'endDate',
  );
  if (isStartDateAfterEndDate(startDate, endDate)) {
    return invalidProjectPeriodError();
  }
  if (customerId) {
    const customer = await p.db.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return fail(404, {
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
  const userId = actorUserId(input.actor) ?? undefined;
  const project = await p.db.$transaction(async (tx: any) => {
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
  if (project?.id) {
    try {
      await p.createProjectCreatedNotifications({
        projectId: project.id,
        actorUserId: userId || 'system',
      });
    } catch (err) {
      input.logger?.warn?.(
        { err, projectId: project.id },
        'project created notification failed',
      );
    }
  }
  return ok(project);
}

export async function updateProject(input: {
  projectId: string;
  body: Record<string, unknown>;
  actor: ProjectActorContext;
  auditContext: AuditContext;
  logger?: ProjectApplicationLogger;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<unknown>> {
  const p = ports(input.ports);
  const { projectId, body } = input;
  const current = await p.db.project.findUnique({ where: { id: projectId } });
  if (!current) {
    return fail(404, {
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
    return fail(400, {
      error: {
        code: 'INVALID_REASON',
        message: 'reasonText is required when changing project parent',
      },
    });
  }
  if (parentChanged) {
    if (nextParentId === projectId) {
      return fail(400, {
        error: {
          code: 'INVALID_PARENT',
          message: 'Project cannot be its own parent',
        },
      });
    }
    if (nextParentId) {
      const parent = await p.db.project.findUnique({
        where: { id: nextParentId },
        select: { id: true, deletedAt: true },
      });
      if (!parent || parent.deletedAt) {
        return fail(404, {
          error: { code: 'NOT_FOUND', message: 'Parent project not found' },
        });
      }
      if (await hasCircularProjectParent(p, projectId, nextParentId)) {
        return fail(400, {
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
    const customer = await p.db.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return fail(404, {
        error: { code: 'NOT_FOUND', message: 'Customer not found' },
      });
    }
  }

  const { hasProp: hasStartDateProp, value: startDate } =
    parseNullableDateField(body, 'startDate');
  const { hasProp: hasEndDateProp, value: endDate } = parseNullableDateField(
    body,
    'endDate',
  );
  const effectiveStartDate =
    startDate === undefined ? current.startDate : startDate;
  const effectiveEndDate = endDate === undefined ? current.endDate : endDate;
  if (isStartDateAfterEndDate(effectiveStartDate, effectiveEndDate)) {
    return invalidProjectPeriodError();
  }

  const data = { ...body } as Record<string, unknown>;
  const hasStatusProp = Object.prototype.hasOwnProperty.call(body, 'status');
  const nextStatus = hasStatusProp ? body.status : current.status;
  const statusChanged = hasStatusProp && nextStatus !== current.status;
  if (hasCustomerIdProp) data.customerId = customerId;
  if (hasParentIdProp) data.parentId = nextParentId;
  if (hasStartDateProp) data.startDate = startDate;
  if (hasEndDateProp) data.endDate = endDate;
  delete data.reasonText;

  const project = await p.db.project.update({
    where: { id: projectId },
    data,
  });
  if (parentChanged) {
    await p.logAudit({
      action: 'project_parent_updated',
      targetTable: 'projects',
      targetId: projectId,
      reasonText,
      metadata: {
        fromParentId: currentParentId,
        toParentId: nextParentId,
      },
      ...input.auditContext,
    });
  }
  if (statusChanged) {
    await p.logAudit({
      action: 'project_status_updated',
      targetTable: 'projects',
      targetId: projectId,
      reasonText: reasonText || undefined,
      metadata: {
        fromStatus: current.status,
        toStatus: project.status,
        ownerUserId: project.ownerUserId,
      } as Prisma.InputJsonValue,
      ...input.auditContext,
    });
    try {
      await p.createProjectStatusChangedNotifications({
        projectId,
        actorUserId: actorUserId(input.actor) || 'system',
        beforeStatus: current.status,
        afterStatus: project.status,
        ownerUserId: project.ownerUserId,
      });
    } catch (err) {
      input.logger?.warn?.(
        { err, projectId, before: current.status, after: project.status },
        'project status notification failed',
      );
    }
  }
  return ok(project);
}

export async function listProjectMembers(input: {
  projectId: string;
  actor: ProjectActorContext;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const access = await ensureMembershipAccess({
    p,
    actor: input.actor,
    projectId: input.projectId,
  });
  if (isApplicationFailure(access)) return access;
  const items = await p.db.projectMember.findMany({
    where: { projectId: input.projectId },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ items });
}

export async function listProjectMemberCandidates(input: {
  projectId: string;
  query?: string;
  actor: ProjectActorContext;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const access = await ensureMembershipAccess({
    p,
    actor: input.actor,
    projectId: input.projectId,
  });
  if (isApplicationFailure(access)) return access;
  const keyword = (input.query || '').trim().slice(0, 64);
  if (keyword.length < 2) return ok({ items: [] });
  const escapedKeyword = keyword.replace(/[%_\\]/g, '\\$&');
  const likePattern = `%${escapedKeyword}%`;
  const users = await p.db.$queryRaw<
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
            WHERE pm."projectId" = ${input.projectId}
              AND pm."userId" = ua."userName"
          )
        ORDER BY ua."userName" ASC
        LIMIT 20
      `;
  return ok({
    items: users.map(
      (user: {
        userName: string;
        displayName: string | null;
        department: string | null;
      }) => ({
        userId: user.userName,
        displayName: user.displayName,
        department: user.department,
      }),
    ),
  });
}

export async function addProjectMember(input: {
  projectId: string;
  body: { userId: string; role?: ProjectMemberRole };
  actor: ProjectActorContext;
  auditContext: AuditContext;
  logger?: ProjectApplicationLogger;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<unknown>> {
  const p = ports(input.ports);
  const access = await ensureMembershipAccess({
    p,
    actor: input.actor,
    projectId: input.projectId,
  });
  if (isApplicationFailure(access)) return access;
  const isPrivileged = access.isPrivileged;
  const project = await p.db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      deletedAt: true,
      currency: true,
      planHours: true,
      budgetCost: true,
    },
  });
  if (!project || project.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Project not found' },
    });
  }
  const requestedRole = input.body.role ?? 'member';
  if (!isPrivileged && requestedRole !== 'member') {
    return fail(403, {
      error: {
        code: 'FORBIDDEN_ROLE_ASSIGNMENT',
        message: 'Project leaders can only assign members',
      },
    });
  }
  const existing = await p.db.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId: input.projectId,
        userId: input.body.userId,
      },
    },
  });
  if (!isPrivileged && existing?.role === 'leader') {
    return fail(403, {
      error: {
        code: 'FORBIDDEN_LEADER_CHANGE',
        message: 'Project leaders cannot change leader roles',
      },
    });
  }
  if (existing && existing.role === requestedRole) return ok(existing);

  const data = {
    role: requestedRole,
    updatedBy: actorUserId(input.actor) ?? undefined,
  };
  let member = existing
    ? await p.db.projectMember.update({ where: { id: existing.id }, data })
    : null;
  let auditAction = existing
    ? 'project_member_role_updated'
    : 'project_member_added';
  let previousRole = existing?.role ?? null;
  if (!member) {
    try {
      member = await p.db.projectMember.create({
        data: {
          projectId: input.projectId,
          userId: input.body.userId,
          role: requestedRole,
          createdBy: actorUserId(input.actor) ?? undefined,
          updatedBy: actorUserId(input.actor) ?? undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          const fallback = await p.db.projectMember.findUnique({
            where: {
              projectId_userId: {
                projectId: input.projectId,
                userId: input.body.userId,
              },
            },
          });
          if (!fallback) throw err;
          if (!isPrivileged && fallback.role === 'leader') {
            return fail(403, {
              error: {
                code: 'FORBIDDEN_LEADER_CHANGE',
                message: 'Project leaders cannot change leader roles',
              },
            });
          }
          if (fallback.role === requestedRole) return ok(fallback);
          previousRole = fallback.role;
          auditAction = 'project_member_role_updated';
          member = await p.db.projectMember.update({
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
    return fail(500, {
      error: {
        code: 'PROJECT_MEMBER_SAVE_FAILED',
        message: 'Project member could not be saved',
      },
    });
  }

  await p.logAudit({
    ...input.auditContext,
    action: auditAction,
    targetTable: 'ProjectMember',
    targetId: member.id,
    metadata: {
      projectId: input.projectId,
      userId: input.body.userId,
      role: requestedRole,
      previousRole,
    },
  });
  if (auditAction === 'project_member_added') {
    await tryCreateProjectMemberAddedNotifications({
      p,
      logger: input.logger,
      projectId: input.projectId,
      actorUserId: actorUserId(input.actor),
      items: [{ userId: member.userId, role: requestedRole }],
      source: 'single',
    });
  }
  return ok(member);
}

export async function bulkAddProjectMembers(input: {
  projectId: string;
  body: { items: Array<{ userId: string; role?: ProjectMemberRole }> };
  actor: ProjectActorContext;
  auditContext: AuditContext;
  logger?: ProjectApplicationLogger;
  ports?: ProjectApplicationPortOverrides;
}): Promise<
  ProjectApplicationResult<{
    added: number;
    skipped: number;
    failed: number;
    failures: Array<{ userId: string | null; reason: string }>;
  }>
> {
  const p = ports(input.ports);
  const access = await ensureMembershipAccess({
    p,
    actor: input.actor,
    projectId: input.projectId,
  });
  if (isApplicationFailure(access)) return access;
  const isPrivileged = access.isPrivileged;
  const project = await p.db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, deletedAt: true },
  });
  if (!project || project.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Project not found' },
    });
  }

  const actorId = actorUserId(input.actor) ?? undefined;
  const failureDetails: Array<{ userId: string | null; reason: string }> = [];
  let added = 0;
  let skipped = 0;
  let failed = 0;
  const seen = new Set<string>();
  const normalized: ProjectNotificationItem[] = [];

  for (const item of input.body.items) {
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
      return fail(403, {
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
    return ok({ added, skipped, failed, failures: failureDetails });
  }

  const existing = await p.db.projectMember.findMany({
    where: {
      projectId: input.projectId,
      userId: { in: normalized.map((item) => item.userId) },
    },
    select: { userId: true },
  });
  const existingSet = new Set(existing.map((member: any) => member.userId));
  const toCreate = normalized.filter((item) => {
    if (existingSet.has(item.userId)) {
      skipped += 1;
      return false;
    }
    return true;
  });

  let members: any[] = [];
  if (toCreate.length > 0) {
    try {
      members = await p.db.$transaction(async (tx: any) => {
        const created: any[] = [];
        for (const item of toCreate) {
          created.push(
            await tx.projectMember.create({
              data: {
                projectId: input.projectId,
                userId: item.userId,
                role: item.role,
                createdBy: actorId,
                updatedBy: actorId,
              },
            }),
          );
        }
        return created;
      });
    } catch (err) {
      input.logger?.warn?.(
        { err, projectId: input.projectId },
        'Failed to create project members in bulk import transaction',
      );
      failed += toCreate.length;
      for (const item of toCreate) {
        if (failureDetails.length >= 5) break;
        failureDetails.push({ userId: item.userId, reason: 'create_failed' });
      }
      return ok({ added, skipped, failed, failures: failureDetails });
    }
  }

  added += members.length;
  for (const member of members) {
    const requested = toCreate.find((item) => item.userId === member.userId);
    await p.logAudit({
      ...input.auditContext,
      action: 'project_member_added',
      targetTable: 'ProjectMember',
      targetId: member.id,
      metadata: {
        projectId: input.projectId,
        userId: member.userId,
        role: requested?.role ?? member.role,
        source: 'bulk',
      },
    });
  }
  await tryCreateProjectMemberAddedNotifications({
    p,
    logger: input.logger,
    projectId: input.projectId,
    actorUserId: actorId,
    items: members.map((member) => ({
      userId: member.userId,
      role: member.role as ProjectMemberRole,
    })),
    source: 'bulk',
  });
  return ok({ added, skipped, failed, failures: failureDetails });
}

export async function removeProjectMember(input: {
  projectId: string;
  userId: string;
  actor: ProjectActorContext;
  auditContext: AuditContext;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<{ ok: true }>> {
  const p = ports(input.ports);
  const access = await ensureMembershipAccess({
    p,
    actor: input.actor,
    projectId: input.projectId,
  });
  if (isApplicationFailure(access)) return access;
  const isPrivileged = access.isPrivileged;
  const member = await p.db.projectMember.findUnique({
    where: {
      projectId_userId: { projectId: input.projectId, userId: input.userId },
    },
  });
  if (!member) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Project member not found' },
    });
  }
  if (!isPrivileged && member.role === 'leader') {
    return fail(403, {
      error: {
        code: 'FORBIDDEN_MEMBER_REMOVAL',
        message: 'Project leaders cannot remove leaders',
      },
    });
  }
  await p.db.projectMember.delete({ where: { id: member.id } });
  await p.logAudit({
    ...input.auditContext,
    action: 'project_member_removed',
    targetTable: 'ProjectMember',
    targetId: member.id,
    metadata: {
      projectId: input.projectId,
      userId: input.userId,
      role: member.role,
    },
  });
  return ok({ ok: true });
}

export async function reassignProjectTask(input: {
  projectId: string;
  taskId: string;
  body: {
    toProjectId: string;
    moveTimeEntries?: boolean;
    reasonCode: string;
    reasonText?: string | null;
  };
  actor: ProjectActorContext;
  auditContext: AuditContext;
  ports?: ProjectApplicationPortOverrides;
}): Promise<ProjectApplicationResult<unknown>> {
  const p = ports(input.ports);
  const { projectId, taskId, body } = input;
  const moveTimeEntries = body.moveTimeEntries === true;
  const reasonText =
    typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
  if (!reasonText) {
    return fail(400, {
      error: { code: 'INVALID_REASON', message: 'reasonText is required' },
    });
  }
  const task = await p.db.projectTask.findUnique({ where: { id: taskId } });
  if (!task || task.projectId !== projectId) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    });
  }
  if (task.deletedAt) {
    return fail(400, {
      error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
    });
  }
  const targetProject = await p.db.project.findUnique({
    where: { id: body.toProjectId },
    select: { id: true },
  });
  if (!targetProject) {
    return fail(404, {
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
    p.db.projectTask.count({
      where: { parentTaskId: taskId, deletedAt: null },
    }),
    p.db.timeEntry.count({ where: { taskId, deletedAt: null } }),
    p.db.projectTaskDependency.count({
      where: {
        projectId,
        OR: [{ fromTaskId: taskId }, { toTaskId: taskId }],
      },
    }),
    p.db.estimateLine.count({ where: { taskId } }),
    p.db.billingLine.count({ where: { taskId } }),
    p.db.purchaseOrderLine.count({ where: { taskId } }),
  ]);
  if (
    childCount > 0 ||
    (!moveTimeEntries && timeCount > 0) ||
    dependencyCount > 0 ||
    estimateCount > 0 ||
    invoiceCount > 0 ||
    poCount > 0
  ) {
    return fail(400, {
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
    timeEntries = await p.db.timeEntry.findMany({
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
      return fail(400, {
        error: { code: 'BILLED', message: 'Time entry already billed' },
      });
    }
    const approvedEntry = timeEntries.find(
      (entry) => entry.status === TimeStatusValue.approved,
    );
    if (approvedEntry) {
      return fail(400, {
        error: { code: 'INVALID_STATUS', message: 'Time entry approved' },
      });
    }
    const pendingApproval = await p.db.approvalInstance.findFirst({
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
      return fail(400, {
        error: { code: 'PENDING_APPROVAL', message: 'Approval in progress' },
      });
    }
    const lockCache = new Map<string, boolean>();
    const isLocked = async (periodKey: string, targetProjectId: string) => {
      const cacheKey = `${periodKey}:${targetProjectId}`;
      if (lockCache.has(cacheKey)) return lockCache.get(cacheKey) ?? false;
      const lock = await p.findPeriodLock(periodKey, targetProjectId);
      const locked = Boolean(lock);
      lockCache.set(cacheKey, locked);
      return locked;
    };
    for (const entry of timeEntries) {
      const periodKey = p.toPeriodKey(entry.workDate);
      const fromLocked = await isLocked(periodKey, entry.projectId);
      if (fromLocked) {
        return fail(400, {
          error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
        });
      }
      if (body.toProjectId !== entry.projectId) {
        const toLocked = await isLocked(periodKey, body.toProjectId);
        if (toLocked) {
          return fail(400, {
            error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
          });
        }
      }
    }
  }

  const updated = await p.db.$transaction(async (tx: any) => {
    const taskUpdate = await tx.projectTask.update({
      where: { id: taskId },
      data: { projectId: body.toProjectId },
    });
    if (moveTimeEntries && timeEntries.length) {
      await tx.timeEntry.updateMany({
        where: { id: { in: timeEntries.map((entry) => entry.id) } },
        data: { projectId: body.toProjectId },
      });
    }
    return taskUpdate;
  });
  await p.logAudit({
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
    ...input.auditContext,
  });
  await p.logReassignment({
    targetTable: 'project_tasks',
    targetId: taskId,
    fromProjectId: projectId,
    toProjectId: body.toProjectId,
    fromTaskId: taskId,
    toTaskId: taskId,
    reasonCode: body.reasonCode,
    reasonText,
    createdBy: actorUserId(input.actor) ?? undefined,
  });
  if (moveTimeEntries && timeEntries.length) {
    await Promise.all(
      timeEntries.map((entry) =>
        p.logAudit({
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
          ...input.auditContext,
        }),
      ),
    );
    await Promise.all(
      timeEntries.map((entry) =>
        p.logReassignment({
          targetTable: 'time_entries',
          targetId: entry.id,
          fromProjectId: entry.projectId,
          toProjectId: body.toProjectId,
          fromTaskId: entry.taskId,
          toTaskId: entry.taskId,
          reasonCode: body.reasonCode,
          reasonText,
          createdBy: actorUserId(input.actor) ?? undefined,
        }),
      ),
    );
  }
  return ok(updated);
}
