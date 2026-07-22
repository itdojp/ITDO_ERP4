import { promises as fs } from 'fs';
import path from 'path';
import { Prisma, type ReportSubscription } from '@prisma/client';
import { prisma } from '../../services/db.js';
import {
  reportDeliveryDue,
  reportGroupEffort,
  reportOvertime,
  reportProjectEffort,
  reportProjectProfit,
  reportProjectProfitByGroup,
  reportProjectProfitByUser,
} from '../../services/reports.js';
import {
  generatePdf,
  isSafePdfFilename,
  renderPdfBuffer,
  resolvePdfFilePath,
} from '../../services/pdf.js';
import { sendEmail } from '../../services/notifier.js';
import { toCsv } from '../../utils/csv.js';
import { parseDateParam } from '../../utils/date.js';
import {
  isRetryableReportDeliveryError,
  isRetryableThrownReportDeliveryError,
  parseReportDeliveryTargets,
} from './reportDeliveryPolicy.js';
import {
  buildReportFilename,
  readReportArtifactBuffer,
  resolveReportProvider,
  resolveReportStorageDir,
  sanitizeReportFilenamePart,
  storeReportOutputArtifact,
  type ReportArtifactRef,
  type ReportStorageDependencies,
} from './reportOutputArtifacts.js';

export type { ReportStorageDependencies } from './reportOutputArtifacts.js';

export type ReportSubscriptionBody = {
  name?: string;
  reportKey: string;
  format?: string;
  schedule?: string;
  params?: unknown;
  recipients?: Record<string, unknown>;
  channels?: string[];
  isEnabled?: boolean;
};

export type RunBody = {
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
  artifact?: ReportArtifactRef;
  csv?: string;
  csvFilename?: string;
  pdf?: {
    templateId: string;
    url: string;
    filePath?: string;
    filename?: string;
  };
};

export class ReportParamError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class ReportSubscriptionNotFoundError extends Error {
  constructor() {
    super('not_found');
  }
}

const DEFAULT_REPORT_RETRY_MAX = 3;
const DEFAULT_REPORT_RETRY_BASE_MINUTES = 60;
const DEFAULT_REPORT_RETRY_MAX_DELAY_MINUTES = 24 * 60;

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

const REPORT_SUBSCRIPTION_SCHEDULE_PATTERN = /^([\d*/,-]+\s+){4}[\d*/,-]+$/;

export function normalizeReportSubscriptionSchedule(
  value: string | null | undefined,
) {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!REPORT_SUBSCRIPTION_SCHEDULE_PATTERN.test(trimmed)) {
    throw new ReportParamError(
      'INVALID_SCHEDULE',
      'Schedule must be a five-field cron expression',
    );
  }
  return trimmed;
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
  const safeName = sanitizeReportFilenamePart(filename || 'report');
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

