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
};

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === 'object') {
    const maybeDecimal = value as { toNumber?: () => number; toString?: () => string };
    if (typeof maybeDecimal.toNumber === 'function') return maybeDecimal.toNumber();
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
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() < day) {
    result.setDate(0);
  }
  return result;
}

function nextRunAt(frequency: string, current: Date) {
  const normalized = frequency?.toLowerCase();
  const step =
    normalized === 'quarterly' ? 3
      : normalized === 'semiannual' ? 6
        : normalized === 'annual' ? 12
          : 1;
  return addMonths(current, step);
}

export async function runRecurringTemplates(now = new Date()) {
  const templates = await prisma.recurringProjectTemplate.findMany({
    where: { isActive: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] },
    include: { project: true },
  });
  const results: RunResult[] = [];
  for (const template of templates) {
    const runAt = template.nextRunAt ?? now;
    const periodStart = startOfMonth(runAt);
    const periodEnd = addMonths(periodStart, 1);
    const existing = await prisma.invoice.findFirst({
      where: {
        projectId: template.projectId,
        createdBy: 'recurring-job',
        deletedAt: null,
        issueDate: { gte: periodStart, lt: periodEnd },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.recurringProjectTemplate.update({
        where: { id: template.id },
        data: { nextRunAt: nextRunAt(template.frequency, runAt) },
      });
      results.push({ templateId: template.id, projectId: template.projectId, status: 'skipped', message: 'already_generated' });
      continue;
    }
    const amount = toNumber(template.defaultAmount);
    if (amount <= 0) {
      results.push({ templateId: template.id, projectId: template.projectId, status: 'error', message: 'default_amount_missing' });
      continue;
    }
    try {
      const { serial: estimateSerial } = await nextNumber('estimate', runAt);
      const { number: invoiceNo, serial: invoiceSerial } = await nextNumber('invoice', runAt);
      const currency = template.project?.currency || 'JPY';
      const lineDescription = template.defaultTerms || 'Recurring project';
      const created = await prisma.$transaction(async (tx: any) => {
        const estimate = await tx.estimate.create({
          data: {
            projectId: template.projectId,
            version: estimateSerial,
            totalAmount: amount,
            currency,
            status: DocStatusValue.draft,
            notes: template.defaultTerms || undefined,
            numberingSerial: estimateSerial,
            createdBy: 'recurring-job',
            lines: {
              create: [
                {
                  description: lineDescription,
                  quantity: 1,
                  unitPrice: amount,
                },
              ],
            },
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            projectId: template.projectId,
            estimateId: estimate.id,
            milestoneId: null,
            invoiceNo,
            issueDate: runAt,
            dueDate: null,
            currency,
            totalAmount: amount,
            status: DocStatusValue.draft,
            numberingSerial: invoiceSerial,
            createdBy: 'recurring-job',
            lines: {
              create: [
                {
                  description: lineDescription,
                  quantity: 1,
                  unitPrice: amount,
                },
              ],
            },
          },
        });
        await tx.recurringProjectTemplate.update({
          where: { id: template.id },
          data: { nextRunAt: nextRunAt(template.frequency, runAt) },
        });
        return { estimateId: estimate.id, invoiceId: invoice.id, estimateNo };
      });
      results.push({
        templateId: template.id,
        projectId: template.projectId,
        status: 'created',
        estimateId: created.estimateId,
        invoiceId: created.invoiceId,
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
