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
import { generatePdfStub } from '../services/notifier.js';
import { requireRole } from '../services/rbac.js';

function parseDateParam(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

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

function formatCsvValue(value: unknown) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map(formatCsvValue).join(',')];
  for (const row of rows) {
    lines.push(row.map(formatCsvValue).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function sendCsv(reply: any, filename: string, csv: string) {
  return reply
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .type('text/csv; charset=utf-8')
    .send(csv);
}

function buildTemplateId(reportName: string, layout?: string) {
  const trimmedLayout = layout?.trim();
  const isValidLayout =
    typeof trimmedLayout === 'string' &&
    /^[a-zA-Z0-9_-]+$/.test(trimmedLayout);
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
  const { url } = await generatePdfStub(templateId, payload);
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
          ['projectId', 'totalMinutes', 'totalExpenses'],
          [[res.projectId, res.totalMinutes, res.totalExpenses]],
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
