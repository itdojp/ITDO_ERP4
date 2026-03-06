import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';

type SendGridEvent = {
  event?: string;
  sg_message_id?: string;
  timestamp?: number;
  custom_args?: Record<string, string>;
};

type SendLogRecord = {
  id: string;
  kind: string;
  targetTable: string;
  targetId: string;
  channel: string;
  providerMessageId?: string | null;
  status: string;
  error?: string | null;
};

type PendingStatusUpdate = {
  status: string;
  error?: string;
  eventType: string;
  providerMessageId?: string | null;
  originalStatus: string;
  kind: string;
  targetTable: string;
  targetId: string;
  channel: string;
};

type PendingEventRecord = {
  sendLogId: string;
  eventType: string;
  eventAt?: Date;
  payload: SendGridEvent;
};

const FAILURE_EVENTS = new Set(['bounce', 'dropped', 'spamreport']);
const FAILURE_STATUSES = new Set(['bounced', 'dropped', 'spamreport']);
const AUDITED_PROVIDER_EVENTS = new Set([
  'delivered',
  'bounce',
  'dropped',
  'spamreport',
]);
const STATUS_RANK: Record<string, number> = {
  requested: 0,
  processed: 10,
  deferred: 20,
  delivered: 30,
  opened: 40,
  clicked: 50,
  spamreport: 70,
  dropped: 80,
  bounced: 90,
};

function resolveMaxBatchSize() {
  const raw = process.env.SENDGRID_EVENT_MAX_BATCH;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 500;
}

function resolveMaxBodyBytes() {
  const raw = process.env.SENDGRID_EVENT_MAX_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 1024 * 1024;
}

function resolveSendLogId(event: SendGridEvent): string | null {
  const args = event.custom_args;
  if (args?.sendLogId) return args.sendLogId;
  if (args?.send_log_id) return args.send_log_id;
  return null;
}

function normalizeSendLogStatus(eventType?: string) {
  if (!eventType) return null;
  switch (eventType) {
    case 'delivered':
      return 'delivered';
    case 'open':
      return 'opened';
    case 'click':
      return 'clicked';
    case 'bounce':
      return 'bounced';
    case 'dropped':
      return 'dropped';
    case 'spamreport':
      return 'spamreport';
    case 'deferred':
      return 'deferred';
    case 'processed':
      return 'processed';
    default:
      return null;
  }
}

function shouldUpdateStatus(current: string, next: string) {
  const currentRank = STATUS_RANK[current] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;
  return nextRank > currentRank;
}

function shouldAuditProviderEvent(eventType: string) {
  return AUDITED_PROVIDER_EVENTS.has(eventType);
}

function buildProviderAuditMetadata(
  update: PendingStatusUpdate,
  sendLogId: string,
): Prisma.InputJsonObject {
  const metadata: Record<string, Prisma.InputJsonValue> = {
    sendLogId,
    provider: 'sendgrid',
    eventType: update.eventType,
    previousStatus: update.originalStatus,
    nextStatus: update.status,
    kind: update.kind,
    channel: update.channel,
  };
  if (update.providerMessageId) {
    metadata.providerMessageId = update.providerMessageId;
  }
  if (update.error) {
    metadata.error = update.error;
  }
  return metadata;
}

function toEventDate(timestamp?: number) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function passesWebhookKey(headers: Record<string, unknown>) {
  const expected = process.env.SENDGRID_EVENT_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided = headers['x-erp4-webhook-key'];
  return typeof provided === 'string' && provided === expected;
}

function resolveSendLog(
  event: SendGridEvent,
  logsById: Map<string, SendLogRecord>,
  logsBySgId: Map<string, SendLogRecord>,
) {
  const sendLogId = resolveSendLogId(event);
  if (sendLogId) {
    const byId = logsById.get(sendLogId);
    if (byId) return byId;
  }
  if (event.sg_message_id) {
    return logsBySgId.get(event.sg_message_id) ?? null;
  }
  return null;
}

function buildLogLookup(sendLogs: SendLogRecord[], sgMessageIds: Set<string>) {
  const logsById = new Map<string, SendLogRecord>();
  const logsBySgId = new Map<string, SendLogRecord>();
  sendLogs.forEach((log) => {
    logsById.set(log.id as string, log);
  });
  sgMessageIds.forEach((sgId) => {
    const matched = sendLogs.find((log) =>
      typeof log.providerMessageId === 'string'
        ? log.providerMessageId.includes(sgId)
        : false,
    );
    if (matched) {
      logsBySgId.set(sgId, matched);
    }
  });
  return { logsById, logsBySgId };
}

