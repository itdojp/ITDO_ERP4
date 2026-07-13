import { prisma as defaultPrisma } from '../../services/db.js';
import { toNumber } from '../../services/utils.js';

type ProjectMilestoneApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

type ProjectMilestoneApplicationResult<T> =
  { ok: true; value: T } | ProjectMilestoneApplicationFailure;

type ProjectMilestoneApplicationLogger = {
  warn?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
};

type ProjectMilestoneApplicationPorts = {
  db: any;
  now: () => Date;
  logger: ProjectMilestoneApplicationLogger;
};

export type ProjectMilestoneApplicationPortOverrides = Partial<
  Omit<ProjectMilestoneApplicationPorts, 'logger'>
> & {
  logger?: ProjectMilestoneApplicationLogger;
};

type ProjectMilestoneBody = {
  name: string;
  amount: number;
  billUpon?: string;
  dueDate?: string;
  taxRate?: number;
};

type ProjectMilestonePatchBody = Partial<ProjectMilestoneBody>;

const consoleLogger: ProjectMilestoneApplicationLogger = {
  warn: (payload, message) => console.warn(message ?? '[milestone]', payload),
  error: (payload, message) => console.error(message ?? '[milestone]', payload),
};

const defaultPorts: ProjectMilestoneApplicationPorts = {
  db: defaultPrisma,
  now: () => new Date(),
  logger: consoleLogger,
};

function ports(
  overrides?: ProjectMilestoneApplicationPortOverrides,
): ProjectMilestoneApplicationPorts {
  return {
    ...defaultPorts,
    ...(overrides ?? {}),
    logger: overrides?.logger ?? defaultPorts.logger,
  };
}

function ok<T>(value: T): ProjectMilestoneApplicationResult<T> {
  return { ok: true, value };
}

function fail(
  statusCode: number,
  body: unknown,
): ProjectMilestoneApplicationFailure {
  return { ok: false, statusCode, body };
}

function notFoundError() {
  return fail(404, {
    error: { code: 'NOT_FOUND', message: 'Milestone not found' },
  });
}

function alreadyDeletedError() {
  return fail(400, {
    error: {
      code: 'ALREADY_DELETED',
      message: 'Milestone already deleted',
    },
  });
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function buildProjectMilestoneCreateData(input: {
  projectId: string;
  body: ProjectMilestoneBody;
}) {
  return {
    projectId: input.projectId,
    name: input.body.name,
    amount: input.body.amount,
    billUpon: input.body.billUpon || 'date',
    dueDate: input.body.dueDate ? new Date(input.body.dueDate) : null,
    taxRate: input.body.taxRate,
  };
}

export function buildProjectMilestonePatchData(
  body: ProjectMilestonePatchBody,
) {
  return {
    name: body.name,
    amount: body.amount,
    billUpon: body.billUpon,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    taxRate: body.taxRate,
  };
}

async function findExistingMilestone(input: {
  p: ProjectMilestoneApplicationPorts;
  projectId: string;
  milestoneId: string;
}): Promise<unknown | ProjectMilestoneApplicationFailure> {
  const milestone = await input.p.db.projectMilestone.findUnique({
    where: { id: input.milestoneId },
  });
  if (!milestone || milestone.projectId !== input.projectId) {
    return notFoundError();
  }
  if (milestone.deletedAt) {
    return alreadyDeletedError();
  }
  return milestone;
}

function isApplicationFailure(
  value: unknown,
): value is ProjectMilestoneApplicationFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok?: unknown }).ok === false
  );
}

export async function createProjectMilestone(input: {
  projectId: string;
  body: ProjectMilestoneBody;
  ports?: ProjectMilestoneApplicationPortOverrides;
}): Promise<ProjectMilestoneApplicationResult<unknown>> {
  const p = ports(input.ports);
  const milestone = await p.db.projectMilestone.create({
    data: buildProjectMilestoneCreateData({
      projectId: input.projectId,
      body: input.body,
    }),
  });
  return ok(milestone);
}

export async function listProjectMilestones(input: {
  projectId: string;
  ports?: ProjectMilestoneApplicationPortOverrides;
}): Promise<ProjectMilestoneApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const items = await p.db.projectMilestone.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return ok({ items });
}

