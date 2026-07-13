import type { Prisma } from '@prisma/client';
import type { AuditContext } from '../../services/audit.js';
import { logAudit as defaultLogAudit } from '../../services/audit.js';
import {
  evaluateActionPolicyWithFallback as defaultEvaluateActionPolicyWithFallback,
  type EvaluateActionPolicyWithFallbackResult,
} from '../../services/actionPolicy.js';
import {
  logActionPolicyFallbackAllowedForContextIfNeeded as defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverrideForContextIfNeeded as defaultLogActionPolicyOverride,
} from '../../services/actionPolicyAudit.js';
import { resolveActionPolicyDeniedCode } from '../../services/actionPolicyErrors.js';
import { ensureApprovalEvidenceReady as defaultEnsureApprovalEvidenceReady } from '../../services/approvalEvidenceGate.js';
import { prisma as defaultPrisma } from '../../services/db.js';
import {
  sendEstimateEmail as defaultSendEstimateEmail,
  sendInvoiceEmail as defaultSendInvoiceEmail,
  sendPurchaseOrderEmail as defaultSendPurchaseOrderEmail,
  type NotifyResult,
} from '../../services/notifier.js';
import {
  generatePdf as defaultGeneratePdf,
  type PdfRenderOptions,
  type PdfResult,
} from '../../services/pdf.js';
import {
  getDefaultTemplate as defaultGetDefaultTemplate,
  getPdfTemplate as defaultGetPdfTemplate,
  type PdfTemplate,
} from '../../services/pdfTemplates.js';
import { DocStatusValue, FlowTypeValue, type FlowType } from '../../types.js';

type SendLogMetadata = Record<string, string>;

type TemplateSetting = {
  id: string;
  kind: PdfTemplate['kind'];
  templateId: string;
  layoutConfig?: unknown | null;
  logoUrl?: string | null;
  signatureText?: string | null;
  createdAt?: Date | null;
};

type TemplateResolveResult = {
  template: PdfTemplate | null;
  setting: TemplateSetting | null;
  error?: { status: number; code: string };
};

type SendLogInput = {
  kind: PdfTemplate['kind'];
  targetTable: string;
  targetId: string;
  recipients: string[];
  templateId: string;
  pdfUrl?: string;
  status: string;
  error?: string;
  actorId?: string;
  metadata?: SendLogMetadata;
};

type SendLogClient = {
  documentSendLog: {
    create: (args: {
      data: {
        kind: PdfTemplate['kind'];
        targetTable: string;
        targetId: string;
        channel: string;
        status: string;
        recipients: string[];
        templateId?: string;
        pdfUrl?: string;
        providerMessageId?: string;
        error?: string;
        metadata?: SendLogMetadata;
        createdBy?: string;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: {
        status?: string;
        providerMessageId?: string;
        error?: string;
        updatedBy?: string;
      };
    }) => Promise<unknown>;
  };
};

type SendAuditAction =
  | 'document_send_requested'
  | 'document_send_completed'
  | 'document_send_failed'
  | 'document_send_retried';

type SendAuditInput = {
  auditContext: AuditContext;
  action: SendAuditAction;
  kind: PdfTemplate['kind'];
  targetTable: string;
  targetId: string;
  sendLogId: string;
  status: string;
  templateId: string;
  channel?: string;
  error?: string;
  providerMessageId?: string;
  retryOf?: string;
};

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: FlowType;
  actionKey: 'send';
  targetTable: string;
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type SendEmail = (
  recipients: string[],
  documentNo: string,
  pdf: { filename?: string; path?: string; url?: string },
  options?: { metadata?: Record<string, string> },
) => Promise<NotifyResult>;

type SendDocumentConfig = {
  kind: PdfTemplate['kind'];
  flowType: FlowType;
  targetTable: 'estimates' | 'invoices' | 'purchase_orders';
  recipients: string[];
  deniedMessage: string;
  find: (db: any, id: string) => Promise<any>;
  documentNo: (record: any) => string;
  pdfPayload: (id: string, record: any) => Record<string, unknown>;
  updateAfterNotify: (input: {
    tx: any;
    id: string;
    record: any;
    nextStatus: string;
    pdf: PdfResult;
    notifyResult: NotifyResult;
  }) => Promise<unknown>;
  sendEmail: SendEmail;
};

type SendApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: Omit<ActionPolicyAuditParams, 'reasonText'>,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  ensureApprovalEvidenceReady: typeof defaultEnsureApprovalEvidenceReady;
  generatePdf: typeof defaultGeneratePdf;
  getPdfTemplate: typeof defaultGetPdfTemplate;
  getDefaultTemplate: typeof defaultGetDefaultTemplate;
  sendEstimateEmail: typeof defaultSendEstimateEmail;
  sendInvoiceEmail: typeof defaultSendInvoiceEmail;
  sendPurchaseOrderEmail: typeof defaultSendPurchaseOrderEmail;
  logAudit: typeof defaultLogAudit;
  now: () => number;
};

