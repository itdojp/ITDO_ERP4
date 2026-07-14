import { prisma } from '../services/db.js';
import { nextNumber } from '../services/numbering.js';

import { makePoMigrationId as makeId } from './legacyIds.js';
import {
  ensureNoDuplicates,
  normalizeString,
  parseNumber,
  type ImportError,
} from './poInput.js';
import {
  getPoEstimateLines,
  getPoInvoiceLines,
  getPoPurchaseOrderLines,
  mapPoEstimateHeader,
  mapPoExpense,
  mapPoInvoiceHeader,
  mapPoLineUnitPrice,
  mapPoPurchaseOrderHeader,
  mapPoTimeEntry,
  mapPoVendorInvoiceHeader,
  mapPoVendorQuoteHeader,
  type EstimateInput,
  type ExpenseInput,
  type InvoiceInput,
  type PlannedIds,
  type PurchaseOrderInput,
  type TimeEntryInput,
  type VendorInvoiceInput,
  type VendorQuoteInput,
} from './poDomain.js';
import type { PoMigrationCliOptions } from './poCli.js';
import {
  existsCache,
  existsOrPlanned,
  isPrismaUniqueConstraintError,
} from './poImporterState.js';

async function resolveTaskId(
  options: PoMigrationCliOptions,
  planned: PlannedIds,
  projectId: string,
  taskLegacyId: string,
  scope: string,
  legacyId: string,
  errors: ImportError[],
): Promise<string | null> {
  const taskId = makeId('task', taskLegacyId);
  const taskOk = await existsOrPlanned(
    taskId,
    planned.tasks,
    existsCache.task,
    async () =>
      !!(await prisma.projectTask.findUnique({
        where: { id: taskId },
        select: { id: true },
      })),
  );
  if (!taskOk) {
    errors.push({
      scope,
      legacyId,
      message: `task not found: ${taskLegacyId}`,
    });
    return null;
  }
  if (!options.apply) return taskId;
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: { projectId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) {
    errors.push({
      scope,
      legacyId,
      message: `task not found: ${taskLegacyId}`,
    });
    return null;
  }
  if (task.projectId !== projectId) {
    errors.push({
      scope,
      legacyId,
      message: `task belongs to another project: ${taskLegacyId}`,
    });
    return null;
  }
  return taskId;
}

type NumberingKind =
  'estimate' | 'invoice' | 'purchase_order' | 'vendor_quote' | 'vendor_invoice';

async function resolveDocumentNumber(
  kind: NumberingKind,
  numberingDate: Date,
  preferredNo: string | null,
  existingNo: string | null | undefined,
  existingSerial?: number | null | undefined,
): Promise<{ number: string; serial: number | null }> {
  if (existingNo) {
    return { number: existingNo, serial: existingSerial ?? null };
  }
  if (preferredNo) {
    return { number: preferredNo, serial: existingSerial ?? null };
  }
  const allocation = await nextNumber(kind, numberingDate);
  return { number: allocation.number, serial: allocation.serial };
}