export async function updateProjectMilestone(input: {
  projectId: string;
  milestoneId: string;
  body: ProjectMilestonePatchBody;
  ports?: ProjectMilestoneApplicationPortOverrides;
}): Promise<ProjectMilestoneApplicationResult<unknown>> {
  const p = ports(input.ports);
  const existing = await findExistingMilestone({
    p,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
  });
  if (isApplicationFailure(existing)) return existing;

  const lockedInvoice = await p.db.invoice.findFirst({
    where: {
      milestoneId: input.milestoneId,
      deletedAt: null,
      status: { not: 'draft' },
    },
    select: { id: true },
  });
  if (lockedInvoice) {
    return fail(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Milestone has submitted invoices and cannot be updated',
      },
    });
  }

  const updated = await p.db.projectMilestone.update({
    where: { id: input.milestoneId },
    data: buildProjectMilestonePatchData(input.body),
  });
  if (hasOwn(input.body, 'amount') && typeof input.body.amount === 'number') {
    await syncDraftInvoicesForMilestoneAmount({
      p,
      milestoneId: input.milestoneId,
      amount: input.body.amount,
    });
  }
  return ok(updated);
}

async function syncDraftInvoicesForMilestoneAmount(input: {
  p: ProjectMilestoneApplicationPorts;
  milestoneId: string;
  amount: number;
}) {
  const draftInvoices = await input.p.db.invoice.findMany({
    where: {
      milestoneId: input.milestoneId,
      deletedAt: null,
      status: 'draft',
    },
    select: {
      id: true,
      totalAmount: true,
      lines: { select: { id: true, quantity: true, unitPrice: true } },
    },
  });
  const amountTolerance = 0.0001;
  const updates: unknown[] = [];
  const updatedInvoiceIds: string[] = [];
  for (const invoice of draftInvoices) {
    if (invoice.lines.length !== 1) {
      input.p.logger.warn?.(
        {
          invoiceId: invoice.id,
          reason: 'line_count',
          lineCount: invoice.lines.length,
        },
        '[milestone] invoice sync skipped',
      );
      continue;
    }
    const line = invoice.lines[0];
    if (!line) continue;
    const quantity = toNumber(line.quantity);
    if (quantity !== 1) {
      input.p.logger.warn?.(
        {
          invoiceId: invoice.id,
          reason: 'quantity',
          quantity,
        },
        '[milestone] invoice sync skipped',
      );
      continue;
    }
    const lineTotal = quantity * toNumber(line.unitPrice);
    const invoiceTotal = toNumber(invoice.totalAmount);
    if (Math.abs(lineTotal - invoiceTotal) > amountTolerance) {
      input.p.logger.warn?.(
        {
          invoiceId: invoice.id,
          reason: 'manual_adjustment',
          lineTotal,
          invoiceTotal,
        },
        '[milestone] invoice sync skipped',
      );
      continue;
    }
    updates.push(
      input.p.db.billingLine.update({
        where: { id: line.id },
        data: { unitPrice: input.amount },
      }),
      input.p.db.invoice.update({
        where: { id: invoice.id },
        data: { totalAmount: input.amount },
      }),
    );
    updatedInvoiceIds.push(invoice.id);
  }
  if (!updates.length) return;
  try {
    await input.p.db.$transaction(updates);
  } catch (err) {
    input.p.logger.error?.(
      {
        milestoneId: input.milestoneId,
        invoiceIds: updatedInvoiceIds,
        error: err,
      },
      '[milestone] invoice sync failed',
    );
  }
}

export async function deleteProjectMilestone(input: {
  projectId: string;
  milestoneId: string;
  body: { reason?: string };
  ports?: ProjectMilestoneApplicationPortOverrides;
}): Promise<ProjectMilestoneApplicationResult<unknown>> {
  const p = ports(input.ports);
  const existing = await findExistingMilestone({
    p,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
  });
  if (isApplicationFailure(existing)) return existing;

  const linkedInvoice = await p.db.invoice.findFirst({
    where: {
      milestoneId: input.milestoneId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (linkedInvoice) {
    return fail(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Milestone has linked invoices and cannot be deleted',
      },
    });
  }

  const updated = await p.db.projectMilestone.update({
    where: { id: input.milestoneId },
    data: {
      deletedAt: p.now(),
      deletedReason: input.body.reason,
    },
  });
  return ok(updated);
}
