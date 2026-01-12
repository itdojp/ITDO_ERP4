import { promises as fs } from 'fs';
import path from 'path';
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
import {
  generatePdf,
  isSafePdfFilename,
  resolvePdfFilePath,
} from '../services/pdf.js';
import { sendEmail } from '../services/notifier.js';
import { requireRole } from '../services/rbac.js';
import { toCsv } from '../utils/csv.js';
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

type ReportPayload = {
  reportKey: string;
  name?: string | null;
  format: 'csv' | 'pdf';
  params: Prisma.InputJsonValue | null;
  generatedAt: string;
  data: Prisma.InputJsonValue;
  csv?: string;
  csvFilename?: string;
  pdf?: {
    templateId: string;
    url: string;
    filePath?: string;
    filename?: string;
  };
};

class ReportParamError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const DEFAULT_REPORT_RETRY_MAX = 3;
const DEFAULT_REPORT_RETRY_BASE_MINUTES = 60;
const DEFAULT_REPORT_RETRY_MAX_DELAY_MINUTES = 24 * 60;
const DEFAULT_REPORT_STORAGE_DIR = '/tmp/erp4/reports';

const NON_RETRYABLE_ERRORS = new Set([
  'missing_email',
  'missing_recipients',
  'invalid_recipient',
  'missing_attachment',
  'csv_missing',
  'pdf_missing',
  'pdf_template_missing',
  'unknown_channel',
  'smtp_config_missing',
  'smtp_disabled',
  'smtp_unavailable',
]);

function parseNonNegativeInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function resolveReportRetryMax() {
  return parseNonNegativeInt(
    process.env.REPORT_DELIVERY_RETRY_MAX,
    DEFAULT_REPORT_RETRY_MAX,
  );
}

function resolveReportRetryBaseMinutes() {
  return parseNonNegativeInt(
    process.env.REPORT_DELIVERY_RETRY_BASE_MINUTES,
    DEFAULT_REPORT_RETRY_BASE_MINUTES,
  );
}

function resolveReportRetryMaxDelayMinutes() {
  return parseNonNegativeInt(
    process.env.REPORT_DELIVERY_RETRY_MAX_DELAY_MINUTES,
    DEFAULT_REPORT_RETRY_MAX_DELAY_MINUTES,
  );
}

function resolveReportStorageDir() {
  return process.env.REPORT_STORAGE_DIR || DEFAULT_REPORT_STORAGE_DIR;
}

