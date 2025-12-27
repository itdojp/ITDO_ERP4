import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { nextNumber } from './numbering.js';
import { DocStatusValue } from '../types.js';

type RunResult = {
  templateId: string;
  projectId: string;
  status: 'created' | 'skipped' | 'error';
  message?: string;
  estimateId?: string;
  invoiceId?: string;
  milestoneId?: string;
};

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === 'object') {
    const maybeDecimal = value as {
      toNumber?: () => number;
      toString?: () => string;
    };
    if (typeof maybeDecimal.toNumber === 'function')
      return maybeDecimal.toNumber();
    if (typeof maybeDecimal.toString === 'function') {
      const parsed = Number(maybeDecimal.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

function startOfMonth(date: Date) {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addMonths(base: Date, months: number) {
  const result = new Date(base);
  const originalDay = result.getDate();
  const targetMonth = result.getMonth() + months;
  result.setDate(1);
  result.setMonth(targetMonth);
  const lastDayOfTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function nextRunAt(frequency: string | null | undefined, current: Date) {
  const normalized = (frequency ?? 'monthly').toLowerCase();
  const step =
    normalized === 'quarterly'
      ? 3
      : normalized === 'semiannual'
        ? 6
        : normalized === 'annual'
          ? 12
          : 1;
  return addMonths(current, step);
}

function computeDueDate(runAt: Date, rule: unknown): Date | null {
  if (!rule || typeof rule !== 'object') return null;
  const payload = rule as { type?: string; offsetDays?: number };
  if (payload.type !== 'periodEndPlusOffset') return null;
  const offsetDays =
    typeof payload.offsetDays === 'number' ? payload.offsetDays : 0;
  const base = endOfMonth(runAt);
  const result = new Date(base);
  result.setDate(result.getDate() + offsetDays);
  return result;
}

export async function runRecurringTemplates(now = new Date()) {
  const templates = await prisma.recurringProjectTemplate.findMany({
    where: {
      isActive: true,
      OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
    },
    include: { project: true },
  });
  const results: RunResult[] = [];
  for (const template of templates) {
    if (template.project && template.project.status !== 'active') {
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'skipped',
        message: 'project_inactive',
      });
      continue;
    }
    const runAt = template.nextRunAt ?? now;
    const periodStart = startOfMonth(runAt);
    const periodEnd = addMonths(periodStart, 1);
    const shouldGenerateEstimate = template.shouldGenerateEstimate ?? true;
    const shouldGenerateInvoice = template.shouldGenerateInvoice ?? true;
    const shouldGenerateMilestone = Boolean(
      template.defaultMilestoneName ||
        template.billUpon ||
        template.dueDateRule,
    );
    if (!shouldGenerateEstimate && !shouldGenerateInvoice) {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: { nextRunAt: nextRunAt(template.frequency, runAt) },
      });
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'skipped',
        message: 'no_generation_flags',
      });
      continue;
    }
    const existingInvoice = shouldGenerateInvoice
      ? await prisma.invoice.findFirst({
          where: {
            projectId: template.projectId,
            createdBy: 'recurring-job',
            deletedAt: null,
            issueDate: { gte: periodStart, lt: periodEnd },
          },
          select: { id: true },
        })
      : null;
    const existingEstimate = shouldGenerateEstimate
      ? await prisma.estimate.findFirst({
          where: {
            projectId: template.projectId,
            createdBy: 'recurring-job',
            deletedAt: null,
            createdAt: { gte: periodStart, lt: periodEnd },
          },
          select: { id: true },
        })
      : null;
    const existingMilestone = shouldGenerateMilestone
      ? await prisma.projectMilestone.findFirst({
          where: {
            projectId: template.projectId,
            createdBy: 'recurring-job',
            deletedAt: null,
            createdAt: { gte: periodStart, lt: periodEnd },
          },
          select: { id: true },
        })
      : null;
    if (existingInvoice || existingEstimate || existingMilestone) {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: { nextRunAt: nextRunAt(template.frequency, runAt) },
      });
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'skipped',
        message: 'already_generated',
      });
      continue;
    }
    const amount = toNumber(template.defaultAmount);
    if (
      amount <= 0 &&
      (shouldGenerateEstimate || shouldGenerateInvoice || shouldGenerateMilestone)
    ) {
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'error',
        message: 'default_amount_missing',
      });
      continue;
    }
    try {
      const currency =
        template.defaultCurrency || template.project?.currency || 'JPY';
      const lineDescription = template.defaultTerms || 'Recurring project';
      const milestoneDueDate = computeDueDate(runAt, template.dueDateRule);
      const milestoneName =
        template.defaultMilestoneName || 'Recurring milestone';
      const estimateNumbering = shouldGenerateEstimate
        ? await nextNumber('estimate', runAt)
        : null;
      const invoiceNumbering = shouldGenerateInvoice
        ? await nextNumber('invoice', runAt)
        : null;
      if (shouldGenerateEstimate && !estimateNumbering) {
        throw new Error('estimate_numbering_missing');
      }
      if (shouldGenerateInvoice && !invoiceNumbering) {
        throw new Error('invoice_numbering_missing');
      }
      const created = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const milestone = shouldGenerateMilestone
            ? await tx.projectMilestone.create({
                data: {
                  projectId: template.projectId,
                  name: milestoneName,
                  amount,
                  billUpon: template.billUpon || 'date',
                  dueDate: milestoneDueDate,
                  taxRate: template.defaultTaxRate ?? undefined,
                  createdBy: 'recurring-job',
                },
              })
            : null;
          const estimate = shouldGenerateEstimate
            ? await tx.estimate.create({
                data: {
                  projectId: template.projectId,
                  version: estimateNumbering.serial,
                  totalAmount: amount,
                  currency,
                  status: DocStatusValue.draft,
                  notes: template.defaultTerms || undefined,
                  numberingSerial: estimateNumbering.serial,
                  createdBy: 'recurring-job',
                  lines: {
                    create: [
                      {
                        description: lineDescription,
                        quantity: 1,
                        unitPrice: amount,
                        taxRate: template.defaultTaxRate ?? undefined,
                      },
                    ],
                  },
                },
              })
            : null;
          const invoice = shouldGenerateInvoice
            ? await tx.invoice.create({
                data: {
                  projectId: template.projectId,
                  estimateId: estimate?.id ?? null,
                  milestoneId: milestone?.id ?? null,
                  invoiceNo: invoiceNumbering.number,
                  issueDate: runAt,
                  dueDate: milestoneDueDate,
                  currency,
                  totalAmount: amount,
                  status: DocStatusValue.draft,
                  numberingSerial: invoiceNumbering.serial,
                  createdBy: 'recurring-job',
                  lines: {
                    create: [
                      {
                        description: lineDescription,
                        quantity: 1,
                        unitPrice: amount,
                        taxRate: template.defaultTaxRate ?? undefined,
                      },
                    ],
                  },
                },
              })
            : null;
          await tx.recurringProjectTemplate.update({
            where: { id: template.id },
            data: { nextRunAt: nextRunAt(template.frequency, runAt) },
          });
          return {
            estimateId: estimate?.id,
            invoiceId: invoice?.id,
            milestoneId: milestone?.id,
          };
        },
      );
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'created',
        estimateId: created.estimateId ?? undefined,
        invoiceId: created.invoiceId ?? undefined,
        milestoneId: created.milestoneId ?? undefined,
      });
    } catch (err: any) {
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'error',
        message: err?.message || 'failed',
      });
    }
  }
  return { processed: templates.length, results };
}
