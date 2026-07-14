import { prisma } from '../services/db.js';

import { makePoMigrationId as makeId } from './legacyIds.js';
import { type ImportError } from './poInput.js';
import {
  buildPoMigrationPlannedIds,
  formatPoMigrationIssues,
  formatPoMigrationSummary,
  hasPoMigrationBlockingIssues,
  shouldRunPoScope,
  withImportTotal,
  type ImportSummary,
  type PoMigrationInputs,
} from './poDomain.js';
import {
  formatPoCliHelp,
  parsePoCliRequest,
  type PoMigrationCliOptions,
  type PoMigrationEnvironment,
  type PoMigrationLogger,
} from './poCli.js';
import {
  importCustomers,
  importMilestones,
  importProjects,
  importTasks,
  importUsers,
  importVendors,
} from './poImportersCore.js';
import {
  importEstimates,
  importExpenses,
  importInvoices,
  importPurchaseOrders,
  importTimeEntries,
  importVendorInvoices,
  importVendorQuotes,
} from './poImportersDocuments.js';
import { readPoMigrationInputs } from './poInputReader.js';

function shouldRun(options: PoMigrationCliOptions, key: string) {
  return shouldRunPoScope(options.only, key);
}

export type PoMigrationRunResult = {
  exitCode: number;
  summary?: ImportSummary;
  errors?: ImportError[];
  verifyErrors?: ImportError[];
};

type PoMigrationRuntime = {
  env?: PoMigrationEnvironment;
  logger?: PoMigrationLogger;
};

