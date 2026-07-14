import { prisma } from '../services/db.js';

import { makePoMigrationId as makeId } from './legacyIds.js';
import {
  ensureNoDuplicates,
  normalizeString,
  type ImportError,
} from './poInput.js';
import {
  buildPoTaskProjectMap,
  mapPoCustomer,
  mapPoMilestone,
  mapPoProject,
  mapPoTask,
  mapPoUser,
  mapPoVendor,
  normalizePoTaskInputs,
  type CustomerInput,
  type MilestoneInput,
  type PlannedIds,
  type ProjectInput,
  type TaskInput,
  type UserInput,
  type VendorInput,
} from './poDomain.js';
import type { PoMigrationCliOptions } from './poCli.js';
import {
  existsCache,
  existsOrPlanned,
  isPrismaUniqueConstraintError,
} from './poImporterState.js';

export async function importUsers(
  options: PoMigrationCliOptions,
  items: UserInput[],
  errors: ImportError[],
) {
  if (options.only && !options.only.has('users'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'users', errors);
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const mapped = mapPoUser(item, errors);
    if (!mapped) continue;
    const { id, data } = mapped;
    const exists = await prisma.userAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.user.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.userAccount.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.userAccount.create({ data });
        created += 1;
      }
      existsCache.user.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'users',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importCustomers(
  options: PoMigrationCliOptions,
  items: CustomerInput[],
  errors: ImportError[],
) {
  if (options.only && !options.only.has('customers'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'customers', errors);
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const { id, data } = mapPoCustomer(item);
    const exists = await prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.customer.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.customer.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.customer.create({ data });
        created += 1;
      }
      existsCache.customer.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'customers',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importVendors(
  options: PoMigrationCliOptions,
  items: VendorInput[],
  errors: ImportError[],
) {
  if (options.only && !options.only.has('vendors'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'vendors', errors);
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const { id, data } = mapPoVendor(item);
    const exists = await prisma.vendor.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.vendor.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.vendor.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.vendor.create({ data });
        created += 1;
      }
      existsCache.vendor.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'vendors',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importProjects(
  options: PoMigrationCliOptions,
  items: ProjectInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('projects'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'projects', errors);
  if (errors.length) return { created: 0, updated: 0 };

  const sorted = [...items].sort((a, b) =>
    a.legacyId.localeCompare(b.legacyId),
  );
  let created = 0;
  let updated = 0;
  for (const item of sorted) {
    const mapped = mapPoProject(item, errors);
    if (!mapped) continue;
    const { id, customerId, parentId, data } = mapped;
    if (customerId) {
      const ok = await existsOrPlanned(
        customerId,
        planned.customers,
        existsCache.customer,
        async () =>
          !!(await prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true },
          })),
      );
      if (!ok) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: `customer not found: ${item.customerLegacyId}`,
        });
        continue;
      }
    }
    if (item.parentLegacyId) {
      if (!parentId) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: `parent project not found: ${item.parentLegacyId}`,
        });
        continue;
      }
      const ok = await existsOrPlanned(
        parentId,
        planned.projects,
        existsCache.project,
        async () =>
          !!(await prisma.project.findUnique({
            where: { id: parentId },
            select: { id: true },
          })),
      );
      if (!ok) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: `parent project not found: ${item.parentLegacyId}`,
        });
        continue;
      }
      if (parentId === id) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: 'parent project must not be self',
        });
        continue;
      }
    }

    const exists = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.project.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.project.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.project.create({ data });
        created += 1;
      }
      existsCache.project.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'projects',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (errors.length) return { created, updated };

  // Second pass: set parentId and ensure project chat room exists.
  for (const item of sorted) {
    const id = makeId('project', item.legacyId);
    const parentId = item.parentLegacyId
      ? makeId('project', item.parentLegacyId)
      : null;
    if (!options.apply) continue;
    try {
      if (parentId) {
        const parent = await prisma.project.findUnique({
          where: { id: parentId },
          select: { id: true, deletedAt: true },
        });
        if (!parent || parent.deletedAt) {
          errors.push({
            scope: 'projects',
            legacyId: item.legacyId,
            message: `parent project not found: ${item.parentLegacyId}`,
          });
        } else if (parentId !== id) {
          await prisma.project.update({ where: { id }, data: { parentId } });
        }
      } else {
        await prisma.project.update({
          where: { id },
          data: { parentId: null },
        });
      }

      try {
        await prisma.chatRoom.create({
          data: {
            id,
            type: 'project',
            name: item.code,
            isOfficial: true,
            projectId: id,
          },
        });
      } catch (err) {
        if (!isPrismaUniqueConstraintError(err)) throw err;
        const existing = await prisma.chatRoom.findFirst({
          where: { type: 'project', projectId: id },
          select: { id: true },
        });
        if (!existing) throw err;
        await prisma.chatRoom.update({
          where: { id: existing.id },
          data: {
            name: item.code,
            isOfficial: true,
            projectId: id,
            deletedAt: null,
            deletedReason: null,
          },
        });
      }
    } catch (err) {
      errors.push({
        scope: 'projects',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, updated };
}

export async function importTasks(
  options: PoMigrationCliOptions,
  items: TaskInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('tasks'))
    return { created: 0, updated: 0 };
  const normalized = normalizePoTaskInputs(items) as TaskInput[];
  ensureNoDuplicates(
    normalized.map((item) => ({ legacyId: item.legacyId })),
    'tasks',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  const taskProjectMap = buildPoTaskProjectMap(normalized);

  let created = 0;
  let updated = 0;
  for (const item of normalized) {
    const mapped = mapPoTask(item, errors);
    if (!mapped) continue;
    const { id, projectId, data } = mapped;
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () =>
        !!(await prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true },
        })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const exists = await prisma.projectTask.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.task.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.projectTask.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.projectTask.create({ data });
        created += 1;
      }
      existsCache.task.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (errors.length) return { created, updated };

  // Second pass: parent relations.
  for (const item of normalized) {
    if (!item.parentLegacyId) continue;
    const id = makeId('task', item.legacyId);
    const parentTaskId = makeId('task', item.parentLegacyId);
    if (parentTaskId === id) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'parent task must not be self',
      });
      continue;
    }
    const expectedProjectId = taskProjectMap.get(id);
    const parentExpectedProjectId = taskProjectMap.get(parentTaskId);
    if (
      expectedProjectId &&
      parentExpectedProjectId &&
      expectedProjectId !== parentExpectedProjectId
    ) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'parent task belongs to another project (input validation)',
      });
      continue;
    }
    const parentOk = await existsOrPlanned(
      parentTaskId,
      planned.tasks,
      existsCache.task,
      async () =>
        !!(await prisma.projectTask.findUnique({
          where: { id: parentTaskId },
          select: { id: true },
        })),
    );
    if (!parentOk) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: `parent task not found: ${item.parentLegacyId}`,
      });
      continue;
    }
    if (!options.apply) continue;
    const parent = await prisma.projectTask.findUnique({
      where: { id: parentTaskId },
      select: { id: true, deletedAt: true, projectId: true },
    });
    if (!parent || parent.deletedAt) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: `parent task not found: ${item.parentLegacyId}`,
      });
      continue;
    }
    const current = await prisma.projectTask.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!current || current.projectId !== parent.projectId) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'parent task belongs to another project',
      });
      continue;
    }
    await prisma.projectTask.update({ where: { id }, data: { parentTaskId } });
  }

  return { created, updated };
}

export async function importMilestones(
  options: PoMigrationCliOptions,
  items: MilestoneInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('milestones'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId })),
    'milestones',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const { id, projectId, data } = mapPoMilestone(item);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () =>
        !!(await prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true },
        })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'milestones',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const exists = await prisma.projectMilestone.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.milestone.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.projectMilestone.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.projectMilestone.create({ data });
        created += 1;
      }
      existsCache.milestone.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'milestones',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}
