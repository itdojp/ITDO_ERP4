import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { nextNumber } from './numbering.js';
import { DocStatusValue } from '../types.js';
import { toNumber } from './utils.js';
import { computeDueDate, parseDueDateRule } from './dueDateRule.js';

type RunResult = {
  templateId: string;
  projectId: string;
  status: 'created' | 'skipped' | 'error';
  message?: string;
  estimateId?: string;
  invoiceId?: string;
  milestoneId?: string;
};

function startOfMonth(date: Date) {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function periodKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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
    const runAt = template.nextRunAt ?? now;
    const periodKeyValue = periodKey(runAt);
    if (template.project && template.project.status !== 'active') {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: { nextRunAt: nextRunAt(template.frequency, runAt) },
      });
      const result: RunResult = {
        templateId: template.id,
        projectId: template.projectId,
        status: 'skipped',
        message: 'project_inactive',
      };
      results.push(result);
      await recordGenerationLog({
        templateId: template.id,
        projectId: template.projectId,
        periodKey: periodKeyValue,
        runAt,
        result,
      });
      continue;
    }
    const periodStart = startOfMonth(runAt);
    const periodEnd = addMonths(periodStart, 1);
    const shouldGenerateEstimate = template.shouldGenerateEstimate ?? false;
    const shouldGenerateInvoice = template.shouldGenerateInvoice ?? true;
    const shouldGenerateMilestone = Boolean(
      template.defaultMilestoneName ||
        template.billUpon ||
        template.dueDateRule,
    );
    if (
      !shouldGenerateEstimate &&
      !shouldGenerateInvoice &&
      !shouldGenerateMilestone
    ) {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: { nextRunAt: nextRunAt(template.frequency, runAt) },
      });
      const result: RunResult = {
        templateId: template.id,
        projectId: template.projectId,
        status: 'skipped',
        message: 'no_generation_flags',
      };
      results.push(result);
      await recordGenerationLog({
        templateId: template.id,
        projectId: template.projectId,
        periodKey: periodKeyValue,
        runAt,
        result,
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
      const result: RunResult = {
        templateId: template.id,
        projectId: template.projectId,
        status: 'skipped',
        message: 'already_generated',
      };
      results.push(result);
      await recordGenerationLog({
        templateId: template.id,
        projectId: template.projectId,
        periodKey: periodKeyValue,
        runAt,
        result,
      });
      continue;
    }
    const amount = toNumber(template.defaultAmount);
    if (amount <= 0) {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: { nextRunAt: nextRunAt(template.frequency, runAt) },
      });
      const result: RunResult = {
        templateId: template.id,
        projectId: template.projectId,
        status: 'error',
        message: 'default_amount_missing',
      };
      results.push(result);
      await recordGenerationLog({
        templateId: template.id,
        projectId: template.projectId,
        periodKey: periodKeyValue,
        runAt,
        result,
      });
      continue;
    }
    try {
      const currency =
        template.defaultCurrency || template.project?.currency || 'JPY';
      const lineDescription = template.defaultTerms || 'Recurring project';
      const dueDateRule = parseDueDateRule(template.dueDateRule);
      const milestoneDueDate = computeDueDate(runAt, dueDateRule);
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
                  estimateNo: estimateNumbering!.number,
                  version: estimateNumbering!.serial,
                  totalAmount: amount,
                  currency,
                  status: DocStatusValue.draft,
                  notes: template.defaultTerms || undefined,
                  numberingSerial: estimateNumbering!.serial,
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
                  invoiceNo: invoiceNumbering!.number,
                  issueDate: runAt,
                  dueDate: milestoneDueDate,
                  currency,
                  totalAmount: amount,
                  status: DocStatusValue.draft,
                  numberingSerial: invoiceNumbering!.serial,
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
      const result: RunResult = {
        templateId: template.id,
        projectId: template.projectId,
        status: 'created',
        estimateId: created.estimateId ?? undefined,
        invoiceId: created.invoiceId ?? undefined,
        milestoneId: created.milestoneId ?? undefined,
      };
      results.push(result);
      await recordGenerationLog({
        templateId: template.id,
        projectId: template.projectId,
        periodKey: periodKeyValue,
        runAt,
        result,
      });
    } catch (err: any) {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: {
          nextRunAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });
      const result: RunResult = {
        templateId: template.id,
        projectId: template.projectId,
        status: 'error',
        message: err?.message || 'failed',
      };
      results.push(result);
      await recordGenerationLog({
        templateId: template.id,
        projectId: template.projectId,
        periodKey: periodKeyValue,
        runAt,
        result,
      });
    }
  }
  return { processed: templates.length, results };
}

async function recordGenerationLog(params: {
  templateId: string;
  projectId: string;
  periodKey: string;
  runAt: Date;
  result: RunResult;
}) {
  const data = {
    templateId: params.templateId,
    projectId: params.projectId,
    periodKey: params.periodKey,
    runAt: params.runAt,
    status: params.result.status,
    message: params.result.message ?? null,
    estimateId: params.result.estimateId ?? null,
    invoiceId: params.result.invoiceId ?? null,
    milestoneId: params.result.milestoneId ?? null,
    createdBy: 'recurring-job',
  };
  const existing = await prisma.recurringGenerationLog.findUnique({
    where: {
      templateId_periodKey: {
        templateId: params.templateId,
        periodKey: params.periodKey,
      },
    },
    select: { status: true },
  });
  if (!existing) {
    await prisma.recurringGenerationLog.create({ data });
    return;
  }
  if (existing.status === 'created' && params.result.status !== 'created') {
    return;
  }
  await prisma.recurringGenerationLog.update({
    where: {
      templateId_periodKey: {
        templateId: params.templateId,
        periodKey: params.periodKey,
      },
    },
    data,
  });
}
