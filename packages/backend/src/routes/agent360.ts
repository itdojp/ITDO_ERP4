import { FastifyInstance } from 'fastify';
import type { DocStatus, Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { requireUserContext } from '../services/authContext.js';
import { createApiErrorResponse } from '../services/errors.js';
import { parseDateParam } from '../utils/date.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { toNumber } from '../services/utils.js';

type DateRange = {
  from?: Date;
  to?: Date;
};

type ScopeResolution = {
  scopeProjectIds?: string[];
  scopeMode: 'all' | 'assigned' | 'project';
};

type StatusSummary = {
  totalCount: number;
  totalAmount: number;
  byStatus: Record<string, { count: number; amount?: number }>;
};

const ALLOWED_ROLES = ['admin', 'mgmt', 'exec', 'user'];
const PENDING_APPROVAL_STATUSES: DocStatus[] = ['pending_qa', 'pending_exec'];
const OPEN_RECEIVABLE_STATUSES: DocStatus[] = ['approved', 'sent'];
const OPEN_PAYABLE_STATUSES: DocStatus[] = ['received', 'approved'];
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type RangeCondition = {
  gte?: Date;
  lte?: Date;
};

function isDateOnlyString(value: string | undefined): boolean {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim());
}

function toStartOfDayUtc(value: Date): Date {
  const normalized = new Date(value);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function toEndOfDayUtc(value: Date): Date {
  const normalized = new Date(value);
  normalized.setUTCHours(23, 59, 59, 999);
  return normalized;
}

function parseDateRange(query: Record<string, unknown>): {
  range?: DateRange;
  error?: { code: string; message: string };
} {
  const fromRaw = typeof query.from === 'string' ? query.from : undefined;
  const toRaw = typeof query.to === 'string' ? query.to : undefined;
  const from = parseDateParam(fromRaw);
  const to = parseDateParam(toRaw);
  if (fromRaw && !from) {
    return { error: { code: 'INVALID_DATE', message: 'Invalid from date' } };
  }
  if (toRaw && !to) {
    return { error: { code: 'INVALID_DATE', message: 'Invalid to date' } };
  }
  const normalizedFrom =
    from && isDateOnlyString(fromRaw) ? toStartOfDayUtc(from) : from;
  const normalizedTo = to && isDateOnlyString(toRaw) ? toEndOfDayUtc(to) : to;
  if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
    return {
      error: {
        code: 'INVALID_DATE_RANGE',
        message: 'from must be before or equal to to',
      },
    };
  }
  if (!normalizedFrom && !normalizedTo) return {};
  return {
    range: {
      from: normalizedFrom ?? undefined,
      to: normalizedTo ?? undefined,
    },
  };
}

function resolveScope(
  user: ReturnType<typeof requireUserContext>,
  projectId: string | undefined,
): ScopeResolution | null {
  const isPrivileged =
    user.roles.includes('admin') || user.roles.includes('mgmt');
  const allowedProjectIds = Array.isArray(user.projectIds)
    ? user.projectIds
    : [];

  if (projectId) {
    if (isPrivileged || allowedProjectIds.includes(projectId)) {
      return { scopeProjectIds: [projectId], scopeMode: 'project' };
    }
    return null;
  }
  if (isPrivileged) return { scopeMode: 'all' };
  return { scopeProjectIds: allowedProjectIds, scopeMode: 'assigned' };
}

function buildRangeCondition(range?: DateRange): RangeCondition | undefined {
  if (!range?.from && !range?.to) return undefined;
  const value: RangeCondition = {};
  if (range.from) value.gte = range.from;
  if (range.to) value.lte = range.to;
  return value;
}

function summarizeStatusRows(
  rows: Array<{
    status: string;
    _count: { _all: number };
    _sum?: Record<string, unknown>;
  }>,
  amountField?: string,
): StatusSummary {
  const byStatus: Record<string, { count: number; amount?: number }> = {};
  let totalCount = 0;
  let totalAmount = 0;
  for (const row of rows) {
    const count = row._count._all || 0;
    const amount =
      amountField && row._sum ? toNumber(row._sum[amountField]) : undefined;
    totalCount += count;
    if (typeof amount === 'number') totalAmount += amount;
    byStatus[row.status] = {
      count,
      ...(typeof amount === 'number' ? { amount } : {}),
    };
  }
  return { totalCount, totalAmount, byStatus };
}