export async function registerSendEventRoutes(app: FastifyInstance) {
  app.post(
    '/webhooks/sendgrid/events',
    { bodyLimit: resolveMaxBodyBytes() },
    async (req, reply) => {
      if (!passesWebhookKey(req.headers as Record<string, unknown>)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const contentLength = req.headers['content-length'];
      if (contentLength) {
        const length = Number(contentLength);
        if (Number.isFinite(length) && length > resolveMaxBodyBytes()) {
          return reply.code(413).send({ error: 'payload_too_large' });
        }
      }
      const payload = req.body as SendGridEvent[] | SendGridEvent | undefined;
      const events = Array.isArray(payload)
        ? payload
        : payload
          ? [payload]
          : [];
      if (!events.length) {
        return reply.code(400).send({ error: 'empty_payload' });
      }
      const maxBatch = resolveMaxBatchSize();
      if (events.length > maxBatch) {
        return reply.code(413).send({ error: 'too_many_events' });
      }

      const sendLogIds = new Set<string>();
      const sgMessageIds = new Set<string>();
      events.forEach((event) => {
        const sendLogId = resolveSendLogId(event);
        if (sendLogId) {
          sendLogIds.add(sendLogId);
        }
        if (event.sg_message_id) {
          sgMessageIds.add(event.sg_message_id);
        }
      });

      const orConditions: Array<{
        id?: { in: string[] };
        providerMessageId?: { contains: string };
      }> = [];
      if (sendLogIds.size > 0) {
        orConditions.push({ id: { in: Array.from(sendLogIds) } });
      }
      if (sgMessageIds.size > 0) {
        sgMessageIds.forEach((sgId) => {
          orConditions.push({ providerMessageId: { contains: sgId } });
        });
      }

      const sendLogs = orConditions.length
        ? ((await prisma.documentSendLog.findMany({
            where: { OR: orConditions },
          })) as SendLogRecord[])
        : [];
      const { logsById, logsBySgId } = buildLogLookup(sendLogs, sgMessageIds);

      let stored = 0;
      const eventRecords: PendingEventRecord[] = [];
      const pendingUpdates = new Map<string, PendingStatusUpdate>();
      const pendingAudits = new Map<string, PendingStatusUpdate>();

      for (const event of events) {
        const sendLog = resolveSendLog(event, logsById, logsBySgId);
        if (!sendLog) {
          continue;
        }
        const eventType = event.event || 'unknown';
        eventRecords.push({
          sendLogId: sendLog.id as string,
          eventType,
          eventAt: toEventDate(event.timestamp),
          payload: event,
        });
        stored += 1;

        const nextStatus = normalizeSendLogStatus(eventType);
        if (!nextStatus) continue;
        const currentStatus =
          pendingUpdates.get(sendLog.id as string)?.status ??
          (sendLog.status as string);
        if (shouldUpdateStatus(currentStatus, nextStatus)) {
          const nextUpdate: PendingStatusUpdate = {
            status: nextStatus,
            eventType,
            error: FAILURE_EVENTS.has(eventType)
              ? `sendgrid_${eventType}`
              : undefined,
            providerMessageId:
              sendLog.providerMessageId ?? event.sg_message_id ?? undefined,
            originalStatus: sendLog.status as string,
            kind: sendLog.kind,
            targetTable: sendLog.targetTable,
            targetId: sendLog.targetId,
            channel: sendLog.channel,
          };
          pendingUpdates.set(sendLog.id as string, nextUpdate);
          if (shouldAuditProviderEvent(eventType)) {
            const currentAuditedStatus =
              pendingAudits.get(sendLog.id as string)?.status ??
              (sendLog.status as string);
            if (shouldUpdateStatus(currentAuditedStatus, nextStatus)) {
              pendingAudits.set(sendLog.id as string, nextUpdate);
            }
          }
        }
      }

      const appliedAudits: Array<{
        sendLogId: string;
        update: PendingStatusUpdate;
      }> = [];
      if (eventRecords.length > 0 || pendingUpdates.size > 0) {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          for (const eventRecord of eventRecords) {
            await tx.documentSendEvent.create({
              data: {
                sendLogId: eventRecord.sendLogId,
                provider: 'sendgrid',
                eventType: eventRecord.eventType,
                eventAt: eventRecord.eventAt,
                payload: eventRecord.payload,
              },
            });
          }
          for (const [sendLogId, update] of pendingUpdates.entries()) {
            const original = logsById.get(sendLogId);
            const originalStatus =
              original && typeof original.status === 'string'
                ? original.status
                : undefined;
            const result = await tx.documentSendLog.updateMany({
              where: {
                id: sendLogId,
                ...(originalStatus ? { status: originalStatus } : {}),
              },
              data: {
                status: update.status,
                error: update.error ?? (original?.error as string | undefined),
              },
            });
            if (
              result.count > 0 &&
              pendingAudits.has(sendLogId) &&
              shouldUpdateStatus(update.originalStatus, update.status)
            ) {
              appliedAudits.push({
                sendLogId,
                update: pendingAudits.get(sendLogId) as PendingStatusUpdate,
              });
            }
          }
        });
      }
      for (const { sendLogId, update } of appliedAudits) {
        await logAudit({
          ...auditContextFromRequest(req, { source: 'webhook' }),
          action: 'document_send_provider_status_updated',
          targetTable: update.targetTable,
          targetId: update.targetId,
          metadata: buildProviderAuditMetadata(update, sendLogId),
        });
      }
      return { received: events.length, stored };
    },
  );
}
