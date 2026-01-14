import { FastifyInstance } from 'fastify';
import {
  reportDeliveryDue,
  reportGroupEffort,
  reportOvertime,
  reportProjectProfitByGroup,
  reportProjectProfitByUser,
  reportProjectProfit,
  reportProjectEffort,
} from '../services/reports.js';
import { prisma } from '../services/db.js';
import { calcTimeAmount, resolveRateCard } from '../services/rateCard.js';
import { dateKey, toNumber } from '../services/utils.js';
import { generatePdf } from '../services/pdf.js';
import { requireRole } from '../services/rbac.js';
import { parseDateParam } from '../utils/date.js';
import { sendCsv, toCsv } from '../utils/csv.js';

function validateFormat(format: string | undefined, reply: any) {
  if (!format) return true;
  if (!['csv', 'pdf'].includes(format)) {
    reply.status(400).send({
      error: { code: 'INVALID_FORMAT', message: 'format must be csv or pdf' },
    });
    return false;
  }
  return true;
}

function buildTemplateId(reportName: string, layout?: string) {
  const trimmedLayout = layout?.trim();
  const isValidLayout =
    typeof trimmedLayout === 'string' && /^[a-zA-Z0-9_-]+$/.test(trimmedLayout);
  const suffix = isValidLayout ? trimmedLayout : 'default';
  return `report:${reportName}:${suffix}`;
}