export type SendApplicationPortOverrides = Partial<SendApplicationPorts>;

export type SendActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export type SendApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type SendApplicationResult<T> =
  { ok: true; value: T } | SendApplicationFailure;

export type SendDocumentInput = {
  id: string;
  templateId?: string;
  templateSettingId?: string;
  reasonText?: string | null;
  evidenceRequiredActionsOverride?: string;
  actor: SendActorContext;
  auditContext: AuditContext;
  ports?: SendApplicationPortOverrides;
};

export type RetryDocumentSendInput = {
  id: string;
  actor: SendActorContext;
  auditContext: AuditContext;
  ports?: SendApplicationPortOverrides;
};

const SUCCESS_NOTIFY_STATUSES = new Set(['stub', 'success']);
const RETRY_BLOCK_STATUSES = new Set([
  'success',
  'stub',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'processed',
]);
const DEFAULT_RETRY_COOLDOWN_MINUTES = 5;

const defaultPorts: SendApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  ensureApprovalEvidenceReady: defaultEnsureApprovalEvidenceReady,
  generatePdf: defaultGeneratePdf,
  getPdfTemplate: defaultGetPdfTemplate,
  getDefaultTemplate: defaultGetDefaultTemplate,
  sendEstimateEmail: defaultSendEstimateEmail,
  sendInvoiceEmail: defaultSendInvoiceEmail,
  sendPurchaseOrderEmail: defaultSendPurchaseOrderEmail,
  logAudit: defaultLogAudit,
  now: () => Date.now(),
};

function ports(overrides?: SendApplicationPortOverrides): SendApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): SendApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): SendApplicationFailure {
  return { ok: false, statusCode, body };
}

function normalizeReasonText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actionPolicyActor(actor: SendActorContext) {
  return {
    userId: actor.userId ?? null,
    roles: actor.roles,
    groupIds: actor.groupIds,
    groupAccountIds: actor.groupAccountIds,
  };
}

function resolveRetryCooldownMs() {
  const raw = process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed) * 60 * 1000;
  }
  return DEFAULT_RETRY_COOLDOWN_MINUTES * 60 * 1000;
}

function shouldMarkSent(result: NotifyResult) {
  return SUCCESS_NOTIFY_STATUSES.has(result.status);
}

function policyDeniedResponse(input: {
  result: EvaluateActionPolicyWithFallbackResult;
  reasonRequiredMessage: string;
  deniedMessage: string;
}): SendApplicationFailure | null {
  const { result } = input;
  if (!result.policyApplied || result.allowed) return null;
  if (result.reason === 'reason_required') {
    return fail(400, {
      error: {
        code: 'REASON_REQUIRED',
        message: input.reasonRequiredMessage,
        details: { matchedPolicyId: result.matchedPolicyId ?? null },
      },
    });
  }
  return fail(403, {
    error: {
      code: resolveActionPolicyDeniedCode(result),
      message: input.deniedMessage,
      details: {
        reason: result.reason,
        matchedPolicyId: result.matchedPolicyId ?? null,
        guardFailures: result.guardFailures ?? null,
      },
    },
  });
}