async function buildCsvAttachment(
  payload: ReportPayload,
  dependencies: ReportStorageDependencies,
) {
  if (payload.artifact) {
    return {
      attachment: {
        filename: payload.artifact.filename,
        content: await readReportArtifactBuffer(dependencies, payload.artifact),
        contentType: payload.artifact.contentType,
      },
      filename: payload.artifact.filename,
    };
  }
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

async function buildPdfAttachment(
  payload: ReportPayload,
  dependencies: ReportStorageDependencies,
) {
  if (!payload.pdf) {
    throw new Error('pdf_missing');
  }
  if (payload.artifact) {
    return {
      attachment: {
        filename: payload.artifact.filename,
        content: await readReportArtifactBuffer(dependencies, payload.artifact),
        contentType: payload.artifact.contentType,
      },
      pdf: payload.pdf,
    };
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
    const result = await (dependencies.generatePdf ?? generatePdf)(
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
  actorId: string | undefined,
  dryRun: boolean,
  dependencies: ReportStorageDependencies,
): Promise<ReportPayload> {
  const generatedAt = dependencies.now?.() ?? new Date();
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
  let pdfHint: string | undefined;
  let artifact: ReportArtifactRef | undefined;

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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('project-effort', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'project-effort';
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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('project-profit', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'project-profit';
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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('project-profit-by-user', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'project-profit-by-user';
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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('project-profit-by-group', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'project-profit-by-group';
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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('group-effort', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'group-effort';
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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('overtime', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'overtime';
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
          generatedAt,
        );
      } else {
        const templateId = buildTemplateId('delivery-due', layout);
        pdf = { templateId, url: '' };
        pdfHint = 'delivery-due';
      }
      break;
    }
    default:
      throw new ReportParamError(
        'UNKNOWN_REPORT',
        `Unknown reportKey: ${subscription.reportKey}`,
      );
  }

  const dataJson = toJsonValue(data);
  if (pdf) {
    if (dryRun) {
      pdf = {
        ...pdf,
        url: `stub://pdf/${pdf.templateId}/dry-run`,
      };
    } else if (resolveReportProvider() === 'local') {
      const result = await (dependencies.generatePdf ?? generatePdf)(
        pdf.templateId,
        dataJson as Record<string, unknown>,
        pdfHint,
        undefined,
        {
          now: () => generatedAt,
          storageProvider: 'local',
        },
      );
      pdf = {
        ...pdf,
        url: result.url,
        filePath: result.filePath,
        filename: result.filename,
      };
    }
  }

  if (!dryRun && resolveReportProvider() === 'gdrive') {
    let content: Buffer;
    let contentType: string;
    let filename: string;
    if (format === 'csv') {
      if (!csv) throw new Error('csv_missing');
      content = Buffer.from(csv, 'utf8');
      contentType = 'text/csv; charset=utf-8';
      filename =
        csvFilename ||
        buildReportFilename(
          subscription.reportKey,
          'csv',
          undefined,
          generatedAt,
        );
    } else {
      if (!pdf) throw new Error('pdf_missing');
      content = await (dependencies.renderPdfBuffer ?? renderPdfBuffer)(
        pdf.templateId,
        dataJson as Record<string, unknown>,
        undefined,
        generatedAt,
      );
      contentType = 'application/pdf';
      filename = buildReportFilename(
        subscription.reportKey,
        'pdf',
        subscription.id,
        generatedAt,
      );
    }
    artifact = await storeReportOutputArtifact({
      actorId,
      content,
      contentType,
      dependencies,
      filename,
      format,
      generatedAt,
      subscriptionId: subscription.id,
    });
    if (pdf) {
      pdf = {
        ...pdf,
        url: artifact.url,
        filename,
      };
    }
  }

  const payload: ReportPayload = {
    reportKey: subscription.reportKey,
    name: subscription.name ?? null,
    format,
    params: normalizeJsonValue(subscription.params),
    generatedAt: generatedAt.toISOString(),
    data: dataJson,
  };
  if (artifact) {
    payload.artifact = artifact;
  }
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

function isQueuedStatus(status: string) {
  return status === 'pending' || status === 'sending' || status === 'retrying';
}

function computeRunStatus(statuses: string[]) {
  if (statuses.length === 0) return 'skipped';
  const hasSuccess = statuses.some(isSuccessStatus);
  const hasFailure = statuses.some(isFailureStatus);
  const hasQueued = statuses.some(isQueuedStatus);
  if (hasFailure && (hasSuccess || hasQueued)) return 'partial';
  if (hasFailure) return 'failed';
  if (hasQueued) return 'queued';
  if (hasSuccess) return 'success';
  return 'skipped';
}

type ReportDeliveryQueueItem = {
  id: string;
  channel: string;
  status: string;
  payload: Prisma.JsonValue | null;
  target: string | null;
  retryCount: number;
  nextRetryAt?: Date | null;
};

async function buildReportDeliveryData(
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
    const baseData = buildBaseData(payloadToStore);
    return {
      ...baseData,
      status: 'pending',
      target: emails.join(','),
      retryCount: 0,
      nextRetryAt: null,
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

async function claimReportDelivery(
  delivery: ReportDeliveryQueueItem,
  now: Date,
  dryRun: boolean,
) {
  if (dryRun) return 1;
  const retryMax = resolveReportRetryMax();
  if (delivery.status === 'pending') {
    const claimed = await prisma.reportDelivery.updateMany({
      where: {
        id: delivery.id,
        status: 'pending',
      },
      data: { status: 'sending' },
    });
    return claimed.count;
  }
  if (delivery.status === 'failed') {
    const claimed = await prisma.reportDelivery.updateMany({
      where: {
        id: delivery.id,
        status: 'failed',
        retryCount: { lt: retryMax },
        nextRetryAt: { lte: now },
      },
      data: { status: 'retrying' },
    });
    return claimed.count;
  }
  return 0;
}

async function persistUnexpectedDeliveryFailure(
  delivery: ReportDeliveryQueueItem,
  error: unknown,
  now: Date,
) {
  const errorMessage =
    error instanceof Error ? error.message : String(error || 'retry_failed');
  const isRetry =
    delivery.status === 'failed' || delivery.status === 'retrying';
  const retryMax = resolveReportRetryMax();
  const retryBase = resolveReportRetryBaseMinutes();
  const nextRetryCount = isRetry
    ? delivery.retryCount + 1
    : delivery.retryCount;
  const retryable =
    isRetryableReportDeliveryError(errorMessage) &&
    retryBase > 0 &&
    (isRetry ? nextRetryCount < retryMax : retryMax > 0);
  const status = retryable ? 'failed' : 'failed_permanent';
  const nextRetryAt = retryable
    ? computeNextRetryAt(now, nextRetryCount + 1, retryBase)
    : null;
  const updated = await prisma.reportDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      error: errorMessage,
      retryCount: nextRetryCount,
      nextRetryAt,
      lastErrorAt: now,
      sentAt: now,
    },
  });
  if (status === 'failed_permanent' && isReportPayload(delivery.payload)) {
    await notifyPermanentFailure({
      reportKey: delivery.payload.reportKey,
      channel: delivery.channel,
      target: delivery.target,
      error: errorMessage,
    });
  }
  return updated;
}

async function runSubscription(
  subscription: ReportSubscription,
  actorId: string | undefined,
  dryRun: boolean,
  dependencies: ReportStorageDependencies,
) {
  const recipients = normalizeRecipients(subscription.recipients);
  const channels = normalizeChannels(subscription.channels);
  if (!channels.length) {
    throw new Error('channels_required');
  }
  const payload = await buildReportPayload(
    subscription,
    actorId,
    dryRun,
    dependencies,
  );
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
    const delivery = await buildReportDeliveryData(
      channel,
      subscription,
      payload,
      recipients,
      actorId,
    );
    deliveries.push(delivery);
  }
  const createdDeliveries = [];
  const deliveryStatuses: string[] = [];
  for (const delivery of deliveries) {
    const created = await prisma.reportDelivery.create({ data: delivery });
    if (created.status === 'pending') {
      const queuedItem: ReportDeliveryQueueItem = {
        id: created.id,
        channel: created.channel,
        status: created.status,
        payload: created.payload,
        target: created.target,
        retryCount: created.retryCount,
        nextRetryAt: created.nextRetryAt,
      };
      const claimCount = await claimReportDelivery(
        queuedItem,
        new Date(),
        false,
      );
      if (claimCount === 0) {
        createdDeliveries.push(created);
        deliveryStatuses.push(created.status);
        continue;
      }
      try {
        const result = await retryReportDelivery(
          queuedItem,
          false,
          dependencies,
        );
        createdDeliveries.push(result);
        deliveryStatuses.push(result.status);
      } catch (error) {
        const failedDelivery = await persistUnexpectedDeliveryFailure(
          queuedItem,
          error,
          new Date(),
        );
        createdDeliveries.push(failedDelivery);
        deliveryStatuses.push(failedDelivery.status);
      }
      continue;
    }
    createdDeliveries.push(created);
    deliveryStatuses.push(created.status);
  }
  const runStatus = computeRunStatus(deliveryStatuses);
  await updateRunStatus(subscription.id, runStatus, actorId);
  return {
    payload,
    channels,
    recipients,
    deliveries: createdDeliveries,
  };
}

async function retryReportDelivery(
  delivery: ReportDeliveryQueueItem,
  dryRun: boolean,
  dependencies: ReportStorageDependencies,
) {
  const now = new Date();
  const isRetry =
    delivery.status === 'failed' || delivery.status === 'retrying';
  if (delivery.channel !== 'email') {
    return {
      id: delivery.id,
      status: 'skipped',
      error: 'unsupported_channel',
    };
  }
  if (!isReportPayload(delivery.payload)) {
    if (!dryRun) {
      const updated = await prisma.reportDelivery.update({
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
      return updated;
    }
    return {
      id: delivery.id,
      status: 'failed_permanent',
      error: 'invalid_payload',
    };
  }
  const payload = delivery.payload as ReportPayload;
  let payloadToStore = payload;
  const emails = parseReportDeliveryTargets(delivery.target);
  if (!emails.length) {
    if (!dryRun) {
      const updated = await prisma.reportDelivery.update({
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
      return updated;
    }
    return {
      id: delivery.id,
      status: 'failed_permanent',
      error: 'missing_email',
    };
  }
  if (dryRun) {
    return {
      id: delivery.id,
      status: 'dry_run',
      target: emails.join(','),
    };
  }
  const attachments = [];
  try {
    if (payload.format === 'csv') {
      const { attachment, filename } = await buildCsvAttachment(
        payload,
        dependencies,
      );
      if (filename && payload.csvFilename !== filename) {
        payloadToStore = { ...payloadToStore, csvFilename: filename };
      }
      attachments.push(attachment);
    } else {
      const { attachment, pdf } = await buildPdfAttachment(
        payload,
        dependencies,
      );
      if (pdf && payload.pdf !== pdf) {
        payloadToStore = { ...payloadToStore, pdf };
      }
      attachments.push(attachment);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'missing_attachment';
    const retryMax = resolveReportRetryMax();
    const retryBase = resolveReportRetryBaseMinutes();
    const nextRetryCount = isRetry
      ? delivery.retryCount + 1
      : delivery.retryCount;
    const retryable =
      isRetryableThrownReportDeliveryError(err, error) &&
      retryBase > 0 &&
      (isRetry ? nextRetryCount < retryMax : retryMax > 0);
    const status = retryable ? 'failed' : 'failed_permanent';
    const nextRetryAt = retryable
      ? computeNextRetryAt(now, nextRetryCount + 1, retryBase)
      : null;
    if (!dryRun) {
      const updated = await prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          error,
          retryCount: nextRetryCount,
          nextRetryAt,
          lastErrorAt: now,
          sentAt: now,
        },
      });
      if (status === 'failed_permanent') {
        await notifyPermanentFailure({
          reportKey: payload.reportKey,
          channel: delivery.channel,
          target: delivery.target,
          error,
        });
      }
      return updated;
    }
    return {
      id: delivery.id,
      status,
      error,
    };
  }
  const emailResult = await sendEmail(
    emails,
    buildEmailSubject({ reportKey: payload.reportKey, name: payload.name }),
    buildEmailBody(payloadToStore),
    { attachments },
  );
  const error = emailResult.error;
  const retryMax = resolveReportRetryMax();
  const retryBase = resolveReportRetryBaseMinutes();
  const nextRetryCount = isRetry
    ? delivery.retryCount + 1
    : delivery.retryCount;
  const retryable =
    emailResult.status === 'failed' &&
    isRetryableReportDeliveryError(error) &&
    retryBase > 0 &&
    (isRetry ? nextRetryCount < retryMax : retryMax > 0);
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
  const updated = await prisma.reportDelivery.update({
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
  return updated;
}

export async function listReportSubscriptions() {
  const items = await prisma.reportSubscription.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return { items };
}

export async function listReportDeliveries(query: {
  subscriptionId?: string;
  limit?: string;
  offset?: string;
}) {
  const take = parseLimit(query.limit, 50, 200);
  const skip = parseOffset(query.offset);
  const items = await prisma.reportDelivery.findMany({
    where: query.subscriptionId
      ? { subscriptionId: query.subscriptionId }
      : undefined,
    orderBy: { sentAt: 'desc' },
    take,
    skip,
  });
  return { items, limit: take, offset: skip };
}

export async function createReportSubscription(
  body: ReportSubscriptionBody,
  actorId: string | undefined,
) {
  const channels =
    body.channels && body.channels.length ? body.channels : ['dashboard'];
  return prisma.reportSubscription.create({
    data: {
      name: body.name?.trim() || undefined,
      reportKey: body.reportKey,
      format: body.format || 'csv',
      schedule: normalizeReportSubscriptionSchedule(body.schedule),
      params: normalizeJsonInput(body.params),
      recipients: normalizeJsonInput(body.recipients),
      channels: normalizeJsonInput(channels),
      isEnabled: body.isEnabled ?? true,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });
}

export async function updateReportSubscription(
  id: string,
  body: ReportSubscriptionBody,
  actorId: string | undefined,
) {
  const existing = await prisma.reportSubscription.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new ReportSubscriptionNotFoundError();
  }
  const reportKey =
    body.reportKey !== undefined ? body.reportKey.trim() : undefined;
  if (body.reportKey !== undefined && !reportKey) {
    throw new ReportParamError('INVALID_REPORT_KEY', 'Report key is empty');
  }
  const format = body.format !== undefined ? body.format.trim() : undefined;
  if (body.format !== undefined && !format) {
    throw new ReportParamError('INVALID_FORMAT', 'Format is empty');
  }
  if (body.channels && body.channels.length === 0) {
    throw new ReportParamError('INVALID_CHANNELS', 'Channels is empty');
  }
  const data: Prisma.ReportSubscriptionUpdateInput = {
    name: body.name?.trim() || undefined,
    reportKey: reportKey ?? existing.reportKey,
    format: format ?? existing.format,
    schedule: normalizeReportSubscriptionSchedule(body.schedule),
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
  return prisma.reportSubscription.update({ where: { id }, data });
}

export async function runReportSubscriptionById(
  id: string,
  actorId: string | undefined,
  dryRun: boolean,
  dependencies: ReportStorageDependencies = {},
) {
  const subscription = await prisma.reportSubscription.findUnique({
    where: { id },
  });
  if (!subscription) {
    throw new ReportSubscriptionNotFoundError();
  }
  try {
    return await runSubscription(subscription, actorId, dryRun, dependencies);
  } catch (err) {
    if (!dryRun) {
      await updateRunStatus(subscription.id, 'failed', actorId);
    }
    throw err;
  }
}

export async function runDueReportSubscriptions(
  actorId: string | undefined,
  dryRun: boolean,
  dependencies: ReportStorageDependencies = {},
) {
  const items = await prisma.reportSubscription.findMany({
    where: { isEnabled: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const results = [];
  for (const item of items) {
    try {
      const result = await runSubscription(item, actorId, dryRun, dependencies);
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
        await updateRunStatus(item.id, 'failed', actorId);
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
}

export async function retryDueReportDeliveries(
  dryRun: boolean,
  dependencies: ReportStorageDependencies = {},
) {
  const retryMax = resolveReportRetryMax();
  const now = new Date();
  const pendingItems = await prisma.reportDelivery.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const remaining = Math.max(0, 100 - pendingItems.length);
  const failedItems =
    remaining > 0
      ? await prisma.reportDelivery.findMany({
          where: {
            status: 'failed',
            retryCount: { lt: retryMax },
            nextRetryAt: { lte: now },
          },
          orderBy: [{ nextRetryAt: 'asc' }, { createdAt: 'asc' }],
          take: remaining,
        })
      : [];
  const items = [...pendingItems, ...failedItems];
  const results = [];
  for (const item of items) {
    try {
      const claimCount = await claimReportDelivery(item, now, dryRun);
      if (claimCount === 0) {
        results.push({
          id: item.id,
          status: 'skipped',
          error: 'already_claimed',
        });
        continue;
      }
      const result = await retryReportDelivery(item, dryRun, dependencies);
      results.push(result);
    } catch (err) {
      if (!dryRun) {
        results.push(await persistUnexpectedDeliveryFailure(item, err, now));
        continue;
      }
      results.push({
        id: item.id,
        status: 'failed_permanent',
        error: err instanceof Error ? err.message : 'retry_failed',
      });
    }
  }
  return { ok: true, count: results.length, items: results };
}
