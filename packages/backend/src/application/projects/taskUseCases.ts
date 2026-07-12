import type { AuditContext } from '../../services/audit.js';
import { logAudit as defaultLogAudit } from '../../services/audit.js';
import { prisma as defaultPrisma } from '../../services/db.js';
import {
  addTaskDependency,
  buildTaskDependencyGraph,
  buildTaskParentMap,
  hasTaskDependencyPath,
  hasTaskParentCycle,
  normalizeParentId,
  removeTaskDependency,
} from '../../services/taskDependencyGraph.js';
import {
  isPrivilegedProjectRole,
  type ProjectActorContext,
} from './useCases.js';

export type ProjectTaskApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type ProjectTaskApplicationResult<T> =
  { ok: true; value: T } | ProjectTaskApplicationFailure;

type ProjectTaskApplicationPorts = {
  db: any;
  logAudit: typeof defaultLogAudit;
  now: () => Date;
};

export type ProjectTaskApplicationPortOverrides =
  Partial<ProjectTaskApplicationPorts>;

const defaultPorts: ProjectTaskApplicationPorts = {
  db: defaultPrisma,
  logAudit: defaultLogAudit,
  now: () => new Date(),
};

function ports(
  overrides?: ProjectTaskApplicationPortOverrides,
): ProjectTaskApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): ProjectTaskApplicationResult<T> {
  return { ok: true, value };
}

function fail(
  statusCode: number,
  body: unknown,
): ProjectTaskApplicationFailure {
  return { ok: false, statusCode, body };
}