async function auditPolicyResult(input: {
  config: SendDocumentConfig;
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
  auditContext: AuditContext;
  ports: SendApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: input.config.flowType,
    actionKey: 'send' as const,
    targetTable: input.config.targetTable,
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

async function resolveTemplateContext(
  p: SendApplicationPorts,
  kind: PdfTemplate['kind'],
  params: { templateId?: string; templateSettingId?: string },
): Promise<TemplateResolveResult> {
  let setting: TemplateSetting | null = null;
  let resolvedTemplateId = params.templateId;
  if (params.templateSettingId) {
    setting = (await p.db.docTemplateSetting.findUnique({
      where: { id: params.templateSettingId },
    })) as TemplateSetting | null;
    if (!setting) {
      return {
        template: null,
        setting: null,
        error: { status: 404, code: 'template_setting_not_found' },
      };
    }
    if (setting.kind !== kind) {
      return {
        template: null,
        setting: null,
        error: { status: 400, code: 'template_setting_kind_mismatch' },
      };
    }
    resolvedTemplateId = setting.templateId;
  }

  if (!resolvedTemplateId) {
    const defaultSetting = (await p.db.docTemplateSetting.findFirst({
      where: { kind, isDefault: true },
      orderBy: { createdAt: 'desc' },
    })) as TemplateSetting | null;
    if (defaultSetting) {
      setting = defaultSetting;
      resolvedTemplateId = defaultSetting.templateId;
    }
  }

  let template: PdfTemplate | undefined;
  if (resolvedTemplateId) {
    template = p.getPdfTemplate(resolvedTemplateId);
    if (!template) {
      return {
        template: null,
        setting: null,
        error: { status: 404, code: 'template_not_found' },
      };
    }
    if (template.kind !== kind) {
      return {
        template: null,
        setting: null,
        error: { status: 400, code: 'template_kind_mismatch' },
      };
    }
  } else {
    template = p.getDefaultTemplate(kind);
    if (!template) {
      return {
        template: null,
        setting: null,
        error: { status: 400, code: 'default_template_missing' },
      };
    }
  }

  if (!setting) {
    setting = (await p.db.docTemplateSetting.findFirst({
      where: { kind, templateId: template.id },
      orderBy: { createdAt: 'desc' },
    })) as TemplateSetting | null;
  }

  return { template, setting };
}

function buildPdfOptions(
  setting: TemplateSetting | null,
): PdfRenderOptions | undefined {
  if (!setting) return undefined;
  return {
    layoutConfig: setting.layoutConfig
      ? (setting.layoutConfig as Record<string, unknown>)
      : undefined,
    logoUrl: setting.logoUrl ?? undefined,
    signatureText: setting.signatureText ?? undefined,
  };
}

function buildSendLogMetadata(
  template: PdfTemplate,
  setting: TemplateSetting | null,
  extra?: SendLogMetadata,
): SendLogMetadata {
  const metadata: SendLogMetadata = { templateId: template.id };
  if (setting?.id) {
    metadata.templateSettingId = setting.id;
  }
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => {
      metadata[key] = value;
    });
  }
  return metadata;
}

async function createSendLog(db: SendLogClient, input: SendLogInput) {
  return db.documentSendLog.create({
    data: {
      kind: input.kind,
      targetTable: input.targetTable,
      targetId: input.targetId,
      channel: 'email',
      status: input.status,
      recipients: input.recipients,
      templateId: input.templateId,
      pdfUrl: input.pdfUrl,
      error: input.error,
      metadata: input.metadata,
      createdBy: input.actorId,
    },
    select: { id: true },
  });
}

async function updateSendLog(
  db: SendLogClient,
  params: {
    id: string;
    result: NotifyResult;
    actorId?: string;
  },
) {
  return db.documentSendLog.update({
    where: { id: params.id },
    data: {
      status: params.result.status,
      providerMessageId: params.result.messageId,
      error: params.result.error,
      updatedBy: params.actorId,
    },
  });
}