export async function registerAgent360Routes(app: FastifyInstance) {
  app.get(
    '/project-360',
    { preHandler: requireRole(ALLOWED_ROLES) },
    async (req, reply) => {
      const user = requireUserContext(req);
      const query = (req.query || {}) as {
        projectId?: string;
        from?: string;
        to?: string;
      };
      const parsed = parseDateRange(query as Record<string, unknown>);
      if (parsed.error) {
        return reply
          .code(400)
          .send(
            createApiErrorResponse(parsed.error.code, parsed.error.message),
          );
      }
      const scope = resolveScope(user, query.projectId);
      if (!scope) {
        return reply.code(403).send(
          createApiErrorResponse('forbidden_project', 'Forbidden', {
            category: 'permission',
          }),
        );
      }

      const projectWhere = {
        deletedAt: null,
        ...(scope.scopeProjectIds ? { id: { in: scope.scopeProjectIds } } : {}),
      };
      const recordProjectWhere = {
        deletedAt: null,
        ...(scope.scopeProjectIds
          ? { projectId: { in: scope.scopeProjectIds } }
          : {}),
      };
      const issueDateRange = buildRangeCondition(parsed.range);
      const workDateRange = buildRangeCondition(parsed.range);
      const incurredOnRange = buildRangeCondition(parsed.range);
      const approvalCreatedAtRange = buildRangeCondition(parsed.range);

      const [projectRows, invoiceRows, timeRows, expenseRows, approvalRows] =
        await Promise.all([
          prisma.project.groupBy({
            by: ['status'],
            _count: { _all: true },
            where: projectWhere,
          }),
          prisma.invoice.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { totalAmount: true },
            where: {
              ...recordProjectWhere,
              ...(issueDateRange ? { issueDate: issueDateRange } : {}),
            },
          }),
          prisma.timeEntry.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { minutes: true },
            where: {
              ...recordProjectWhere,
              ...(workDateRange ? { workDate: workDateRange } : {}),
            },
          }),
          prisma.expense.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { amount: true },
            where: {
              ...recordProjectWhere,
              ...(incurredOnRange ? { incurredOn: incurredOnRange } : {}),
            },
          }),
          prisma.approvalInstance.groupBy({
            by: ['status', 'flowType'],
            _count: { _all: true },
            where: {
              status: { in: PENDING_APPROVAL_STATUSES },
              ...(scope.scopeProjectIds
                ? { projectId: { in: scope.scopeProjectIds } }
                : {}),
              ...(approvalCreatedAtRange
                ? { createdAt: approvalCreatedAtRange }
                : {}),
            },
          }),
        ]);

      const projectCounts: Record<string, number> = {};
      for (const row of projectRows) {
        projectCounts[row.status] = row._count._all || 0;
      }

      const invoiceSummary = summarizeStatusRows(invoiceRows, 'totalAmount');
      const timeSummaryRaw = summarizeStatusRows(timeRows, 'minutes');
      const expenseSummary = summarizeStatusRows(expenseRows, 'amount');
      const timeSummary = {
        totalCount: timeSummaryRaw.totalCount,
        totalMinutes: timeSummaryRaw.totalAmount,
        byStatus: Object.fromEntries(
          Object.entries(timeSummaryRaw.byStatus).map(([status, summary]) => [
            status,
            {
              count: summary.count,
              ...(typeof summary.amount === 'number'
                ? { minutes: summary.amount }
                : {}),
            },
          ]),
        ),
      };

      const approvalByFlow: Record<string, number> = {};
      let pendingApprovals = 0;
      for (const row of approvalRows) {
        const count = row._count._all || 0;
        pendingApprovals += count;
        approvalByFlow[row.flowType] =
          (approvalByFlow[row.flowType] || 0) + count;
      }

      const response = {
        generatedAt: new Date().toISOString(),
        scope: {
          mode: scope.scopeMode,
          projectId: query.projectId ?? null,
          projectCount: scope.scopeProjectIds?.length ?? null,
          from: parsed.range?.from?.toISOString() ?? null,
          to: parsed.range?.to?.toISOString() ?? null,
        },
        projects: {
          byStatus: projectCounts,
          total: Object.values(projectCounts).reduce(
            (sum, value) => sum + value,
            0,
          ),
        },
        billing: invoiceSummary,
        effort: {
          timeEntries: timeSummary,
          expenses: expenseSummary,
        },
        approvals: {
          pendingTotal: pendingApprovals,
          pendingByFlow: approvalByFlow,
        },
      };

      await logAudit({
        action: 'project_360_viewed',
        targetTable: 'project_360',
        metadata: response as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return response;
    },
  );

  app.get(
    '/billing-360',
    { preHandler: requireRole(ALLOWED_ROLES) },
    async (req, reply) => {
      const user = requireUserContext(req);
      const query = (req.query || {}) as {
        projectId?: string;
        from?: string;
        to?: string;
      };
      const parsed = parseDateRange(query as Record<string, unknown>);
      if (parsed.error) {
        return reply
          .code(400)
          .send(
            createApiErrorResponse(parsed.error.code, parsed.error.message),
          );
      }
      const scope = resolveScope(user, query.projectId);
      if (!scope) {
        return reply.code(403).send(
          createApiErrorResponse('forbidden_project', 'Forbidden', {
            category: 'permission',
          }),
        );
      }

      const invoiceWhere: Prisma.InvoiceWhereInput = {
        deletedAt: null,
        ...(scope.scopeProjectIds
          ? { projectId: { in: scope.scopeProjectIds } }
          : {}),
      };
      const issueDateRange = buildRangeCondition(parsed.range);
      if (issueDateRange) {
        invoiceWhere.issueDate = issueDateRange;
      }
      const vendorInvoiceWhere: Prisma.VendorInvoiceWhereInput = {
        deletedAt: null,
        ...(scope.scopeProjectIds
          ? { projectId: { in: scope.scopeProjectIds } }
          : {}),
      };
      const receivedDateRange = buildRangeCondition(parsed.range);
      if (receivedDateRange) {
        vendorInvoiceWhere.receivedDate = receivedDateRange;
      }

      const now = new Date();
      const [invoiceRows, openReceivableAgg, paidAgg, overdueAgg, vendorRows] =
        await Promise.all([
          prisma.invoice.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { totalAmount: true },
            where: invoiceWhere,
          }),
          prisma.invoice.aggregate({
            where: {
              ...invoiceWhere,
              status: { in: OPEN_RECEIVABLE_STATUSES },
            },
            _sum: { totalAmount: true },
          }),
          prisma.invoice.aggregate({
            where: { ...invoiceWhere, status: 'paid' },
            _sum: { totalAmount: true },
          }),
          prisma.invoice.aggregate({
            where: {
              ...invoiceWhere,
              status: { in: OPEN_RECEIVABLE_STATUSES },
              dueDate: { lt: now },
            },
            _count: { id: true },
            _sum: { totalAmount: true },
          }),
          prisma.vendorInvoice.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { totalAmount: true },
            where: vendorInvoiceWhere,
          }),
        ]);

      const invoiceSummary = summarizeStatusRows(invoiceRows, 'totalAmount');
      const vendorSummary = summarizeStatusRows(vendorRows, 'totalAmount');
      const openReceivable = toNumber(openReceivableAgg._sum?.totalAmount);
      const paidAmount = toNumber(paidAgg._sum?.totalAmount);
      const overdueAmount = toNumber(overdueAgg._sum?.totalAmount);
      const overdueCount = overdueAgg._count?.id || 0;
      const openPayable = OPEN_PAYABLE_STATUSES.reduce((sum, status) => {
        const row = vendorSummary.byStatus[status];
        return sum + (row?.amount || 0);
      }, 0);

      const response = {
        generatedAt: now.toISOString(),
        scope: {
          mode: scope.scopeMode,
          projectId: query.projectId ?? null,
          projectCount: scope.scopeProjectIds?.length ?? null,
          from: parsed.range?.from?.toISOString() ?? null,
          to: parsed.range?.to?.toISOString() ?? null,
        },
        invoices: invoiceSummary,
        receivables: {
          openAmount: openReceivable,
          paidAmount,
          overdueAmount,
          overdueCount,
        },
        payables: {
          vendorInvoices: vendorSummary,
          openAmount: openPayable,
        },
      };

      await logAudit({
        action: 'billing_360_viewed',
        targetTable: 'billing_360',
        metadata: response as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return response;
    },
  );
}