function actorUserId(actor: ProjectActorContext): string | null {
  return typeof actor.userId === 'string' && actor.userId.trim()
    ? actor.userId
    : null;
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

async function hasCircularTaskParent(input: {
  p: ProjectTaskApplicationPorts;
  projectId: string;
  taskId: string;
  parentTaskId: string;
}): Promise<boolean> {
  const tasks = await input.p.db.projectTask.findMany({
    where: { projectId: input.projectId },
    select: { id: true, parentTaskId: true },
  });
  return hasTaskParentCycle(
    buildTaskParentMap(tasks),
    input.taskId,
    input.parentTaskId,
  );
}

async function ensureProjectLeaderPermission(input: {
  p: ProjectTaskApplicationPorts;
  actor: ProjectActorContext;
  projectId: string;
}): Promise<ProjectTaskApplicationFailure | null> {
  const userId = actorUserId(input.actor);
  if (!userId) return fail(401, { error: 'unauthorized' });
  const leader = await input.p.db.projectMember.findFirst({
    where: { projectId: input.projectId, userId, role: 'leader' },
    select: { id: true },
  });
  if (!leader) return fail(403, { error: 'forbidden_project' });
  return null;
}

function normalizePredecessorIds(rawValue: unknown): string[] {
  const rawPredecessorIds: unknown[] = Array.isArray(rawValue) ? rawValue : [];
  return Array.from(
    new Set(
      rawPredecessorIds
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export async function listProjectTasks(input: {
  projectId: string;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const items = await p.db.projectTask.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return ok({ items });
}

export async function createProjectTask(input: {
  projectId: string;
  body: Record<string, unknown>;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<unknown>> {
  const p = ports(input.ports);
  const { projectId, body } = input;
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
  const { value: actualStart } = parseNullableDateField(body, 'actualStart');
  const { value: actualEnd } = parseNullableDateField(body, 'actualEnd');
  if (isStartDateAfterEndDate(planStart, planEnd)) {
    return invalidDateRangeError('planStart', 'planEnd');
  }
  if (isStartDateAfterEndDate(actualStart, actualEnd)) {
    return invalidDateRangeError('actualStart', 'actualEnd');
  }
  if (parentTaskId) {
    const parent = await p.db.projectTask.findUnique({
      where: { id: parentTaskId },
      select: { projectId: true, deletedAt: true },
    });
    if (!parent || parent.deletedAt) {
      return fail(404, {
        error: { code: 'NOT_FOUND', message: 'Parent task not found' },
      });
    }
    if (parent.projectId !== projectId) {
      return fail(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parent task belongs to another project',
        },
      });
    }
  }
  const task = await p.db.projectTask.create({
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
  return ok(task);
}

export async function updateProjectTask(input: {
  projectId: string;
  taskId: string;
  body: Record<string, unknown>;
  auditContext: AuditContext;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<unknown>> {
  const p = ports(input.ports);
  const { projectId, taskId, body } = input;
  const current = await p.db.projectTask.findUnique({ where: { id: taskId } });
  if (!current || current.projectId !== projectId) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    });
  }
  if (current.deletedAt) {
    return fail(400, {
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
  const { hasProp: hasPlanEndProp, value: planEnd } = parseNullableDateField(
    body,
    'planEnd',
  );
  const { hasProp: hasActualStartProp, value: actualStart } =
    parseNullableDateField(body, 'actualStart');
  const { hasProp: hasActualEndProp, value: actualEnd } =
    parseNullableDateField(body, 'actualEnd');
  const effectivePlanStart =
    planStart === undefined ? current.planStart : planStart;
  const effectivePlanEnd = planEnd === undefined ? current.planEnd : planEnd;
  if (isStartDateAfterEndDate(effectivePlanStart, effectivePlanEnd)) {
    return invalidDateRangeError('planStart', 'planEnd');
  }
  const effectiveActualStart =
    actualStart === undefined ? current.actualStart : actualStart;
  const effectiveActualEnd =
    actualEnd === undefined ? current.actualEnd : actualEnd;
  if (isStartDateAfterEndDate(effectiveActualStart, effectiveActualEnd)) {
    return invalidDateRangeError('actualStart', 'actualEnd');
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
    return fail(400, {
      error: {
        code: 'INVALID_REASON',
        message: 'reasonText is required when changing task parent',
      },
    });
  }
  if (hasParentTaskIdProp) {
    if (nextParentTaskId === taskId) {
      return fail(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parent task cannot be self',
        },
      });
    }
    if (nextParentTaskId) {
      const parent = await p.db.projectTask.findUnique({
        where: { id: nextParentTaskId },
        select: { projectId: true, deletedAt: true },
      });
      if (!parent || parent.deletedAt) {
        return fail(404, {
          error: { code: 'NOT_FOUND', message: 'Parent task not found' },
        });
      }
      if (parent.projectId !== projectId) {
        return fail(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parent task belongs to another project',
          },
        });
      }
      if (
        await hasCircularTaskParent({
          p,
          projectId,
          taskId,
          parentTaskId: nextParentTaskId,
        })
      ) {
        return fail(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parent task creates circular reference',
          },
        });
      }
    }
  }
  const task = await p.db.projectTask.update({
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
    await p.logAudit({
      action: 'project_task_parent_updated',
      targetTable: 'project_tasks',
      targetId: taskId,
      reasonText,
      metadata: {
        projectId,
        fromParentTaskId: currentParentTaskId,
        toParentTaskId: nextParentTaskId ?? null,
      },
      ...input.auditContext,
    });
  }
  return ok(task);
}

export async function listProjectTaskDependencies(input: {
  projectId: string;
  taskId: string;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<{ predecessorIds: string[] }>> {
  const p = ports(input.ports);
  const { projectId, taskId } = input;
  const task = await p.db.projectTask.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, deletedAt: true },
  });
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
  const deps = await p.db.projectTaskDependency.findMany({
    where: { projectId, toTaskId: taskId, fromTask: { deletedAt: null } },
    select: { fromTaskId: true },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ predecessorIds: deps.map((dep: any) => dep.fromTaskId) });
}

export async function updateProjectTaskDependencies(input: {
  projectId: string;
  taskId: string;
  body: Record<string, unknown>;
  actor: ProjectActorContext;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<
  ProjectTaskApplicationResult<{
    predecessorIds: string[];
    added: number;
    removed: number;
  }>
> {
  const p = ports(input.ports);
  const { projectId, taskId, body } = input;
  const predecessorIds = normalizePredecessorIds(body.predecessorIds);
  if (predecessorIds.includes(taskId)) {
    return fail(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Task cannot depend on itself',
      },
    });
  }
  const task = await p.db.projectTask.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, deletedAt: true },
  });
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

  if (predecessorIds.length) {
    const predecessors = await p.db.projectTask.findMany({
      where: { id: { in: predecessorIds }, projectId, deletedAt: null },
      select: { id: true },
    });
    if (predecessors.length !== predecessorIds.length) {
      return fail(404, {
        error: {
          code: 'NOT_FOUND',
          message: 'Predecessor task not found',
        },
      });
    }
  }

  const existing = await p.db.projectTaskDependency.findMany({
    where: { projectId, toTaskId: taskId },
    select: { fromTaskId: true },
  });
  const existingIds = new Set<string>(
    existing.map((dep: any) => dep.fromTaskId),
  );
  const desiredIds = new Set<string>(predecessorIds);
  const toAdd = predecessorIds.filter((id) => !existingIds.has(id));
  const toRemove = Array.from(existingIds).filter((id) => !desiredIds.has(id));

  if (toAdd.length) {
    const edges = await p.db.projectTaskDependency.findMany({
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
        return fail(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task dependency creates circular reference',
          },
        });
      }
      addTaskDependency(graph, fromTaskId, taskId);
    }
  }

  const userId = actorUserId(input.actor) ?? undefined;
  await p.db.$transaction(async (tx: any) => {
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

  return ok({ predecessorIds, added: toAdd.length, removed: toRemove.length });
}

export async function deleteProjectTask(input: {
  projectId: string;
  taskId: string;
  body: { reason?: string | null };
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<unknown>> {
  const p = ports(input.ports);
  const { projectId, taskId } = input;
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
  const [childCount, timeCount, estimateCount, invoiceCount, poCount] =
    await Promise.all([
      p.db.projectTask.count({
        where: { parentTaskId: taskId, deletedAt: null },
      }),
      p.db.timeEntry.count({ where: { taskId, deletedAt: null } }),
      p.db.estimateLine.count({ where: { taskId } }),
      p.db.billingLine.count({ where: { taskId } }),
      p.db.purchaseOrderLine.count({ where: { taskId } }),
    ]);
  if (
    childCount > 0 ||
    timeCount > 0 ||
    estimateCount > 0 ||
    invoiceCount > 0 ||
    poCount > 0
  ) {
    return fail(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Task has linked records and cannot be deleted',
      },
    });
  }
  const updated = await p.db.$transaction(async (tx: any) => {
    const updated = await tx.projectTask.update({
      where: { id: taskId },
      data: {
        deletedAt: p.now(),
        deletedReason: input.body.reason,
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
  return ok(updated);
}

export async function listProjectBaselines(input: {
  projectId: string;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const project = await p.db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, deletedAt: true },
  });
  if (!project || project.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Project not found' },
    });
  }
  const items = await p.db.projectBaseline.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok({ items });
}

export async function getProjectBaseline(input: {
  projectId: string;
  baselineId: string;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<unknown>> {
  const p = ports(input.ports);
  const baseline = await p.db.projectBaseline.findUnique({
    where: { id: input.baselineId },
    include: {
      tasks: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!baseline || baseline.projectId !== input.projectId) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Baseline not found' },
    });
  }
  if (baseline.deletedAt) {
    return fail(400, {
      error: {
        code: 'ALREADY_DELETED',
        message: 'Baseline already deleted',
      },
    });
  }
  return ok(baseline);
}

export async function createProjectBaseline(input: {
  projectId: string;
  body: Record<string, unknown>;
  actor: ProjectActorContext;
  ports?: ProjectTaskApplicationPortOverrides;
}): Promise<ProjectTaskApplicationResult<unknown>> {
  const p = ports(input.ports);
  const { projectId, body } = input;
  const isPrivileged = isPrivilegedProjectRole(input.actor.roles);
  if (!isPrivileged) {
    const denied = await ensureProjectLeaderPermission({
      p,
      actor: input.actor,
      projectId,
    });
    if (denied) return denied;
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const baselineName = name || `baseline-${p.now().toISOString()}`;
  const project = await p.db.project.findUnique({
    where: { id: projectId },
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
  const tasks = await p.db.projectTask.findMany({
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
  const createdBy = actorUserId(input.actor) ?? undefined;
  const baseline = await p.db.$transaction(async (tx: any) => {
    const baseline = await tx.projectBaseline.create({
      data: {
        projectId,
        name: baselineName,
        currency: project.currency,
        planHours: project.planHours,
        budgetCost: project.budgetCost,
        createdBy,
      },
    });
    if (tasks.length) {
      await tx.projectBaselineTask.createMany({
        data: tasks.map((task: any) => ({
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
  return ok({ ...baseline, taskCount: tasks.length });
}