export async function importEstimates(
  options: PoMigrationCliOptions,
  items: EstimateInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('estimates'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({
      legacyId: item.legacyId,
      code: normalizeString(item.estimateNo),
    })),
    'estimates',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
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
        scope: 'estimates',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }

    const mapped = mapPoEstimateHeader(item, projectId, new Date(), errors);
    if (!mapped) continue;
    const {
      id,
      totalAmount,
      version,
      validUntil,
      numberingDate,
      preferredNo,
      currency,
      status,
      notes,
    } = mapped;

    const exists = await prisma.estimate.findUnique({
      where: { id },
      select: { id: true, estimateNo: true, numberingSerial: true },
    });
    existsCache.estimate.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const lines = getPoEstimateLines(item, totalAmount);

    const lineData: Array<{
      estimateId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number | null;
      taskId: string | null;
    }> = [];
    for (const line of lines) {
      const quantity = parseNumber(line.quantity) ?? 1;
      const unitPrice = mapPoLineUnitPrice(
        'estimates',
        item.legacyId,
        line.unitPrice,
        errors,
      );
      if (unitPrice == null) continue;
      const taskLegacyId = normalizeString(line.taskLegacyId);
      const taskId = taskLegacyId
        ? await resolveTaskId(
            options,
            planned,
            projectId,
            taskLegacyId,
            'estimates',
            item.legacyId,
            errors,
          )
        : null;
      if (taskLegacyId && !taskId) continue;
      lineData.push({
        estimateId: id,
        description: line.description,
        quantity,
        unitPrice,
        taxRate: parseNumber(line.taxRate),
        taskId,
      });
    }
    if (errors.length) break;

    const resolved = await resolveDocumentNumber(
      'estimate',
      numberingDate,
      preferredNo,
      exists?.estimateNo,
      exists?.numberingSerial,
    );
    const estimateNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      estimateNo,
      version,
      totalAmount,
      currency,
      status,
      validUntil,
      notes,
      numberingSerial: numberingSerial ?? undefined,
      pdfUrl: undefined,
      emailMessageId: undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      await prisma.$transaction(async (tx: any) => {
        if (exists) {
          await tx.estimate.update({
            where: { id },
            data: {
              projectId,
              version,
              totalAmount,
              currency,
              status: data.status,
              validUntil,
              notes: data.notes,
              deletedAt: null,
              deletedReason: null,
            },
          });
        } else {
          await tx.estimate.create({ data });
        }
        await tx.estimateLine.deleteMany({ where: { estimateId: id } });
        if (lineData.length) {
          await tx.estimateLine.createMany({ data: lineData });
        }
      });
      if (exists) updated += 1;
      else created += 1;
      existsCache.estimate.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'estimates',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importInvoices(
  options: PoMigrationCliOptions,
  items: InvoiceInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('invoices'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({
      legacyId: item.legacyId,
      code: normalizeString(item.invoiceNo),
    })),
    'invoices',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
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
        scope: 'invoices',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }

    const mapped = mapPoInvoiceHeader(item, projectId, new Date(), errors);
    if (!mapped) continue;
    const {
      id,
      totalAmount,
      issueDate,
      dueDate,
      numberingDate,
      preferredNo,
      currency,
      estimateId,
      milestoneId,
      status,
    } = mapped;

    if (estimateId) {
      const ok = await existsOrPlanned(
        estimateId,
        planned.estimates,
        existsCache.estimate,
        async () =>
          !!(await prisma.estimate.findUnique({
            where: { id: estimateId },
            select: { id: true },
          })),
      );
      if (!ok) {
        errors.push({
          scope: 'invoices',
          legacyId: item.legacyId,
          message: `estimate not found: ${item.estimateLegacyId}`,
        });
        continue;
      }
    }

    if (milestoneId) {
      const ok = await existsOrPlanned(
        milestoneId,
        planned.milestones,
        existsCache.milestone,
        async () =>
          !!(await prisma.projectMilestone.findUnique({
            where: { id: milestoneId },
            select: { id: true },
          })),
      );
      if (!ok) {
        errors.push({
          scope: 'invoices',
          legacyId: item.legacyId,
          message: `milestone not found: ${item.milestoneLegacyId}`,
        });
        continue;
      }
    }

    const exists = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoiceNo: true, numberingSerial: true },
    });
    existsCache.invoice.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const lines = getPoInvoiceLines(item, totalAmount);

    const lineData: Array<{
      invoiceId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number | null;
      taskId: string | null;
      timeEntryRange: string | null;
    }> = [];
    for (const line of lines) {
      const quantity = parseNumber(line.quantity) ?? 1;
      const unitPrice = mapPoLineUnitPrice(
        'invoices',
        item.legacyId,
        line.unitPrice,
        errors,
      );
      if (unitPrice == null) continue;
      const taskLegacyId = normalizeString(line.taskLegacyId);
      const taskId = taskLegacyId
        ? await resolveTaskId(
            options,
            planned,
            projectId,
            taskLegacyId,
            'invoices',
            item.legacyId,
            errors,
          )
        : null;
      if (taskLegacyId && !taskId) continue;
      lineData.push({
        invoiceId: id,
        description: line.description,
        quantity,
        unitPrice,
        taxRate: parseNumber(line.taxRate),
        taskId,
        timeEntryRange: normalizeString(line.timeEntryRange),
      });
    }
    if (errors.length) break;

    const resolved = await resolveDocumentNumber(
      'invoice',
      numberingDate,
      preferredNo,
      exists?.invoiceNo,
      exists?.numberingSerial,
    );
    const invoiceNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      estimateId,
      milestoneId,
      invoiceNo,
      issueDate,
      dueDate,
      currency,
      totalAmount,
      status,
      pdfUrl: undefined,
      emailMessageId: undefined,
      numberingSerial: numberingSerial ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      await prisma.$transaction(async (tx: any) => {
        if (exists) {
          await tx.invoice.update({
            where: { id },
            data: {
              projectId,
              estimateId,
              milestoneId,
              issueDate,
              dueDate,
              currency,
              totalAmount,
              status: data.status,
              deletedAt: null,
              deletedReason: null,
            },
          });
        } else {
          await tx.invoice.create({ data });
        }
        await tx.billingLine.deleteMany({ where: { invoiceId: id } });
        if (lineData.length) {
          await tx.billingLine.createMany({ data: lineData });
        }
      });
      if (exists) updated += 1;
      else created += 1;
      existsCache.invoice.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'invoices',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importPurchaseOrders(
  options: PoMigrationCliOptions,
  items: PurchaseOrderInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('purchase_orders'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({
      legacyId: item.legacyId,
      code: normalizeString(item.poNo),
    })),
    'purchase_orders',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
    const vendorId = makeId('vendor', item.vendorLegacyId);
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
        scope: 'purchase_orders',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const vendorOk = await existsOrPlanned(
      vendorId,
      planned.vendors,
      existsCache.vendor,
      async () =>
        !!(await prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { id: true },
        })),
    );
    if (!vendorOk) {
      errors.push({
        scope: 'purchase_orders',
        legacyId: item.legacyId,
        message: `vendor not found: ${item.vendorLegacyId}`,
      });
      continue;
    }

    const mapped = mapPoPurchaseOrderHeader(
      item,
      projectId,
      vendorId,
      new Date(),
      errors,
    );
    if (!mapped) continue;
    const {
      id,
      totalAmount,
      issueDate,
      dueDate,
      numberingDate,
      preferredNo,
      currency,
      status,
    } = mapped;

    const exists = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, poNo: true, numberingSerial: true },
    });
    existsCache.purchaseOrder.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const lines = getPoPurchaseOrderLines(item, totalAmount);

    const lineData: Array<{
      purchaseOrderId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number | null;
      taskId: string | null;
      expenseId: string | null;
    }> = [];
    for (const line of lines) {
      const quantity = parseNumber(line.quantity) ?? 1;
      const unitPrice = mapPoLineUnitPrice(
        'purchase_orders',
        item.legacyId,
        line.unitPrice,
        errors,
      );
      if (unitPrice == null) continue;
      const taskLegacyId = normalizeString(line.taskLegacyId);
      const taskId = taskLegacyId
        ? await resolveTaskId(
            options,
            planned,
            projectId,
            taskLegacyId,
            'purchase_orders',
            item.legacyId,
            errors,
          )
        : null;
      if (taskLegacyId && !taskId) continue;

      const expenseLegacyId = normalizeString(line.expenseLegacyId);
      const expenseId = expenseLegacyId
        ? makeId('expense', expenseLegacyId)
        : null;
      if (expenseId) {
        const ok = await existsOrPlanned(
          expenseId,
          planned.expenses,
          existsCache.expense,
          async () =>
            !!(await prisma.expense.findUnique({
              where: { id: expenseId },
              select: { id: true },
            })),
        );
        if (!ok) {
          errors.push({
            scope: 'purchase_orders',
            legacyId: item.legacyId,
            message: `expense not found: ${expenseLegacyId}`,
          });
          continue;
        }
      }

      lineData.push({
        purchaseOrderId: id,
        description: line.description,
        quantity,
        unitPrice,
        taxRate: parseNumber(line.taxRate),
        taskId,
        expenseId,
      });
    }
    if (errors.length) break;

    const resolved = await resolveDocumentNumber(
      'purchase_order',
      numberingDate,
      preferredNo,
      exists?.poNo,
      exists?.numberingSerial,
    );
    const poNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      vendorId,
      poNo,
      issueDate,
      dueDate,
      currency,
      totalAmount,
      status,
      pdfUrl: undefined,
      numberingSerial: numberingSerial ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      await prisma.$transaction(async (tx: any) => {
        if (exists) {
          await tx.purchaseOrder.update({
            where: { id },
            data: {
              projectId,
              vendorId,
              issueDate,
              dueDate,
              currency,
              totalAmount,
              status: data.status,
              deletedAt: null,
              deletedReason: null,
            },
          });
        } else {
          await tx.purchaseOrder.create({ data });
        }
        await tx.purchaseOrderLine.deleteMany({
          where: { purchaseOrderId: id },
        });
        if (lineData.length) {
          await tx.purchaseOrderLine.createMany({ data: lineData });
        }
      });
      if (exists) updated += 1;
      else created += 1;
      existsCache.purchaseOrder.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'purchase_orders',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importVendorQuotes(
  options: PoMigrationCliOptions,
  items: VendorQuoteInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('vendor_quotes'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({
      legacyId: item.legacyId,
      code: normalizeString(item.quoteNo),
    })),
    'vendor_quotes',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
    const vendorId = makeId('vendor', item.vendorLegacyId);
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
        scope: 'vendor_quotes',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const vendorOk = await existsOrPlanned(
      vendorId,
      planned.vendors,
      existsCache.vendor,
      async () =>
        !!(await prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { id: true },
        })),
    );
    if (!vendorOk) {
      errors.push({
        scope: 'vendor_quotes',
        legacyId: item.legacyId,
        message: `vendor not found: ${item.vendorLegacyId}`,
      });
      continue;
    }

    const mapped = mapPoVendorQuoteHeader(
      item,
      projectId,
      vendorId,
      new Date(),
      errors,
    );
    if (!mapped) continue;
    const {
      id,
      totalAmount,
      issueDate,
      numberingDate,
      preferredNo,
      currency,
      status,
      documentUrl,
    } = mapped;

    const exists = await prisma.vendorQuote.findUnique({
      where: { id },
      select: { id: true, quoteNo: true },
    });
    existsCache.vendorQuote.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const quoteNo = (
      await resolveDocumentNumber(
        'vendor_quote',
        numberingDate,
        preferredNo,
        exists?.quoteNo,
      )
    ).number;

    const data = {
      id,
      projectId,
      vendorId,
      quoteNo,
      issueDate,
      currency,
      totalAmount,
      status,
      documentUrl,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      if (exists) {
        await prisma.vendorQuote.update({
          where: { id },
          data: {
            projectId,
            vendorId,
            quoteNo,
            issueDate,
            currency,
            totalAmount,
            status: data.status,
            documentUrl: data.documentUrl,
            deletedAt: null,
            deletedReason: null,
          },
        });
        updated += 1;
      } else {
        await prisma.vendorQuote.create({ data });
        created += 1;
      }
      existsCache.vendorQuote.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'vendor_quotes',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importVendorInvoices(
  options: PoMigrationCliOptions,
  items: VendorInvoiceInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('vendor_invoices'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({
      legacyId: item.legacyId,
      code: normalizeString(item.vendorInvoiceNo),
    })),
    'vendor_invoices',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
    const vendorId = makeId('vendor', item.vendorLegacyId);
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
        scope: 'vendor_invoices',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const vendorOk = await existsOrPlanned(
      vendorId,
      planned.vendors,
      existsCache.vendor,
      async () =>
        !!(await prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { id: true },
        })),
    );
    if (!vendorOk) {
      errors.push({
        scope: 'vendor_invoices',
        legacyId: item.legacyId,
        message: `vendor not found: ${item.vendorLegacyId}`,
      });
      continue;
    }

    const mapped = mapPoVendorInvoiceHeader(
      item,
      projectId,
      vendorId,
      new Date(),
      errors,
    );
    if (!mapped) continue;
    const {
      id,
      totalAmount,
      receivedDate,
      dueDate,
      numberingDate,
      preferredNo,
      currency,
      status,
      documentUrl,
    } = mapped;

    const exists = await prisma.vendorInvoice.findUnique({
      where: { id },
      select: { id: true, vendorInvoiceNo: true, numberingSerial: true },
    });
    existsCache.vendorInvoice.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const resolved = await resolveDocumentNumber(
      'vendor_invoice',
      numberingDate,
      preferredNo,
      exists?.vendorInvoiceNo,
      exists?.numberingSerial,
    );
    const vendorInvoiceNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      vendorId,
      vendorInvoiceNo,
      receivedDate,
      dueDate,
      currency,
      totalAmount,
      status,
      documentUrl,
      numberingSerial: numberingSerial ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      if (exists) {
        await prisma.vendorInvoice.update({
          where: { id },
          data: {
            projectId,
            vendorId,
            vendorInvoiceNo,
            receivedDate,
            dueDate,
            currency,
            totalAmount,
            status: data.status,
            documentUrl: data.documentUrl,
            numberingSerial: numberingSerial ?? undefined,
            deletedAt: null,
            deletedReason: null,
          },
        });
        updated += 1;
      } else {
        await prisma.vendorInvoice.create({ data });
        created += 1;
      }
      existsCache.vendorInvoice.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'vendor_invoices',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importTimeEntries(
  options: PoMigrationCliOptions,
  items: TimeEntryInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('time_entries'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId })),
    'time_entries',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
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
        scope: 'time_entries',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }

    const taskLegacyId = normalizeString(item.taskLegacyId);
    const taskId = taskLegacyId
      ? await resolveTaskId(
          options,
          planned,
          projectId,
          taskLegacyId,
          'time_entries',
          item.legacyId,
          errors,
        )
      : null;
    if (taskLegacyId && !taskId) continue;
    const mapped = mapPoTimeEntry(item, projectId, taskId, errors);
    if (!mapped) continue;
    const { id, data } = mapped;
    const exists = await prisma.timeEntry.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.timeEntry.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.timeEntry.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.timeEntry.create({ data });
        created += 1;
      }
      existsCache.timeEntry.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'time_entries',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

export async function importExpenses(
  options: PoMigrationCliOptions,
  items: ExpenseInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('expenses'))
    return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId })),
    'expenses',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const projectId = makeId('project', item.projectLegacyId);
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
        scope: 'expenses',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const mapped = mapPoExpense(item, projectId, errors);
    if (!mapped) continue;
    const { id, data } = mapped;
    const exists = await prisma.expense.findUnique({
      where: { id },
      select: { id: true },
    });
    existsCache.expense.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.expense.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.expense.create({ data });
        created += 1;
      }
      existsCache.expense.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'expenses',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}
