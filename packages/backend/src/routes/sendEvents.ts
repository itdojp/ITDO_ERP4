import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';

type SendGridEvent = {
  event?: string;
  sg_message_id?: string;
  timestamp?: number;
  custom_args?: Record<string, string>;
};

const FAILURE_EVENTS = new Set(['bounce', 'dropped', 'spamreport']);
const FAILURE_STATUSES = new Set(['bounced', 'dropped', 'spamreport']);

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
  if (FAILURE_STATUSES.has(current)) {
    return FAILURE_STATUSES.has(next);
  }
  if (FAILURE_STATUSES.has(next)) return true;
  return current !== next;
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

export async function registerSendEventRoutes(app: FastifyInstance) {
  app.post('/webhooks/sendgrid/events', async (req, reply) => {
    if (!passesWebhookKey(req.headers as Record<string, unknown>)) {
      return reply.code(401).send({ error: 'unauthorized' });
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

    let stored = 0;
    for (const event of events) {
      const sendLogId = resolveSendLogId(event);
      let sendLog = sendLogId
        ? await prisma.documentSendLog.findUnique({
            where: { id: sendLogId },
          })
        : null;
      if (!sendLog && event.sg_message_id) {
        sendLog = await prisma.documentSendLog.findFirst({
          where: { providerMessageId: { contains: event.sg_message_id } },
        });
      }
      if (!sendLog) {
        continue;
      }

      const eventType = event.event || 'unknown';
      await prisma.documentSendEvent.create({
        data: {
          sendLogId: sendLog.id,
          provider: 'sendgrid',
          eventType,
          eventAt: toEventDate(event.timestamp),
          payload: event,
        },
      });
      stored += 1;

      const nextStatus = normalizeSendLogStatus(eventType);
      if (nextStatus && shouldUpdateStatus(sendLog.status, nextStatus)) {
        await prisma.documentSendLog.update({
          where: { id: sendLog.id },
          data: {
            status: nextStatus,
            error: FAILURE_EVENTS.has(eventType)
              ? `sendgrid_${eventType}`
              : sendLog.error,
          },
        });
      }
    }

    return { received: events.length, stored };
  });
}
