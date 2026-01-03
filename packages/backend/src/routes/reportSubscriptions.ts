import { FastifyInstance } from 'fastify';
import { Prisma, type ReportSubscription } from '@prisma/client';
import { prisma } from '../services/db.js';
import {
  reportDeliveryDue,
  reportGroupEffort,
  reportOvertime,
  reportProjectEffort,
  reportProjectProfit,
  reportProjectProfitByGroup,
  reportProjectProfitByUser,
} from '../services/reports.js';
import { generatePdf } from '../services/pdf.js';
import { requireRole } from '../services/rbac.js';
import { parseDateParam } from '../utils/date.js';
import {
  reportSubscriptionPatchSchema,
  reportSubscriptionRunSchema,
  reportSubscriptionSchema,
} from './validators.js';

const reportSubscriptionRoles = ['admin', 'mgmt'];

type ReportSubscriptionBody = {
  name?: string;
  reportKey: string;
  format?: string;
  schedule?: string;
  params?: unknown;
  recipients?: Record<string, unknown>;
  channels?: string[];
  isEnabled?: boolean;
};

type RunBody = {
  dryRun?: boolean;
};

type Recipients = {
  emails?: string[];
  roles?: string[];
  users?: string[];
};

class ReportParamError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item !== '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRecipients(value: unknown): Recipients {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  return {
    emails: normalizeStringArray(raw.emails),
    roles: normalizeStringArray(raw.roles),
    users: normalizeStringArray(raw.users),
  };
}

function normalizeChannels(value: unknown) {
  const channels = normalizeStringArray(value);
  return channels.length ? channels : ['dashboard'];
}

function normalizeJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return value as Prisma.InputJsonValue;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  // JSON round-trip keeps payload JSON-safe while dropping unsupported values.
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function normalizeJsonInput(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function parseLimit(
  raw: string | undefined,
  defaultValue: number,
  maxValue: number,
) {
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function parseOffset(raw: string | undefined) {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeFormat(value: string | null): 'csv' | 'pdf' {
  if (!value || value === 'csv' || value === 'pdf') return value ?? 'csv';
  throw new ReportParamError('INVALID_FORMAT', 'format must be csv or pdf');
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

function buildTemplateId(reportName: string, layout?: string) {
  const trimmedLayout = layout?.trim();
  // Only allow a simple token so ":" cannot affect the templateId segments.
  const isValidLayout =
    typeof trimmedLayout === 'string' && /^[a-zA-Z0-9_-]+$/.test(trimmedLayout);
  const suffix = isValidLayout ? trimmedLayout : 'default';
  return `report:${reportName}:${suffix}`;
}

function parseDateInput(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ReportParamError('INVALID_DATE', `${label} must be string`);
  }
  const parsed = parseDateParam(value);
  if (!parsed) {
    throw new ReportParamError('INVALID_DATE', `${label} is invalid`);
  }
  return parsed;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReportParamError('MISSING_PARAM', `${label} is required`);
  }
  return value.trim();
}

function parseIdList(value: unknown) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (typeof value === 'string') {
    return normalizeStringArray(value.split(','));
  }
  return [];
}

function resolveTarget(channel: string, recipients: Recipients) {
  if (channel === 'email') {
    return recipients.emails?.join(',') || '-';
  }
  if (channel === 'dashboard') {
    const users = recipients.users?.join(',');
    if (users) return users;
    const roles = recipients.roles?.join(',');
    return roles || '-';
  }
  return '-';
}

async function buildReportPayload(subscription: ReportSubscription) {
  const params = isPlainObject(subscription.params) ? subscription.params : {};
  const format = normalizeFormat(subscription.format);
  const layout = typeof params.layout === 'string' ? params.layout : undefined;
  const fromDate = parseDateInput(params.from, 'from');
  const toDate = parseDateInput(params.to, 'to');
  let data: unknown;
  let csv: string | undefined;
  let pdf: { templateId: string; url: string } | undefined;

  switch (subscription.reportKey) {
    case 'project-effort': {
      const projectId = requireString(params.projectId, 'projectId');
      const result = await reportProjectEffort(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      data = result;
      if (format === 'csv') {
        csv = toCsv(
          ['projectId', 'totalMinutes', 'totalExpenses'],
          [[result.projectId, result.totalMinutes, result.totalExpenses]],
        );
      } else {
        const templateId = buildTemplateId('project-effort', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-effort',
        );
        pdf = { templateId, url };
      }
      break;
    }
    case 'project-profit': {
      const projectId = requireString(params.projectId, 'projectId');
      const result = await reportProjectProfit(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      data = result;
      if (format === 'csv') {
        csv = toCsv(
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
              result.projectId,
              result.revenue,
              result.budgetRevenue,
              result.varianceRevenue,
              result.directCost,
              result.costBreakdown.vendorCost,
              result.costBreakdown.expenseCost,
              result.costBreakdown.laborCost,
              result.grossProfit,
              result.grossMargin,
              result.totalMinutes,
            ],
          ],
        );
      } else {
        const templateId = buildTemplateId('project-profit', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-profit',
        );
        pdf = { templateId, url };
      }
      break;
    }
    case 'project-profit-by-user': {
      const projectId = requireString(params.projectId, 'projectId');
      const ids = parseIdList(params.userIds);
      const result = await reportProjectProfitByUser(
        projectId,
        fromDate ?? undefined,
        toDate ?? undefined,
        ids.length ? ids : undefined,
      );
      data = result;
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
        const rows = result.items.map((item) => [
          result.projectId,
          result.allocationMethod,
          result.revenue,
          result.vendorCost,
          result.laborCost,
          result.expenseCost,
          result.totalMinutes,
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
        csv = toCsv(headers, rows);
      } else {
        const templateId = buildTemplateId('project-profit-by-user', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-profit-by-user',
        );
        pdf = { templateId, url };
      }
      break;
    }
    case 'project-profit-by-group': {
      const projectId = requireString(params.projectId, 'projectId');
      const ids = parseIdList(params.userIds);
      if (!ids.length) {
        // Group allocation needs an explicit member set.
        throw new ReportParamError('MISSING_PARAM', 'userIds is required');
      }
      const label = typeof params.label === 'string' ? params.label : undefined;
      const result = await reportProjectProfitByGroup(
        projectId,
        ids,
        fromDate ?? undefined,
        toDate ?? undefined,
        label,
      );
      data = result;
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
          result.projectId,
          result.label,
          result.allocationMethod,
          result.totals.revenue,
          result.totals.vendorCost,
          result.totals.laborCost,
          result.totals.expenseCost,
          result.totals.totalMinutes,
          result.group.allocatedRevenue,
          result.group.allocatedVendorCost,
          result.group.laborCost,
          result.group.expenseCost,
          result.group.totalCost,
          result.group.grossProfit,
          result.group.grossMargin,
          result.group.minutes,
          result.userIds.join('|'),
        ];
        csv = toCsv(headers, [row]);
      } else {
        const templateId = buildTemplateId('project-profit-by-group', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-profit-by-group',
        );
        pdf = { templateId, url };
      }
      break;
    }
    case 'group-effort': {
      const ids = parseIdList(params.userIds);
      if (!ids.length) {
        throw new ReportParamError('MISSING_PARAM', 'userIds is required');
      }
      const result = await reportGroupEffort(
        ids,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      data = { items: result };
      if (format === 'csv') {
        csv = toCsv(
          ['userId', 'totalMinutes'],
          result.map((item) => [item.userId, item.totalMinutes]),
        );
      } else {
        const templateId = buildTemplateId('group-effort', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue({ items: result }) as Record<string, unknown>,
          'group-effort',
        );
        pdf = { templateId, url };
      }
      break;
    }
    case 'overtime': {
      const userId = requireString(params.userId, 'userId');
      const result = await reportOvertime(
        userId,
        fromDate ?? undefined,
        toDate ?? undefined,
      );
      data = result;
      if (format === 'csv') {
        csv = toCsv(
          ['userId', 'totalMinutes', 'dailyHours'],
          [[result.userId, result.totalMinutes, result.dailyHours]],
        );
      } else {
        const templateId = buildTemplateId('overtime', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'overtime',
        );
        pdf = { templateId, url };
      }
      break;
    }
    case 'delivery-due': {
      const projectId =
        typeof params.projectId === 'string' && params.projectId.trim()
          ? params.projectId.trim()
          : undefined;
      const result = await reportDeliveryDue(
        fromDate ?? undefined,
        toDate ?? undefined,
        projectId,
      );
      data = { items: result };
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
        const rows = result.map((item) => [
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
        csv = toCsv(headers, rows);
      } else {
        const templateId = buildTemplateId('delivery-due', layout);
        const { url } = await generatePdf(
          templateId,
          toJsonValue({ items: result }) as Record<string, unknown>,
          'delivery-due',
        );
        pdf = { templateId, url };
      }
      break;
    }
    default:
      throw new ReportParamError(
        'UNKNOWN_REPORT',
        `Unknown reportKey: ${subscription.reportKey}`,
      );
  }

  const payload = {
    reportKey: subscription.reportKey,
    format,
    params: normalizeJsonValue(subscription.params),
    generatedAt: new Date().toISOString(),
    data: toJsonValue(data),
    ...(csv ? { csv } : {}),
    ...(pdf ? { pdf } : {}),
  } as Prisma.InputJsonValue;

  return payload;
}

async function updateRunStatus(
  subscriptionId: string,
  status: string,
  actorId: string | undefined,
) {
  await prisma.reportSubscription.update({
    where: { id: subscriptionId },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: status,
      updatedBy: actorId,
    },
  });
}

async function runSubscription(
  subscription: ReportSubscription,
  actorId: string | undefined,
  dryRun: boolean,
) {
  const recipients = normalizeRecipients(subscription.recipients);
  const channels = normalizeChannels(subscription.channels);
  if (!channels.length) {
    throw new Error('channels_required');
  }
  const payload = await buildReportPayload(subscription);
  if (dryRun) {
    return {
      payload,
      channels,
      recipients,
      deliveries: [],
    };
  }
  const deliveries = channels.map((channel) => ({
    subscriptionId: subscription.id,
    channel,
    status: 'generated',
    target: resolveTarget(channel, recipients),
    payload,
    sentAt: new Date(),
    createdBy: actorId,
  }));
  if (deliveries.length) {
    await prisma.reportDelivery.createMany({ data: deliveries });
  }
  await updateRunStatus(subscription.id, 'success', actorId);
  return {
    payload,
    channels,
    recipients,
    deliveries,
  };
}

export async function registerReportSubscriptionRoutes(app: FastifyInstance) {
  app.get(
    '/report-subscriptions',
    { preHandler: requireRole(reportSubscriptionRoles) },
    async () => {
      const items = await prisma.reportSubscription.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.get(
    '/report-deliveries',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: {
        querystring: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string', format: 'uuid' },
            limit: { type: 'string' },
            offset: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const { subscriptionId, limit, offset } = req.query as {
        subscriptionId?: string;
        limit?: string;
        offset?: string;
      };
      const take = parseLimit(limit, 50, 200);
      const skip = parseOffset(offset);
      const items = await prisma.reportDelivery.findMany({
        where: subscriptionId ? { subscriptionId } : undefined,
        orderBy: { sentAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.post(
    '/report-subscriptions',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionSchema,
    },
    async (req) => {
      const body = req.body as ReportSubscriptionBody;
      const actorId = req.user?.userId;
      const channels =
        body.channels && body.channels.length ? body.channels : ['dashboard'];
      const created = await prisma.reportSubscription.create({
        data: {
          name: body.name?.trim() || undefined,
          reportKey: body.reportKey,
          format: body.format || 'csv',
          schedule: body.schedule?.trim() || undefined,
          params: normalizeJsonInput(body.params),
          recipients: normalizeJsonInput(body.recipients),
          channels: normalizeJsonInput(channels),
          isEnabled: body.isEnabled ?? true,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      return created;
    },
  );

  app.patch(
    '/report-subscriptions/:id',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as ReportSubscriptionBody;
      const existing = await prisma.reportSubscription.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const reportKey =
        body.reportKey !== undefined ? body.reportKey.trim() : undefined;
      if (body.reportKey !== undefined && !reportKey) {
        return reply.status(400).send({
          error: { code: 'INVALID_REPORT_KEY', message: 'Report key is empty' },
        });
      }
      const format = body.format !== undefined ? body.format.trim() : undefined;
      if (body.format !== undefined && !format) {
        return reply.status(400).send({
          error: { code: 'INVALID_FORMAT', message: 'Format is empty' },
        });
      }
      if (body.channels && body.channels.length === 0) {
        return reply.status(400).send({
          error: { code: 'INVALID_CHANNELS', message: 'Channels is empty' },
        });
      }
      const actorId = req.user?.userId;
      const data: Prisma.ReportSubscriptionUpdateInput = {
        name: body.name?.trim() || undefined,
        reportKey: reportKey ?? existing.reportKey,
        format: format ?? existing.format,
        schedule: body.schedule?.trim() || undefined,
        updatedBy: actorId,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'params')) {
        data.params = normalizeJsonInput(body.params);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'recipients')) {
        data.recipients = normalizeJsonInput(body.recipients);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'channels')) {
        data.channels = normalizeJsonInput(body.channels);
      }
      if (typeof body.isEnabled === 'boolean') {
        data.isEnabled = body.isEnabled;
      }
      const updated = await prisma.reportSubscription.update({
        where: { id },
        data,
      });
      return updated;
    },
  );

  app.post(
    '/report-subscriptions/:id/run',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as RunBody;
      const subscription = await prisma.reportSubscription.findUnique({
        where: { id },
      });
      if (!subscription) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const dryRun = Boolean(body.dryRun);
      try {
        const result = await runSubscription(
          subscription,
          req.user?.userId,
          dryRun,
        );
        return result;
      } catch (err) {
        if (!dryRun) {
          await updateRunStatus(subscription.id, 'failed', req.user?.userId);
        }
        if (err instanceof ReportParamError) {
          return reply.code(400).send({
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  app.post(
    '/jobs/report-subscriptions/run',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req) => {
      const { dryRun } = (req.body || {}) as RunBody;
      const items = await prisma.reportSubscription.findMany({
        where: { isEnabled: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const results = [];
      for (const item of items) {
        try {
          const result = await runSubscription(
            item,
            req.user?.userId,
            Boolean(dryRun),
          );
          results.push({
            id: item.id,
            reportKey: item.reportKey,
            deliveries: result.deliveries.length,
          });
        } catch (err) {
          console.error('Failed to run report subscription', {
            subscriptionId: item.id,
            error: err,
          });
          if (!dryRun) {
            await updateRunStatus(item.id, 'failed', req.user?.userId);
          }
          results.push({
            id: item.id,
            reportKey: item.reportKey,
            deliveries: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { ok: true, count: results.length, items: results };
    },
  );
}