async function sendPdf(
  reply: any,
  reportName: string,
  layout: string | undefined,
  payload: Record<string, unknown>,
) {
  const templateId = buildTemplateId(reportName, layout);
  const { url } = await generatePdf(templateId, payload, reportName);
  return reply.send({ format: 'pdf', templateId, url });
}
export async function registerReportRoutes(app: FastifyInstance) {
  app.get(
    '/reports/project-effort/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, format, layout } = req.query as {
        from?: string;
        to?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportProjectEffort(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      if (format === 'csv') {
        const csv = toCsv(
          [
            'projectId',
            'planHours',
            'planMinutes',
            'totalMinutes',
            'varianceMinutes',
            'totalExpenses',
          ],
          [
            [
              res.projectId,
              res.planHours,
              res.planMinutes,
              res.totalMinutes,
              res.varianceMinutes,
              res.totalExpenses,
            ],
          ],
        );
        return sendCsv(reply, `project-${projectId}-effort.csv`, csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'project-effort', layout, res);
      }
      return res;
    },
  );

  app.get(
    '/reports/project-evm/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to } = req.query as { from?: string; to?: string };
      const fromRaw = parseDateParam(from);
      const toRaw = parseDateParam(to);
      if (!fromRaw || !toRaw) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'from/to are required',
          },
        });
      }
      const fromDate = new Date(fromRaw);
      fromDate.setUTCHours(0, 0, 0, 0);
      const toDate = new Date(toRaw);
      toDate.setUTCHours(23, 59, 59, 999);
      if (fromDate.getTime() > toDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'from must be before or equal to to',
          },
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          deletedAt: true,
          startDate: true,
          endDate: true,
          planHours: true,
          budgetCost: true,
          currency: true,
        },
      });
      if (!project) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      if (project.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Project deleted' },
        });
      }
      if (!project.startDate || !project.endDate) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_PROJECT_PERIOD',
            message: 'Project startDate/endDate are required',
          },
        });
      }
      const projectStart = new Date(project.startDate);
      projectStart.setUTCHours(0, 0, 0, 0);
      const projectEnd = new Date(project.endDate);
      projectEnd.setUTCHours(0, 0, 0, 0);
      if (projectStart.getTime() > projectEnd.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PROJECT_PERIOD',
            message: 'Project startDate must be before or equal to endDate',
          },
        });
      }
      if (fromDate.getTime() < projectStart.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'OUT_OF_PROJECT_PERIOD',
            message: 'from must be on or after project startDate',
          },
        });
      }
      if (toDate.getTime() > projectEnd.getTime() + 24 * 60 * 60 * 1000 - 1) {
        return reply.status(400).send({
          error: {
            code: 'OUT_OF_PROJECT_PERIOD',
            message: 'to must be on or before project endDate',
          },
        });
      }

      const MAX_EVM_RANGE_DAYS = 365;
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const rangeDays =
        Math.floor(
          (new Date(
            Date.UTC(
              toDate.getUTCFullYear(),
              toDate.getUTCMonth(),
              toDate.getUTCDate(),
            ),
          ).getTime() -
            new Date(
              Date.UTC(
                projectStart.getUTCFullYear(),
                projectStart.getUTCMonth(),
                projectStart.getUTCDate(),
              ),
            ).getTime()) /
            MS_PER_DAY,
        ) + 1;
      if (rangeDays > MAX_EVM_RANGE_DAYS) {
        return reply.status(400).send({
          error: {
            code: 'DATE_RANGE_TOO_LARGE',
            message: `Project EVM range cannot exceed ${MAX_EVM_RANGE_DAYS} days`,
          },
        });
      }

      const planHoursRaw = project.planHours;
      const planHours = planHoursRaw == null ? null : toNumber(planHoursRaw);
      const planMinutes =
        planHours != null && planHours > 0 ? Math.round(planHours * 60) : null;
      if (!planMinutes) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_PLAN_HOURS',
            message: 'planHours is required',
          },
        });
      }
      const budgetCostRaw = project.budgetCost;
      const budgetCost = budgetCostRaw == null ? null : toNumber(budgetCostRaw);
      if (!budgetCost || budgetCost <= 0) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_BUDGET_COST',
            message: 'budgetCost is required',
          },
        });
      }

      const projectDurationDays =
        Math.floor(
          (projectEnd.getTime() - projectStart.getTime()) / MS_PER_DAY,
        ) + 1;

      const timeEntries = await prisma.timeEntry.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: { in: ['submitted', 'approved'] },
          workDate: { gte: projectStart, lte: toDate },
        },
        select: { minutes: true, workDate: true, workType: true },
      });
      const minutesByDay = new Map<string, number>();
      const minutesByCombo = new Map<
        string,
        { workDate: Date; workType?: string; minutes: number }
      >();
      for (const entry of timeEntries) {
        const key = dateKey(entry.workDate);
        minutesByDay.set(
          key,
          (minutesByDay.get(key) ?? 0) + (entry.minutes || 0),
        );
        const workType = entry.workType ?? undefined;
        const comboKey = `${key}|${workType ?? ''}`;
        const combo = minutesByCombo.get(comboKey);
        if (combo) {
          combo.minutes += entry.minutes || 0;
        } else {
          minutesByCombo.set(comboKey, {
            workDate: entry.workDate,
            workType,
            minutes: entry.minutes || 0,
          });
        }
      }
      const rateCardCache = new Map<
        string,
        Awaited<ReturnType<typeof resolveRateCard>>
      >();
      await Promise.all(
        Array.from(minutesByCombo.entries()).map(async ([comboKey, combo]) => {
          const rateCard = await resolveRateCard({
            projectId,
            workDate: combo.workDate,
            workType: combo.workType,
          });
          rateCardCache.set(comboKey, rateCard);
        }),
      );
      const laborCostByDay = new Map<string, number>();
      for (const [comboKey, combo] of minutesByCombo.entries()) {
        const [dayKey] = comboKey.split('|');
        const rateCard = rateCardCache.get(comboKey);
        if (!rateCard) continue;
        const unitPrice = toNumber(rateCard.unitPrice);
        if (!unitPrice) continue;
        const cost = calcTimeAmount(combo.minutes, unitPrice);
        laborCostByDay.set(dayKey, (laborCostByDay.get(dayKey) ?? 0) + cost);
      }

      const expenses = await prisma.expense.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: 'approved',
          incurredOn: { gte: projectStart, lte: toDate },
        },
        select: { amount: true, incurredOn: true },
      });
      const expenseCostByDay = new Map<string, number>();
      for (const expense of expenses) {
        const key = dateKey(expense.incurredOn);
        expenseCostByDay.set(
          key,
          (expenseCostByDay.get(key) ?? 0) + toNumber(expense.amount),
        );
      }

      const vendorInvoices = await prisma.vendorInvoice.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: { in: ['received', 'approved', 'paid'] },
          receivedDate: { gte: projectStart, lte: toDate },
        },
        select: { totalAmount: true, receivedDate: true },
      });
      const vendorCostByDay = new Map<string, number>();
      for (const invoice of vendorInvoices) {
        if (!invoice.receivedDate) continue;
        const key = dateKey(invoice.receivedDate);
        vendorCostByDay.set(
          key,
          (vendorCostByDay.get(key) ?? 0) + toNumber(invoice.totalAmount),
        );
      }

      const items: Array<{
        date: string;
        pv: number;
        ev: number;
        ac: number;
        spi: number | null;
        cpi: number | null;
      }> = [];
      let cumulativeMinutes = 0;
      let cumulativeCost = 0;

      const cursor = new Date(
        Date.UTC(
          projectStart.getUTCFullYear(),
          projectStart.getUTCMonth(),
          projectStart.getUTCDate(),
        ),
      );
      const endDate = new Date(
        Date.UTC(
          toDate.getUTCFullYear(),
          toDate.getUTCMonth(),
          toDate.getUTCDate(),
        ),
      );
      const fromDay = new Date(
        Date.UTC(
          fromDate.getUTCFullYear(),
          fromDate.getUTCMonth(),
          fromDate.getUTCDate(),
        ),
      );
      while (cursor.getTime() <= endDate.getTime()) {
        const dayKey = cursor.toISOString().slice(0, 10);
        const dailyMinutes = minutesByDay.get(dayKey) ?? 0;
        cumulativeMinutes += dailyMinutes;
        const dailyCost =
          (laborCostByDay.get(dayKey) ?? 0) +
          (expenseCostByDay.get(dayKey) ?? 0) +
          (vendorCostByDay.get(dayKey) ?? 0);
        cumulativeCost += dailyCost;

        const elapsedDays =
          Math.floor((cursor.getTime() - projectStart.getTime()) / MS_PER_DAY) +
          1;
        const pv = budgetCost * (elapsedDays / projectDurationDays);
        const progress = Math.min(1, cumulativeMinutes / planMinutes);
        const ev = budgetCost * progress;
        const spi = pv > 0 ? ev / pv : null;
        const cpi = cumulativeCost > 0 ? ev / cumulativeCost : null;

        if (cursor.getTime() >= fromDay.getTime()) {
          items.push({
            date: dayKey,
            pv,
            ev,
            ac: cumulativeCost,
            spi,
            cpi,
          });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return {
        projectId,
        currency: project.currency ?? null,
        planMinutes,
        budgetCost,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        items,
      };
    },
  );

  app.get(
    '/reports/burndown/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { baselineId, from, to } = req.query as {
        baselineId?: string;
        from?: string;
        to?: string;
      };
      if (!baselineId || typeof baselineId !== 'string') {
        return reply.status(400).send({
          error: {
            code: 'MISSING_BASELINE',
            message: 'baselineId is required',
          },
        });
      }
      const fromRaw = parseDateParam(from);
      const toRaw = parseDateParam(to);
      if (!fromRaw || !toRaw) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'from/to are required' },
        });
      }
      const fromDate = new Date(fromRaw);
      fromDate.setUTCHours(0, 0, 0, 0);
      const toDate = new Date(toRaw);
      toDate.setUTCHours(23, 59, 59, 999);
      if (fromDate.getTime() > toDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'from must be before or equal to to',
          },
        });
      }

      const cursor = new Date(
        Date.UTC(
          fromDate.getUTCFullYear(),
          fromDate.getUTCMonth(),
          fromDate.getUTCDate(),
        ),
      );
      const endDate = new Date(
        Date.UTC(
          toDate.getUTCFullYear(),
          toDate.getUTCMonth(),
          toDate.getUTCDate(),
        ),
      );
      const MAX_BURNDOWN_RANGE_DAYS = 365;
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const rangeDays =
        Math.floor((endDate.getTime() - cursor.getTime()) / MS_PER_DAY) + 1;
      if (rangeDays > MAX_BURNDOWN_RANGE_DAYS) {
        return reply.status(400).send({
          error: {
            code: 'DATE_RANGE_TOO_LARGE',
            message: `Date range cannot exceed ${MAX_BURNDOWN_RANGE_DAYS} days`,
          },
        });
      }

      const baseline = await prisma.projectBaseline.findUnique({
        where: { id: baselineId },
        select: { id: true, projectId: true, deletedAt: true, planHours: true },
      });
      if (!baseline || baseline.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Baseline not found' },
        });
      }
      if (baseline.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Baseline already deleted',
          },
        });
      }
      const planHoursRaw = baseline.planHours;
      const planHours = planHoursRaw == null ? null : toNumber(planHoursRaw);
      if (planHours == null || planHours <= 0) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_PLAN_HOURS',
            message: 'Baseline planHours is required',
          },
        });
      }
      const planMinutes = Math.round(planHours * 60);

      const entries = await prisma.timeEntry.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: { in: ['submitted', 'approved'] },
          workDate: { gte: fromDate, lte: toDate },
        },
        select: { minutes: true, workDate: true },
      });
      const burnedByDay = new Map<string, number>();
      for (const entry of entries) {
        const key = dateKey(entry.workDate);
        burnedByDay.set(
          key,
          (burnedByDay.get(key) ?? 0) + (entry.minutes || 0),
        );
      }
      const items: Array<{
        date: string;
        burnedMinutes: number;
        cumulativeBurnedMinutes: number;
        remainingMinutes: number;
      }> = [];
      let cumulative = 0;
      while (cursor.getTime() <= endDate.getTime()) {
        const key = cursor.toISOString().slice(0, 10);
        const burnedMinutes = burnedByDay.get(key) ?? 0;
        cumulative += burnedMinutes;
        items.push({
          date: key,
          burnedMinutes,
          cumulativeBurnedMinutes: cumulative,
          remainingMinutes: planMinutes - cumulative,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return {
        projectId,
        baselineId,
        planMinutes,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        items,
      };
    },
  );

  app.get(
    '/reports/project-profit/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, format, layout } = req.query as {
        from?: string;
        to?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportProjectProfit(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      if (format === 'csv') {
        const csv = toCsv(
          [
            'projectId',
            'revenue',
            'budgetRevenue',
            'varianceRevenue',
            'directCost',
            'vendorCost',
            'expenseCost',
            'laborCost',
            'grossProfit',
            'grossMargin',
            'totalMinutes',
          ],
          [
            [
              res.projectId,
              res.revenue,
              res.budgetRevenue,
              res.varianceRevenue,
              res.directCost,
              res.costBreakdown.vendorCost,
              res.costBreakdown.expenseCost,
              res.costBreakdown.laborCost,
              res.grossProfit,
              res.grossMargin,
              res.totalMinutes,
            ],
          ],
        );
        return sendCsv(reply, `project-${projectId}-profit.csv`, csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'project-profit', layout, res);
      }
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId/by-user',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, userIds, format, layout } = req.query as {
        from?: string;
        to?: string;
        userIds?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await reportProjectProfitByUser(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
        ids.length ? ids : undefined,
      );
      if (format === 'csv') {
        const headers = [
          'projectId',
          'allocationMethod',
          'revenue',
          'vendorCost',
          'laborCost',
          'expenseCost',
          'totalMinutes',
          'userId',
          'userLaborCost',
          'userExpenseCost',
          'allocatedVendorCost',
          'allocatedRevenue',
          'totalCost',
          'grossProfit',
          'grossMargin',
          'minutes',
        ];
        const rows = res.items.map((item: any) => [
          res.projectId,
          res.allocationMethod,
          res.revenue,
          res.vendorCost,
          res.laborCost,
          res.expenseCost,
          res.totalMinutes,
          item.userId,
          item.laborCost,
          item.expenseCost,
          item.allocatedVendorCost,
          item.allocatedRevenue,
          item.totalCost,
          item.grossProfit,
          item.grossMargin,
          item.minutes,
        ]);
        const csv = toCsv(headers, rows);
        return sendCsv(reply, `project-${projectId}-profit-by-user.csv`, csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'project-profit-by-user', layout, res);
      }
      return res;
    },
  );

  app.get(
    '/reports/project-profit/:projectId/by-group',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { from, to, userIds, label, format, layout } = req.query as {
        from?: string;
        to?: string;
        userIds?: string;
        label?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (!ids.length) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'userIds query parameter is required and must be a comma-separated list of user IDs',
          },
        });
      }
      const res = await reportProjectProfitByGroup(
        projectId,
        ids,
        fromDate ?? undefined,
        toDate ?? undefined,
        label,
      );
      if (format === 'csv') {
        const headers = [
          'projectId',
          'label',
          'allocationMethod',
          'revenue',
          'vendorCost',
          'laborCost',
          'expenseCost',
          'totalMinutes',
          'groupAllocatedRevenue',
          'groupAllocatedVendorCost',
          'groupLaborCost',
          'groupExpenseCost',
          'groupTotalCost',
          'groupGrossProfit',
          'groupGrossMargin',
          'groupMinutes',
          'userIds',
        ];
        const row = [
          res.projectId,
          res.label,
          res.allocationMethod,
          res.totals.revenue,
          res.totals.vendorCost,
          res.totals.laborCost,
          res.totals.expenseCost,
          res.totals.totalMinutes,
          res.group.allocatedRevenue,
          res.group.allocatedVendorCost,
          res.group.laborCost,
          res.group.expenseCost,
          res.group.totalCost,
          res.group.grossProfit,
          res.group.grossMargin,
          res.group.minutes,
          res.userIds.join('|'),
        ];
        const csv = toCsv(headers, [row]);
        return sendCsv(reply, `project-${projectId}-profit-by-group.csv`, csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'project-profit-by-group', layout, res);
      }
      return res;
    },
  );

  app.get(
    '/reports/group-effort',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { userIds, from, to, format, layout } = req.query as {
        userIds?: string;
        from?: string;
        to?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const ids = (userIds || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await reportGroupEffort(
        ids,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      if (format === 'csv') {
        const csv = toCsv(
          ['userId', 'totalMinutes'],
          res.map((item: { userId: string; totalMinutes: number }) => [
            item.userId,
            item.totalMinutes,
          ]),
        );
        return sendCsv(reply, 'group-effort-report.csv', csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'group-effort', layout, { items: res });
      }
      return { items: res };
    },
  );

  app.get(
    '/reports/overtime/:userId',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { from, to, format, layout } = req.query as {
        from?: string;
        to?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportOvertime(
        userId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      if (format === 'csv') {
        const csv = toCsv(
          ['userId', 'totalMinutes', 'dailyHours'],
          [[res.userId, res.totalMinutes, res.dailyHours]],
        );
        return sendCsv(reply, `overtime-${userId}.csv`, csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'overtime', layout, res);
      }
      return res;
    },
  );

  app.get(
    '/reports/delivery-due',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { from, to, projectId, format, layout } = req.query as {
        from?: string;
        to?: string;
        projectId?: string;
        format?: string;
        layout?: string;
      };
      if (!validateFormat(format, reply)) return;
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      const res = await reportDeliveryDue(
        fromDate ?? undefined,
        toDate ?? undefined,
        projectId,
      );
      if (format === 'csv') {
        const headers = [
          'milestoneId',
          'projectId',
          'projectCode',
          'projectName',
          'name',
          'amount',
          'dueDate',
          'invoiceCount',
          'invoiceNos',
          'invoiceStatuses',
        ];
        const rows = res.map((item: any) => [
          item.milestoneId,
          item.projectId,
          item.projectCode,
          item.projectName,
          item.name,
          item.amount,
          item.dueDate ? new Date(item.dueDate).toISOString() : '',
          item.invoiceCount,
          item.invoiceNos.join('|'),
          item.invoiceStatuses.join('|'),
        ]);
        const csv = toCsv(headers, rows);
        return sendCsv(reply, 'delivery-due-report.csv', csv);
      }
      if (format === 'pdf') {
        return sendPdf(reply, 'delivery-due', layout, { items: res });
      }
      return { items: res };
    },
  );
}