function buildEmailMetadata(params: {
  sendLogId: string;
  targetTable: string;
  targetId: string;
  kind: PdfTemplate['kind'];
}): SendLogMetadata {
  return {
    sendLogId: params.sendLogId,
    targetTable: params.targetTable,
    targetId: params.targetId,
    kind: params.kind,
  };
}

function extractTemplateSettingId(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const raw = metadata as Record<string, unknown>;
  const value = raw.templateSettingId;
  return typeof value === 'string' ? value : undefined;
}

function buildSendAuditMetadata(
  params: Omit<
    SendAuditInput,
    'auditContext' | 'action' | 'targetTable' | 'targetId'
  >,
): Prisma.InputJsonObject {
  const metadata: Record<string, Prisma.InputJsonValue> = {
    sendLogId: params.sendLogId,
    kind: params.kind,
    channel: params.channel || 'email',
    status: params.status,
    templateId: params.templateId,
  };
  if (params.error) metadata.error = params.error;
  if (params.providerMessageId) {
    metadata.providerMessageId = params.providerMessageId;
  }
  if (params.retryOf) metadata.retryOf = params.retryOf;
  return metadata;
}

async function logSendAudit(p: SendApplicationPorts, params: SendAuditInput) {
  await p.logAudit({
    ...params.auditContext,
    action: params.action,
    targetTable: params.targetTable,
    targetId: params.targetId,
    metadata: buildSendAuditMetadata(params),
  });
}

function invoiceConfig(p: SendApplicationPorts): SendDocumentConfig {
  return {
    kind: 'invoice',
    flowType: FlowTypeValue.invoice,
    targetTable: 'invoices',
    recipients: ['fin@example.com'],
    deniedMessage: 'Invoice cannot be sent',
    find: (db, id) => db.invoice.findUnique({ where: { id } }),
    documentNo: (record) => record.invoiceNo,
    pdfPayload: (id, record) => ({ id, invoiceNo: record.invoiceNo }),
    updateAfterNotify: ({ tx, id, nextStatus, pdf, notifyResult }) =>
      tx.invoice.update({
        where: { id },
        data: {
          status: nextStatus,
          pdfUrl: pdf.url,
          emailMessageId: notifyResult.messageId,
        },
      }),
    sendEmail: p.sendInvoiceEmail,
  };
}

function estimateConfig(p: SendApplicationPorts): SendDocumentConfig {
  return {
    kind: 'estimate',
    flowType: FlowTypeValue.estimate,
    targetTable: 'estimates',
    recipients: ['sales@example.com'],
    deniedMessage: 'Estimate cannot be sent',
    find: (db, id) => db.estimate.findUnique({ where: { id } }),
    documentNo: (record) => record.estimateNo,
    pdfPayload: (id, record) => ({ id, estimateNo: record.estimateNo }),
    updateAfterNotify: ({ tx, id, nextStatus, pdf, notifyResult }) =>
      tx.estimate.update({
        where: { id },
        data: {
          status: nextStatus,
          pdfUrl: pdf.url,
          emailMessageId: notifyResult.messageId,
        },
      }),
    sendEmail: p.sendEstimateEmail,
  };
}

function purchaseOrderConfig(p: SendApplicationPorts): SendDocumentConfig {
  return {
    kind: 'purchase_order',
    flowType: FlowTypeValue.purchase_order,
    targetTable: 'purchase_orders',
    recipients: ['vendor@example.com'],
    deniedMessage: 'PurchaseOrder cannot be sent',
    find: (db, id) => db.purchaseOrder.findUnique({ where: { id } }),
    documentNo: (record) => record.poNo,
    pdfPayload: (id, record) => ({ id, poNo: record.poNo }),
    updateAfterNotify: ({ tx, id, nextStatus, pdf }) =>
      tx.purchaseOrder.update({
        where: { id },
        data: { status: nextStatus, pdfUrl: pdf.url },
      }),
    sendEmail: p.sendPurchaseOrderEmail,
  };
}