function computeNextRetryAt(now: Date, attempt: number, baseMinutes: number) {
  if (attempt <= 0 || baseMinutes <= 0) return null;
  const factor = Math.pow(2, attempt - 1);
  const maxDelayMinutes = resolveReportRetryMaxDelayMinutes();
  const cappedMinutes =
    maxDelayMinutes > 0
      ? Math.min(baseMinutes * factor, maxDelayMinutes)
      : baseMinutes * factor;
  const delayMs = cappedMinutes * 60 * 1000;
  return new Date(now.getTime() + delayMs);
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function buildReportFilename(
  reportKey: string,
  format: 'csv' | 'pdf',
  hint?: string,
) {
  const safeKey = sanitizeFilenamePart(reportKey || 'report');
  const safeHint = hint ? sanitizeFilenamePart(hint) : '';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  const suffix = safeHint ? `-${safeHint}` : '';
  return `${safeKey}${suffix}-${timestamp}.${format}`;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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

function isRetryableError(error?: string | null) {
  if (!error) return true;
  return !NON_RETRYABLE_ERRORS.has(error);
}

function parseTargetList(value?: string | null) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isReportPayload(value: unknown): value is ReportPayload {
  if (!isPlainObject(value)) return false;
  const raw = value as Record<string, unknown>;
  if (typeof raw.reportKey !== 'string') return false;
  if (raw.format !== 'csv' && raw.format !== 'pdf') return false;
  return true;
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
  if (!value) return 'csv';
  if (value === 'csv' || value === 'pdf') return value;
  throw new ReportParamError('INVALID_FORMAT', 'format must be csv or pdf');
}

async function writeReportFile(filename: string, content: string) {
  const storageDir = resolveReportStorageDir();
  await fs.mkdir(storageDir, { recursive: true });
  const safeName = sanitizeFilenamePart(filename || 'report');
  const filePath = path.join(storageDir, safeName);
  await fs.writeFile(filePath, content);
  return { filePath, filename: safeName };
}

function buildEmailSubject(meta: { reportKey: string; name?: string | null }) {
  const label = meta.name?.trim() || meta.reportKey;
  return `Report ${label}`;
}

function buildEmailBody(payload: ReportPayload) {
  const params = payload.params ? JSON.stringify(payload.params) : '-';
  return [
    `reportKey: ${payload.reportKey}`,
    `format: ${payload.format}`,
    `generatedAt: ${payload.generatedAt}`,
    `params: ${params}`,
  ].join('\n');
}

function resolveFailureNotifyEmails() {
  const raw = process.env.REPORT_DELIVERY_FAILURE_EMAILS || '';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function notifyPermanentFailure(meta: {
  reportKey: string;
  channel: string;
  target?: string | null;
  error?: string | null;
}) {
  const emails = resolveFailureNotifyEmails();
  if (!emails.length) return;
  const subject = `Report delivery failed: ${meta.reportKey}`;
  const body = [
    `reportKey: ${meta.reportKey}`,
    `channel: ${meta.channel}`,
    `target: ${meta.target || '-'}`,
    `error: ${meta.error || '-'}`,
  ].join('\n');
  try {
    await sendEmail(emails, subject, body);
  } catch (err) {
    console.error('[report failure notify failed]', {
      message: err instanceof Error ? err.message : 'notify_failed',
    });
  }
}

async function buildCsvAttachment(payload: ReportPayload) {
  if (!payload.csv) {
    throw new Error('csv_missing');
  }
  const filename =
    payload.csvFilename || buildReportFilename(payload.reportKey, 'csv');
  const { filePath, filename: safeName } = await writeReportFile(
    filename,
    payload.csv,
  );
  return {
    attachment: {
      filename: safeName,
      path: filePath,
      contentType: 'text/csv',
    },
    filePath,
    filename: safeName,
  };
}

async function buildPdfAttachment(payload: ReportPayload) {
  if (!payload.pdf) {
    throw new Error('pdf_missing');
  }
  let filePath = payload.pdf.filePath;
  let filename = payload.pdf.filename;
  let pdf = payload.pdf;
  if (!filePath && filename && isSafePdfFilename(filename)) {
    const candidate = resolvePdfFilePath(filename);
    if (await fileExists(candidate)) {
      filePath = candidate;
    }
  }
  if (!filePath) {
    const templateId = payload.pdf.templateId;
    if (!templateId) {
      throw new Error('pdf_template_missing');
    }
    const data = isPlainObject(payload.data)
      ? payload.data
      : { data: payload.data };
    const result = await generatePdf(
      templateId,
      data as Record<string, unknown>,
      payload.reportKey,
    );
    pdf = {
      ...payload.pdf,
      url: result.url,
      filePath: result.filePath,
      filename: result.filename,
    };
    filePath = result.filePath;
    filename = result.filename;
  }
  if (!filePath || !filename) {
    throw new Error('missing_attachment');
  }
  return {
    attachment: {
      filename,
      path: filePath,
      contentType: 'application/pdf',
    },
    filePath,
    pdf,
  };
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

async function buildReportPayload(
  subscription: ReportSubscription,
): Promise<ReportPayload> {
  const params = isPlainObject(subscription.params) ? subscription.params : {};
  const format = normalizeFormat(subscription.format);
  const layout = typeof params.layout === 'string' ? params.layout : undefined;
  const fromDate = parseDateInput(params.from, 'from');
  const toDate = parseDateInput(params.to, 'to');
  let data: unknown;
  let csv: string | undefined;
  let csvFilename: string | undefined;
  let pdf:
    | {
        templateId: string;
        url: string;
        filePath?: string;
        filename?: string;
      }
    | undefined;

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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('project-effort', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-effort',
        );
        pdf = { templateId, url, filePath, filename };
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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('project-profit', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-profit',
        );
        pdf = { templateId, url, filePath, filename };
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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('project-profit-by-user', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-profit-by-user',
        );
        pdf = { templateId, url, filePath, filename };
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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('project-profit-by-group', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'project-profit-by-group',
        );
        pdf = { templateId, url, filePath, filename };
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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('group-effort', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue({ items: result }) as Record<string, unknown>,
          'group-effort',
        );
        pdf = { templateId, url, filePath, filename };
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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('overtime', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue(result) as Record<string, unknown>,
          'overtime',
        );
        pdf = { templateId, url, filePath, filename };
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
        csvFilename = buildReportFilename(
          subscription.reportKey,
          'csv',
          subscription.id,
        );
      } else {
        const templateId = buildTemplateId('delivery-due', layout);
        const { url, filePath, filename } = await generatePdf(
          templateId,
          toJsonValue({ items: result }) as Record<string, unknown>,
          'delivery-due',
        );
        pdf = { templateId, url, filePath, filename };
      }
      break;
    }
    default:
      throw new ReportParamError(
        'UNKNOWN_REPORT',
        `Unknown reportKey: ${subscription.reportKey}`,
      );
  }

  const payload: ReportPayload = {
    reportKey: subscription.reportKey,
    name: subscription.name ?? null,
    format,
    params: normalizeJsonValue(subscription.params),
    generatedAt: new Date().toISOString(),
    data: toJsonValue(data),
  };
  if (csv) {
    payload.csv = csv;
  }
  if (csvFilename) {
    payload.csvFilename = csvFilename;
  }
  if (pdf) {
    payload.pdf = pdf;
  }

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

function isSuccessStatus(status: string) {
  return status === 'success' || status === 'stub';
}

function isFailureStatus(status: string) {
  return status === 'failed' || status === 'failed_permanent';
}

function computeRunStatus(statuses: string[]) {
  if (statuses.length === 0) return 'skipped';
  const hasSuccess = statuses.some(isSuccessStatus);
  const hasFailure = statuses.some(isFailureStatus);
  if (hasFailure && hasSuccess) return 'partial';
  if (hasFailure) return 'failed';
  if (hasSuccess) return 'success';
  return 'skipped';
}

async function sendReportDelivery(
  channel: string,
  subscription: ReportSubscription,
  payload: ReportPayload,
  recipients: Recipients,
  actorId: string | undefined,
) {
  const now = new Date();
  let payloadToStore = payload;
  const buildBaseData = (
    nextPayload: ReportPayload = payloadToStore,
  ): Omit<Prisma.ReportDeliveryCreateInput, 'status'> => ({
    subscription: { connect: { id: subscription.id } },
    channel,
    payload: nextPayload as Prisma.InputJsonValue,
    createdBy: actorId,
  });

  if (channel === 'email') {
    const emails = recipients.emails ?? [];
    if (!emails.length) {
      const baseData = buildBaseData();
      return {
        ...baseData,
        status: 'skipped',
        error: 'missing_email',
        target: '-',
        sentAt: now,
      };
    }
    const attachments = [];
    try {
      if (payload.format === 'csv') {
        const { attachment, filename } = await buildCsvAttachment(payload);
        if (filename && payload.csvFilename !== filename) {
          payloadToStore = { ...payloadToStore, csvFilename: filename };
        }
        attachments.push(attachment);
      } else {
        const { attachment, pdf } = await buildPdfAttachment(payload);
        if (pdf && payload.pdf !== pdf) {
          payloadToStore = { ...payloadToStore, pdf };
        }
        attachments.push(attachment);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'missing_attachment';
      await notifyPermanentFailure({
        reportKey: subscription.reportKey,
        channel,
        target: emails.join(','),
        error,
      });
      const baseData = buildBaseData();
      return {
        ...baseData,
        status: 'failed_permanent',
        error,
        target: emails.join(','),
        sentAt: now,
        lastErrorAt: now,
      };
    }
    const baseData = buildBaseData(payloadToStore);
    const emailResult = await sendEmail(
      emails,
      buildEmailSubject(subscription),
      buildEmailBody(payloadToStore),
      { attachments },
    );
    const error = emailResult.error;
    const retryMax = resolveReportRetryMax();
    const retryBase = resolveReportRetryBaseMinutes();
    const retryable =
      emailResult.status === 'failed' &&
      isRetryableError(error) &&
      retryMax > 0 &&
      retryBase > 0;
    const retryCount = 0;
    const nextRetryAt = retryable
      ? computeNextRetryAt(now, retryCount + 1, retryBase)
      : null;
    const status =
      emailResult.status === 'failed' && !retryable
        ? 'failed_permanent'
        : emailResult.status;
    if (status === 'failed_permanent') {
      await notifyPermanentFailure({
        reportKey: subscription.reportKey,
        channel,
        target: emailResult.target || emails.join(','),
        error,
      });
    }
    return {
      ...baseData,
      status,
      error,
      target: emailResult.target || emails.join(','),
      sentAt: now,
      retryCount,
      nextRetryAt,
      lastErrorAt:
        status === 'failed' || status === 'failed_permanent' ? now : null,
    };
  }

  if (channel === 'dashboard') {
    const targets = recipients.users?.length
      ? recipients.users
      : recipients.roles?.length
        ? recipients.roles
        : [];
    if (!targets.length) {
      const baseData = buildBaseData();
      return {
        ...baseData,
        status: 'skipped',
        error: 'missing_recipients',
        target: '-',
        sentAt: now,
      };
    }
    const baseData = buildBaseData();
    return {
      ...baseData,
      status: 'success',
      target: targets.join(','),
      sentAt: now,
      lastErrorAt: null,
    };
  }

  const baseData = buildBaseData();
  return {
    ...baseData,
    status: 'failed_permanent',
    error: 'unknown_channel',
    target: '-',
    sentAt: now,
    lastErrorAt: now,
  };
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
  const deliveries: Prisma.ReportDeliveryCreateInput[] = [];
  for (const channel of channels) {
    const delivery = await sendReportDelivery(
      channel,
      subscription,
      payload,
      recipients,
      actorId,
    );
    deliveries.push(delivery);
  }
  const createdDeliveries = [];
  for (const delivery of deliveries) {
    createdDeliveries.push(
      await prisma.reportDelivery.create({ data: delivery }),
    );
  }
  const runStatus = computeRunStatus(deliveries.map((item) => item.status));
  await updateRunStatus(subscription.id, runStatus, actorId);
  return {
    payload,
    channels,
    recipients,
    deliveries: createdDeliveries,
  };
}

async function retryReportDelivery(
  delivery: {
    id: string;
    channel: string;
    payload: Prisma.JsonValue | null;
    target: string | null;
    retryCount: number;
  },
  dryRun: boolean,
) {
  const now = new Date();
  if (delivery.channel !== 'email') {
    return {
      id: delivery.id,
      status: 'skipped',
      error: 'unsupported_channel',
    };
  }
  if (!isReportPayload(delivery.payload)) {
    if (!dryRun) {
      await prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed_permanent',
          error: 'invalid_payload',
          lastErrorAt: now,
          sentAt: now,
          nextRetryAt: null,
        },
      });
      await notifyPermanentFailure({
        reportKey: 'unknown',
        channel: delivery.channel,
        target: delivery.target,
        error: 'invalid_payload',
      });
    }
    return {
      id: delivery.id,
      status: 'failed_permanent',
      error: 'invalid_payload',
    };
  }
  const payload = delivery.payload as ReportPayload;
  let payloadToStore = payload;
  const emails = parseTargetList(delivery.target);
  if (!emails.length) {
    if (!dryRun) {
      await prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed_permanent',
          error: 'missing_email',
          lastErrorAt: now,
          sentAt: now,
          nextRetryAt: null,
        },
      });
      await notifyPermanentFailure({
        reportKey: payload.reportKey,
        channel: delivery.channel,
        target: delivery.target,
        error: 'missing_email',
      });
    }
    return {
      id: delivery.id,
      status: 'failed_permanent',
      error: 'missing_email',
    };
  }
  const attachments = [];
  try {
    if (payload.format === 'csv') {
      const { attachment, filename } = await buildCsvAttachment(payload);
      if (filename && payload.csvFilename !== filename) {
        payloadToStore = { ...payloadToStore, csvFilename: filename };
      }
      attachments.push(attachment);
    } else {
      const { attachment, pdf } = await buildPdfAttachment(payload);
      if (pdf && payload.pdf !== pdf) {
        payloadToStore = { ...payloadToStore, pdf };
      }
      attachments.push(attachment);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'missing_attachment';
    if (!dryRun) {
      await prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed_permanent',
          error,
          lastErrorAt: now,
          sentAt: now,
          nextRetryAt: null,
        },
      });
      await notifyPermanentFailure({
        reportKey: payload.reportKey,
        channel: delivery.channel,
        target: delivery.target,
        error,
      });
    }
    return {
      id: delivery.id,
      status: 'failed_permanent',
      error,
    };
  }
  if (dryRun) {
    return {
      id: delivery.id,
      status: 'dry_run',
      target: emails.join(','),
    };
  }
  const emailResult = await sendEmail(
    emails,
    buildEmailSubject({ reportKey: payload.reportKey, name: payload.name }),
    buildEmailBody(payloadToStore),
    { attachments },
  );
  const error = emailResult.error;
  const nextRetryCount = delivery.retryCount + 1;
  const retryMax = resolveReportRetryMax();
  const retryBase = resolveReportRetryBaseMinutes();
  const retryable =
    emailResult.status === 'failed' &&
    isRetryableError(error) &&
    retryBase > 0 &&
    nextRetryCount < retryMax;
  const nextRetryAt = retryable
    ? computeNextRetryAt(now, nextRetryCount + 1, retryBase)
    : null;
  const status =
    emailResult.status === 'failed' && !retryable
      ? 'failed_permanent'
      : emailResult.status;
  if (status === 'failed_permanent' && !dryRun) {
    await notifyPermanentFailure({
      reportKey: payload.reportKey,
      channel: delivery.channel,
      target: emailResult.target || emails.join(','),
      error,
    });
  }
  await prisma.reportDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      error,
      target: emailResult.target || emails.join(','),
      sentAt: now,
      retryCount: nextRetryCount,
      nextRetryAt,
      lastErrorAt:
        status === 'failed' || status === 'failed_permanent' ? now : null,
      payload: payloadToStore as Prisma.InputJsonValue,
    },
  });
  return {
    id: delivery.id,
    status,
    error,
    nextRetryAt,
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

  app.post(
    '/jobs/report-deliveries/retry',
    {
      preHandler: requireRole(reportSubscriptionRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req) => {
      const { dryRun } = (req.body || {}) as RunBody;
      const retryMax = resolveReportRetryMax();
      const now = new Date();
      const items = await prisma.reportDelivery.findMany({
        where: {
          status: 'failed',
          retryCount: { lt: retryMax },
          nextRetryAt: { lte: now },
        },
        orderBy: { nextRetryAt: 'asc' },
        take: 100,
      });
      const results = [];
      for (const item of items) {
        try {
          if (!dryRun) {
            const claim = await prisma.reportDelivery.updateMany({
              where: {
                id: item.id,
                status: 'failed',
                retryCount: { lt: retryMax },
                nextRetryAt: { lte: now },
              },
              data: { status: 'retrying' },
            });
            if (claim.count === 0) {
              results.push({
                id: item.id,
                status: 'skipped',
                error: 'already_claimed',
              });
              continue;
            }
          }
          const result = await retryReportDelivery(item, Boolean(dryRun));
          results.push(result);
        } catch (err) {
          const error = err instanceof Error ? err.message : 'retry_failed';
          if (!dryRun) {
            await prisma.reportDelivery.update({
              where: { id: item.id },
              data: {
                status: 'failed_permanent',
                error,
                lastErrorAt: now,
                nextRetryAt: null,
              },
            });
            if (isReportPayload(item.payload)) {
              await notifyPermanentFailure({
                reportKey: item.payload.reportKey,
                channel: item.channel,
                target: item.target,
                error,
              });
            }
          }
          results.push({
            id: item.id,
            status: 'failed_permanent',
            error,
          });
        }
      }
      return { ok: true, count: results.length, items: results };
    },
  );
}