export async function runPoMigration(
  options: PoMigrationCliOptions,
  inputs: PoMigrationInputs,
  errors: ImportError[] = [],
  runtime: PoMigrationRuntime = {},
): Promise<PoMigrationRunResult> {
  const logger = runtime.logger ?? console;
  const env = runtime.env ?? process.env;
  const {
    users,
    customers,
    vendors,
    projects,
    tasks,
    milestones,
    estimates,
    invoices,
    purchase_orders: purchaseOrders,
    vendor_quotes: vendorQuotes,
    vendor_invoices: vendorInvoices,
    time_entries: timeEntries,
    expenses,
  } = inputs;
  const planned = buildPoMigrationPlannedIds(inputs, options.only);

  logger.log('[migration-po] input dir:', options.inputDir);
  logger.log('[migration-po] input format:', options.inputFormat);
  logger.log('[migration-po] mode:', options.apply ? 'apply' : 'dry-run');
  if (options.only)
    logger.log('[migration-po] only:', Array.from(options.only).join(','));

  const summary: ImportSummary = {};

  if (shouldRun(options, 'users')) {
    const res = await importUsers(options, users, errors);
    summary.users = withImportTotal(res, users.length);
  }
  if (shouldRun(options, 'customers')) {
    const res = await importCustomers(options, customers, errors);
    summary.customers = withImportTotal(res, customers.length);
  }
  if (shouldRun(options, 'vendors')) {
    const res = await importVendors(options, vendors, errors);
    summary.vendors = withImportTotal(res, vendors.length);
  }
  if (shouldRun(options, 'projects')) {
    const res = await importProjects(options, projects, planned, errors);
    summary.projects = withImportTotal(res, projects.length);
  }
  if (shouldRun(options, 'tasks')) {
    const res = await importTasks(options, tasks, planned, errors);
    summary.tasks = withImportTotal(res, tasks.length);
  }
  if (shouldRun(options, 'milestones')) {
    const res = await importMilestones(options, milestones, planned, errors);
    summary.milestones = withImportTotal(res, milestones.length);
  }
  if (shouldRun(options, 'estimates')) {
    const res = await importEstimates(options, estimates, planned, errors);
    summary.estimates = withImportTotal(res, estimates.length);
  }
  if (shouldRun(options, 'invoices')) {
    const res = await importInvoices(options, invoices, planned, errors);
    summary.invoices = withImportTotal(res, invoices.length);
  }
  if (shouldRun(options, 'purchase_orders')) {
    const res = await importPurchaseOrders(
      options,
      purchaseOrders,
      planned,
      errors,
    );
    summary.purchase_orders = withImportTotal(res, purchaseOrders.length);
  }
  if (shouldRun(options, 'vendor_quotes')) {
    const res = await importVendorQuotes(
      options,
      vendorQuotes,
      planned,
      errors,
    );
    summary.vendor_quotes = withImportTotal(res, vendorQuotes.length);
  }
  if (shouldRun(options, 'vendor_invoices')) {
    const res = await importVendorInvoices(
      options,
      vendorInvoices,
      planned,
      errors,
    );
    summary.vendor_invoices = withImportTotal(res, vendorInvoices.length);
  }
  if (shouldRun(options, 'time_entries')) {
    const res = await importTimeEntries(options, timeEntries, planned, errors);
    summary.time_entries = withImportTotal(res, timeEntries.length);
  }
  if (shouldRun(options, 'expenses')) {
    const res = await importExpenses(options, expenses, planned, errors);
    summary.expenses = withImportTotal(res, expenses.length);
  }

  logger.log('[migration-po] summary:', formatPoMigrationSummary(summary));

  if (hasPoMigrationBlockingIssues(errors)) {
    logger.error('[migration-po] errors:', formatPoMigrationIssues(errors));
    return { exitCode: 1, summary, errors };
  }

  if (options.apply) {
    const verifyErrors: ImportError[] = [];
    const defaultVerifyChunkSize = 1000;
    const parsedVerifyChunkSize = Number.parseInt(
      env.MIGRATION_VERIFY_CHUNK_SIZE ?? '',
      10,
    );
    const verifyChunkSize =
      Number.isFinite(parsedVerifyChunkSize) && parsedVerifyChunkSize > 0
        ? parsedVerifyChunkSize
        : defaultVerifyChunkSize;

    async function verifyIds(
      scope: string,
      ids: string[],
      countFn: (ids: string[]) => Promise<number>,
    ) {
      if (!ids.length) return;
      let total = 0;
      for (let offset = 0; offset < ids.length; offset += verifyChunkSize) {
        const chunk = ids.slice(offset, offset + verifyChunkSize);
        total += await countFn(chunk);
      }
      if (total !== ids.length) {
        verifyErrors.push({
          scope,
          message: `integrity check mismatch: expected ${ids.length}, got ${total}`,
        });
      }
    }

    function toNumber(value: unknown): number {
      if (value == null) return 0;
      if (typeof value === 'number') return value;
      return Number(String(value));
    }

    function isClose(a: number, b: number, tolerance: number): boolean {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return Math.abs(a - b) <= tolerance;
    }

    async function groupSumByProject(
      ids: string[],
      sumKey: string,
      groupByFn: (
        ids: string[],
      ) => Promise<{ projectId: string; _sum?: Record<string, unknown> }[]>,
    ): Promise<Map<string, number>> {
      const totals = new Map<string, number>();
      for (let offset = 0; offset < ids.length; offset += verifyChunkSize) {
        const chunk = ids.slice(offset, offset + verifyChunkSize);
        const rows = await groupByFn(chunk);
        for (const row of rows) {
          const value = toNumber(row._sum?.[sumKey]);
          totals.set(row.projectId, (totals.get(row.projectId) ?? 0) + value);
        }
      }
      return totals;
    }

    type ProjectInfo = { legacyId?: string; code?: string; name?: string };
    const projectInfo = new Map<string, ProjectInfo>();
    for (const item of projects) {
      projectInfo.set(makeId('project', item.legacyId), {
        legacyId: item.legacyId,
        code: item.code,
        name: item.name,
      });
    }

    function rememberProject(projectId: string, legacyId: string) {
      const info = projectInfo.get(projectId);
      if (info) {
        if (!info.legacyId) info.legacyId = legacyId;
        return;
      }
      projectInfo.set(projectId, { legacyId });
    }

    function describeProject(projectId: string): string {
      const info = projectInfo.get(projectId);
      if (!info) return projectId;
      const parts: string[] = [];
      if (info.code) parts.push(info.code);
      if (info.name) parts.push(info.name);
      if (info.legacyId && info.legacyId !== info.code)
        parts.push(`legacy:${info.legacyId}`);
      const label = parts.join(' / ');
      return label ? `${label} (${projectId})` : projectId;
    }

    function addSum(map: Map<string, number>, key: string, value: number) {
      map.set(key, (map.get(key) ?? 0) + value);
    }

    function verifyProjectSums(
      scope: string,
      expected: Map<string, number>,
      actual: Map<string, number>,
      tolerance: number,
    ) {
      const keys = new Set<string>([...expected.keys(), ...actual.keys()]);
      for (const projectId of keys) {
        const exp = expected.get(projectId) ?? 0;
        const act = actual.get(projectId) ?? 0;
        if (!isClose(exp, act, tolerance)) {
          const diff = act - exp;
          verifyErrors.push({
            scope,
            legacyId: projectInfo.get(projectId)?.legacyId,
            message: `project sum mismatch: project=${describeProject(projectId)} expected=${exp} actual=${act} diff=${diff}`,
          });
        }
      }
    }

    type PurchaseOrderDoc = { id: string; poNo: string; projectId: string };
    type PurchaseOrderLineDoc = {
      id: string;
      purchaseOrderId: string;
      expenseId: string | null;
    };
    type ExpenseDoc = { id: string; projectId: string };

    if (shouldRun(options, 'customers')) {
      await verifyIds(
        'customers',
        customers.map((item) => makeId('customer', item.legacyId)),
        async (ids) => prisma.customer.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'vendors')) {
      await verifyIds(
        'vendors',
        vendors.map((item) => makeId('vendor', item.legacyId)),
        async (ids) => prisma.vendor.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'projects')) {
      await verifyIds(
        'projects',
        projects.map((item) => makeId('project', item.legacyId)),
        async (ids) => prisma.project.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'tasks')) {
      await verifyIds(
        'tasks',
        tasks.map((item) => makeId('task', item.legacyId)),
        async (ids) => prisma.projectTask.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'milestones')) {
      await verifyIds(
        'milestones',
        milestones.map((item) => makeId('milestone', item.legacyId)),
        async (ids) =>
          prisma.projectMilestone.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'estimates')) {
      await verifyIds(
        'estimates',
        estimates.map((item) => makeId('estimate', item.legacyId)),
        async (ids) => prisma.estimate.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'invoices')) {
      await verifyIds(
        'invoices',
        invoices.map((item) => makeId('invoice', item.legacyId)),
        async (ids) => prisma.invoice.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'purchase_orders')) {
      await verifyIds(
        'purchase_orders',
        purchaseOrders.map((item) => makeId('purchase_order', item.legacyId)),
        async (ids) =>
          prisma.purchaseOrder.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'vendor_quotes')) {
      await verifyIds(
        'vendor_quotes',
        vendorQuotes.map((item) => makeId('vendor_quote', item.legacyId)),
        async (ids) => prisma.vendorQuote.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'vendor_invoices')) {
      await verifyIds(
        'vendor_invoices',
        vendorInvoices.map((item) => makeId('vendor_invoice', item.legacyId)),
        async (ids) =>
          prisma.vendorInvoice.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'time_entries')) {
      await verifyIds(
        'time_entries',
        timeEntries.map((item) => makeId('time_entry', item.legacyId)),
        async (ids) => prisma.timeEntry.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'expenses')) {
      await verifyIds(
        'expenses',
        expenses.map((item) => makeId('expense', item.legacyId)),
        async (ids) => prisma.expense.count({ where: { id: { in: ids } } }),
      );
    }

    if (shouldRun(options, 'invoices') && invoices.length) {
      const invoiceIds = invoices.map((item) =>
        makeId('invoice', item.legacyId),
      );
      const docs = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
          invoiceNo: true,
          projectId: true,
          estimateId: true,
          milestoneId: true,
          estimate: { select: { projectId: true } },
          milestone: { select: { projectId: true } },
        },
      });
      for (const doc of docs) {
        if (doc.estimateId && !doc.estimate?.projectId) {
          verifyErrors.push({
            scope: 'invoices.estimateProject',
            message: `estimate missing (${doc.invoiceNo}): estimateId=${doc.estimateId}`,
          });
        }
        if (
          doc.estimate?.projectId &&
          doc.estimate.projectId !== doc.projectId
        ) {
          verifyErrors.push({
            scope: 'invoices.estimateProject',
            message: `estimate project mismatch (${doc.invoiceNo}): invoice.project=${describeProject(doc.projectId)} estimate.project=${describeProject(doc.estimate.projectId)}`,
          });
        }

        if (doc.milestoneId && !doc.milestone?.projectId) {
          verifyErrors.push({
            scope: 'invoices.milestoneProject',
            message: `milestone missing (${doc.invoiceNo}): milestoneId=${doc.milestoneId}`,
          });
        }
        if (
          doc.milestone?.projectId &&
          doc.milestone.projectId !== doc.projectId
        ) {
          verifyErrors.push({
            scope: 'invoices.milestoneProject',
            message: `milestone project mismatch (${doc.invoiceNo}): invoice.project=${describeProject(doc.projectId)} milestone.project=${describeProject(doc.milestone.projectId)}`,
          });
        }
      }
    }

    if (shouldRun(options, 'purchase_orders') && purchaseOrders.length) {
      const poIds = purchaseOrders.map((item) =>
        makeId('purchase_order', item.legacyId),
      );
      const purchaseOrderDocs: PurchaseOrderDoc[] =
        await prisma.purchaseOrder.findMany({
          where: { id: { in: poIds } },
          select: { id: true, poNo: true, projectId: true },
        });
      const purchaseOrderById = new Map<
        string,
        { poNo: string; projectId: string }
      >(
        purchaseOrderDocs.map((doc) => [
          doc.id,
          { poNo: doc.poNo, projectId: doc.projectId },
        ]),
      );
      const lines: PurchaseOrderLineDoc[] =
        await prisma.purchaseOrderLine.findMany({
          where: { purchaseOrderId: { in: poIds }, expenseId: { not: null } },
          select: { id: true, purchaseOrderId: true, expenseId: true },
        });
      const expenseIds = Array.from(
        new Set(
          lines
            .map((line) => line.expenseId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (expenseIds.length) {
        const expenseDocs: ExpenseDoc[] = await prisma.expense.findMany({
          where: { id: { in: expenseIds } },
          select: { id: true, projectId: true },
        });
        const expenseProjectById = new Map<string, string>(
          expenseDocs.map((doc) => [doc.id, doc.projectId]),
        );
        for (const line of lines) {
          if (!line.expenseId) continue;
          const po = purchaseOrderById.get(line.purchaseOrderId);
          if (!po) continue;
          const expenseProjectId = expenseProjectById.get(line.expenseId);
          if (!expenseProjectId) {
            verifyErrors.push({
              scope: 'purchase_orders.expenseProject',
              message: `expense missing (${po.poNo}): lineId=${line.id} expenseId=${line.expenseId}`,
            });
            continue;
          }
          if (expenseProjectId !== po.projectId) {
            verifyErrors.push({
              scope: 'purchase_orders.expenseProject',
              message: `expense project mismatch (${po.poNo}): PO.project=${describeProject(po.projectId)} expense.project=${describeProject(expenseProjectId)} lineId=${line.id} expenseId=${line.expenseId}`,
            });
          }
        }
      }
    }

    if (shouldRun(options, 'invoices') && invoices.length) {
      const expected = new Map<string, number>();
      for (const item of invoices) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = invoices.map((item) => makeId('invoice', item.legacyId));
      const actual = await groupSumByProject(
        ids,
        'totalAmount',
        async (chunk) =>
          (await (prisma.invoice as any).groupBy({
            by: ['projectId'],
            where: { id: { in: chunk } },
            _sum: { totalAmount: true },
          })) as { projectId: string; _sum?: Record<string, unknown> }[],
      );
      verifyProjectSums('invoices.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'purchase_orders') && purchaseOrders.length) {
      const expected = new Map<string, number>();
      for (const item of purchaseOrders) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = purchaseOrders.map((item) =>
        makeId('purchase_order', item.legacyId),
      );
      const actual = await groupSumByProject(
        ids,
        'totalAmount',
        async (chunk) =>
          (await (prisma.purchaseOrder as any).groupBy({
            by: ['projectId'],
            where: { id: { in: chunk } },
            _sum: { totalAmount: true },
          })) as { projectId: string; _sum?: Record<string, unknown> }[],
      );
      verifyProjectSums('purchase_orders.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'vendor_quotes') && vendorQuotes.length) {
      const expected = new Map<string, number>();
      for (const item of vendorQuotes) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = vendorQuotes.map((item) =>
        makeId('vendor_quote', item.legacyId),
      );
      const actual = await groupSumByProject(
        ids,
        'totalAmount',
        async (chunk) =>
          (await (prisma.vendorQuote as any).groupBy({
            by: ['projectId'],
            where: { id: { in: chunk } },
            _sum: { totalAmount: true },
          })) as { projectId: string; _sum?: Record<string, unknown> }[],
      );
      verifyProjectSums('vendor_quotes.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'vendor_invoices') && vendorInvoices.length) {
      const expected = new Map<string, number>();
      for (const item of vendorInvoices) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = vendorInvoices.map((item) =>
        makeId('vendor_invoice', item.legacyId),
      );
      const actual = await groupSumByProject(
        ids,
        'totalAmount',
        async (chunk) =>
          (await (prisma.vendorInvoice as any).groupBy({
            by: ['projectId'],
            where: { id: { in: chunk } },
            _sum: { totalAmount: true },
          })) as { projectId: string; _sum?: Record<string, unknown> }[],
      );
      verifyProjectSums('vendor_invoices.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'expenses') && expenses.length) {
      const expected = new Map<string, number>();
      for (const item of expenses) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.amount));
      }
      const ids = expenses.map((item) => makeId('expense', item.legacyId));
      const actual = await groupSumByProject(
        ids,
        'amount',
        async (chunk) =>
          (await (prisma.expense as any).groupBy({
            by: ['projectId'],
            where: { id: { in: chunk } },
            _sum: { amount: true },
          })) as { projectId: string; _sum?: Record<string, unknown> }[],
      );
      verifyProjectSums('expenses.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'time_entries') && timeEntries.length) {
      const expected = new Map<string, number>();
      for (const item of timeEntries) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.minutes));
      }
      const ids = timeEntries.map((item) =>
        makeId('time_entry', item.legacyId),
      );
      const actual = await groupSumByProject(
        ids,
        'minutes',
        async (chunk) =>
          (await (prisma.timeEntry as any).groupBy({
            by: ['projectId'],
            where: { id: { in: chunk } },
            _sum: { minutes: true },
          })) as { projectId: string; _sum?: Record<string, unknown> }[],
      );
      verifyProjectSums('time_entries.projectSum', expected, actual, 0);
    }

    if (shouldRun(options, 'estimates')) {
      const docs = await prisma.estimate.findMany({
        where: {
          id: {
            in: estimates.map((item) => makeId('estimate', item.legacyId)),
          },
        },
        select: {
          id: true,
          estimateNo: true,
          totalAmount: true,
          lines: { select: { quantity: true, unitPrice: true } },
        },
      });
      for (const doc of docs) {
        const total = toNumber(doc.totalAmount);
        const sum = (doc.lines || []).reduce(
          (acc: number, line: any) =>
            acc + toNumber(line.quantity) * toNumber(line.unitPrice),
          0,
        );
        if (!isClose(sum, total, 0.01)) {
          verifyErrors.push({
            scope: 'estimates',
            message: `line total mismatch (${doc.estimateNo}): totalAmount=${total} lines=${sum}`,
          });
        }
      }
    }

    if (shouldRun(options, 'invoices')) {
      const docs = await prisma.invoice.findMany({
        where: {
          id: { in: invoices.map((item) => makeId('invoice', item.legacyId)) },
        },
        select: {
          id: true,
          invoiceNo: true,
          totalAmount: true,
          lines: { select: { quantity: true, unitPrice: true } },
        },
      });
      for (const doc of docs) {
        const total = toNumber(doc.totalAmount);
        const sum = (doc.lines || []).reduce(
          (acc: number, line: any) =>
            acc + toNumber(line.quantity) * toNumber(line.unitPrice),
          0,
        );
        if (!isClose(sum, total, 0.01)) {
          verifyErrors.push({
            scope: 'invoices',
            message: `line total mismatch (${doc.invoiceNo}): totalAmount=${total} lines=${sum}`,
          });
        }
      }
    }

    if (shouldRun(options, 'purchase_orders')) {
      const docs = await prisma.purchaseOrder.findMany({
        where: {
          id: {
            in: purchaseOrders.map((item) =>
              makeId('purchase_order', item.legacyId),
            ),
          },
        },
        select: {
          id: true,
          poNo: true,
          totalAmount: true,
          lines: { select: { quantity: true, unitPrice: true } },
        },
      });
      for (const doc of docs) {
        const total = toNumber(doc.totalAmount);
        const sum = (doc.lines || []).reduce(
          (acc: number, line: any) =>
            acc + toNumber(line.quantity) * toNumber(line.unitPrice),
          0,
        );
        if (!isClose(sum, total, 0.01)) {
          verifyErrors.push({
            scope: 'purchase_orders',
            message: `line total mismatch (${doc.poNo}): totalAmount=${total} lines=${sum}`,
          });
        }
      }
    }

    if (verifyErrors.length) {
      logger.error(
        '[migration-po] verify errors:',
        formatPoMigrationIssues(verifyErrors, verifyErrors.length),
      );
      return { exitCode: 1, summary, errors, verifyErrors };
    }
    logger.log('[migration-po] integrity ok');
  }

  logger.log('[migration-po] done');
  return { exitCode: 0, summary, errors };
}

export async function runPoMigrationCli(
  argv: readonly string[] = process.argv.slice(2),
  env: PoMigrationEnvironment = process.env,
  logger: PoMigrationLogger = console,
): Promise<PoMigrationRunResult> {
  const request = parsePoCliRequest(argv, env);
  if (request.kind === 'help') {
    logger.log(formatPoCliHelp());
    return { exitCode: 0 };
  }

  const errors: ImportError[] = [];
  const inputs = readPoMigrationInputs(request.options, errors);
  return runPoMigration(request.options, inputs, errors, { env, logger });
}