async function sendDocument(
  config: SendDocumentConfig,
  input: SendDocumentInput,
  p: SendApplicationPorts,
): Promise<SendApplicationResult<unknown>> {
  const reasonText = normalizeReasonText(input.reasonText);
  const record = await config.find(p.db, input.id);
  if (!record) return fail(404, { error: 'not_found' });

  // action-policy-static-callsites: estimate:send, invoice:send, purchase_order:send
  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: config.flowType,
    actionKey: 'send',
    actor: actionPolicyActor(input.actor),
    reasonText,
    state: { status: record.status, projectId: record.projectId },
    targetTable: config.targetTable,
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: config.deniedMessage,
  });
  if (policyDenied) return policyDenied;

  const approvalEvidenceGate = await p.ensureApprovalEvidenceReady(
    p.db,
    {
      flowType: config.flowType,
      actionKey: 'send',
      targetTable: config.targetTable,
      targetId: input.id,
    },
    input.evidenceRequiredActionsOverride,
  );
  if (!approvalEvidenceGate.allowed) {
    return fail(403, {
      error: {
        code: approvalEvidenceGate.code,
        message: approvalEvidenceGate.message,
        details: {
          approvalInstanceId: approvalEvidenceGate.approvalInstanceId ?? null,
        },
      },
    });
  }

  await auditPolicyResult({
    config,
    targetId: input.id,
    reasonText,
    result: policyRes,
    auditContext: input.auditContext,
    ports: p,
  });

  const resolved = await resolveTemplateContext(p, config.kind, {
    templateId: input.templateId,
    templateSettingId: input.templateSettingId,
  });
  if (!resolved.template) {
    return fail(resolved.error?.status || 400, {
      error: resolved.error?.code || 'invalid_template',
    });
  }
  const template = resolved.template;
  const documentNo = config.documentNo(record);
  const pdf = await p.generatePdf(
    template.id,
    config.pdfPayload(input.id, record),
    documentNo,
    buildPdfOptions(resolved.setting),
  );
  const recipients = config.recipients;
  if (!pdf.filePath || !pdf.filename) {
    const failedSendLog = await createSendLog(p.db, {
      kind: config.kind,
      targetTable: config.targetTable,
      targetId: input.id,
      recipients,
      templateId: template.id,
      pdfUrl: pdf.url,
      status: 'failed',
      error: 'pdf_generation_failed',
      actorId: input.actor.userId ?? undefined,
      metadata: buildSendLogMetadata(template, resolved.setting),
    });
    await logSendAudit(p, {
      auditContext: input.auditContext,
      action: 'document_send_failed',
      kind: config.kind,
      targetTable: config.targetTable,
      targetId: input.id,
      sendLogId: failedSendLog.id,
      status: 'failed',
      templateId: template.id,
      error: 'pdf_generation_failed',
    });
    return fail(500, { error: 'pdf_generation_failed' });
  }

  const sendLog = await createSendLog(p.db, {
    kind: config.kind,
    targetTable: config.targetTable,
    targetId: input.id,
    recipients,
    templateId: template.id,
    pdfUrl: pdf.url,
    status: 'requested',
    actorId: input.actor.userId ?? undefined,
    metadata: buildSendLogMetadata(template, resolved.setting),
  });
  await logSendAudit(p, {
    auditContext: input.auditContext,
    action: 'document_send_requested',
    kind: config.kind,
    targetTable: config.targetTable,
    targetId: input.id,
    sendLogId: sendLog.id,
    status: 'requested',
    templateId: template.id,
  });

  const notifyResult = await config.sendEmail(
    recipients,
    documentNo,
    {
      filename: pdf.filename,
      path: pdf.filePath,
      url: pdf.url,
    },
    {
      metadata: buildEmailMetadata({
        sendLogId: sendLog.id,
        targetTable: config.targetTable,
        targetId: input.id,
        kind: config.kind,
      }),
    },
  );
  const nextStatus = shouldMarkSent(notifyResult)
    ? DocStatusValue.sent
    : record.status;
  const updated = await p.db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const updatedRecord = await config.updateAfterNotify({
        tx,
        id: input.id,
        record,
        nextStatus,
        pdf,
        notifyResult,
      });
      await updateSendLog(tx, {
        id: sendLog.id,
        result: notifyResult,
        actorId: input.actor.userId ?? undefined,
      });
      return updatedRecord;
    },
  );
  await logSendAudit(p, {
    auditContext: input.auditContext,
    action: shouldMarkSent(notifyResult)
      ? 'document_send_completed'
      : 'document_send_failed',
    kind: config.kind,
    targetTable: config.targetTable,
    targetId: input.id,
    sendLogId: sendLog.id,
    status: notifyResult.status,
    templateId: template.id,
    channel: notifyResult.channel,
    error: notifyResult.error,
    providerMessageId: notifyResult.messageId,
  });
  return ok(updated);
}

async function retryTargetSend(input: {
  p: SendApplicationPorts;
  config: SendDocumentConfig;
  sourceSendLog: any;
  targetRecord: any;
  actor: SendActorContext;
  auditContext: AuditContext;
}): Promise<SendApplicationResult<{ status: 'ok'; retryLogId: string }>> {
  const { p, config, sourceSendLog, targetRecord } = input;
  const resolved = await resolveTemplateContext(p, config.kind, {
    templateId: sourceSendLog.templateId ?? undefined,
    templateSettingId: extractTemplateSettingId(sourceSendLog.metadata),
  });
  if (!resolved.template) {
    return fail(resolved.error?.status || 400, {
      error: resolved.error?.code || 'invalid_template',
    });
  }
  const template = resolved.template;
  const documentNo = config.documentNo(targetRecord);
  const pdf = await p.generatePdf(
    template.id,
    config.pdfPayload(sourceSendLog.targetId, targetRecord),
    documentNo,
    buildPdfOptions(resolved.setting),
  );
  if (!pdf.filePath || !pdf.filename) {
    const failedRetryLog = await createSendLog(p.db, {
      kind: config.kind,
      targetTable: config.targetTable,
      targetId: sourceSendLog.targetId,
      recipients: Array.isArray(sourceSendLog.recipients)
        ? (sourceSendLog.recipients as string[])
        : [],
      templateId: template.id,
      pdfUrl: pdf.url,
      status: 'failed',
      error: 'pdf_generation_failed',
      actorId: input.actor.userId ?? undefined,
      metadata: buildSendLogMetadata(template, resolved.setting, {
        retryOf: sourceSendLog.id,
      }),
    });
    await logSendAudit(p, {
      auditContext: input.auditContext,
      action: 'document_send_failed',
      kind: config.kind,
      targetTable: config.targetTable,
      targetId: sourceSendLog.targetId,
      sendLogId: failedRetryLog.id,
      status: 'failed',
      templateId: template.id,
      error: 'pdf_generation_failed',
      retryOf: sourceSendLog.id,
    });
    return fail(500, { error: 'pdf_generation_failed' });
  }

  const recipients = Array.isArray(sourceSendLog.recipients)
    ? (sourceSendLog.recipients as string[])
    : config.recipients;
  const retryLog = await createSendLog(p.db, {
    kind: config.kind,
    targetTable: config.targetTable,
    targetId: sourceSendLog.targetId,
    recipients,
    templateId: template.id,
    pdfUrl: pdf.url,
    status: 'requested',
    actorId: input.actor.userId ?? undefined,
    metadata: buildSendLogMetadata(template, resolved.setting, {
      retryOf: sourceSendLog.id,
    }),
  });
  await logSendAudit(p, {
    auditContext: input.auditContext,
    action: 'document_send_retried',
    kind: config.kind,
    targetTable: config.targetTable,
    targetId: sourceSendLog.targetId,
    sendLogId: retryLog.id,
    status: 'requested',
    templateId: template.id,
    retryOf: sourceSendLog.id,
  });
  const notifyResult = await config.sendEmail(
    recipients,
    documentNo,
    { filename: pdf.filename, path: pdf.filePath, url: pdf.url },
    {
      metadata: buildEmailMetadata({
        sendLogId: retryLog.id,
        targetTable: config.targetTable,
        targetId: sourceSendLog.targetId,
        kind: config.kind,
      }),
    },
  );
  const nextStatus = shouldMarkSent(notifyResult)
    ? DocStatusValue.sent
    : targetRecord.status;
  await p.db.$transaction(async (tx: Prisma.TransactionClient) => {
    await config.updateAfterNotify({
      tx,
      id: targetRecord.id,
      record: targetRecord,
      nextStatus,
      pdf,
      notifyResult,
    });
    await updateSendLog(tx, {
      id: retryLog.id,
      result: notifyResult,
      actorId: input.actor.userId ?? undefined,
    });
  });
  await logSendAudit(p, {
    auditContext: input.auditContext,
    action: shouldMarkSent(notifyResult)
      ? 'document_send_completed'
      : 'document_send_failed',
    kind: config.kind,
    targetTable: config.targetTable,
    targetId: sourceSendLog.targetId,
    sendLogId: retryLog.id,
    status: notifyResult.status,
    templateId: template.id,
    channel: notifyResult.channel,
    error: notifyResult.error,
    providerMessageId: notifyResult.messageId,
    retryOf: sourceSendLog.id,
  });
  return ok({ status: 'ok', retryLogId: retryLog.id });
}

export async function sendInvoiceDocument(
  input: SendDocumentInput,
): Promise<SendApplicationResult<unknown>> {
  const p = ports(input.ports);
  return sendDocument(invoiceConfig(p), input, p);
}

export async function sendEstimateDocument(
  input: SendDocumentInput,
): Promise<SendApplicationResult<unknown>> {
  const p = ports(input.ports);
  return sendDocument(estimateConfig(p), input, p);
}

export async function sendPurchaseOrderDocument(
  input: SendDocumentInput,
): Promise<SendApplicationResult<unknown>> {
  const p = ports(input.ports);
  return sendDocument(purchaseOrderConfig(p), input, p);
}

export async function retryDocumentSend(
  input: RetryDocumentSendInput,
): Promise<SendApplicationResult<{ status: 'ok'; retryLogId: string }>> {
  const p = ports(input.ports);
  const sendLog = await p.db.documentSendLog.findUnique({
    where: { id: input.id },
  });
  if (!sendLog) return fail(404, { error: 'not_found' });
  if (RETRY_BLOCK_STATUSES.has(sendLog.status)) {
    return fail(400, { error: 'already_sent' });
  }
  const cooldownMs = resolveRetryCooldownMs();
  if (cooldownMs > 0) {
    const lastEvent = await p.db.documentSendEvent.findFirst({
      where: { sendLogId: input.id },
      orderBy: { createdAt: 'desc' },
    });
    const lastActivity =
      lastEvent?.createdAt ||
      (sendLog.updatedAt instanceof Date ? sendLog.updatedAt : null) ||
      (sendLog.createdAt instanceof Date ? sendLog.createdAt : null);
    if (lastActivity) {
      const lastTime = lastActivity.getTime();
      if (!Number.isNaN(lastTime) && p.now() - lastTime < cooldownMs) {
        return fail(429, { error: 'retry_too_soon' });
      }
    }
  }

  if (sendLog.targetTable === 'invoices') {
    const invoice = await p.db.invoice.findUnique({
      where: { id: sendLog.targetId },
    });
    if (!invoice) return fail(404, { error: 'target_not_found' });
    return retryTargetSend({
      p,
      config: invoiceConfig(p),
      sourceSendLog: sendLog,
      targetRecord: invoice,
      actor: input.actor,
      auditContext: input.auditContext,
    });
  }

  if (sendLog.targetTable === 'purchase_orders') {
    const po = await p.db.purchaseOrder.findUnique({
      where: { id: sendLog.targetId },
    });
    if (!po) return fail(404, { error: 'target_not_found' });
    return retryTargetSend({
      p,
      config: purchaseOrderConfig(p),
      sourceSendLog: sendLog,
      targetRecord: po,
      actor: input.actor,
      auditContext: input.auditContext,
    });
  }

  return fail(400, { error: 'unsupported_target' });
}
