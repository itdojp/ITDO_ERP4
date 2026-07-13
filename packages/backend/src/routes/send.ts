import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  retryDocumentSend,
  sendEstimateDocument,
  sendInvoiceDocument,
  sendPurchaseOrderDocument,
  type SendActorContext,
  type SendApplicationFailure,
} from '../application/send/useCases.js';
import { auditContextFromRequest } from '../services/audit.js';
import { prisma } from '../services/db.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';
import { requireRole } from '../services/rbac.js';

function resolveEvidenceRequiredActionsOverride(req: FastifyRequest) {
  if (process.env.E2E_ENABLE_TEST_HOOKS !== '1') return undefined;
  const raw = req.headers['x-e2e-approval-evidence-required-actions'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const joined = raw.join(',').trim();
    return joined || undefined;
  }
  return undefined;
}

function actorFromRequest(req: FastifyRequest): SendActorContext {
  return {
    userId: req.user?.userId ?? null,
    roles: req.user?.roles || [],
    groupIds: req.user?.groupIds || [],
    groupAccountIds: req.user?.groupAccountIds || [],
  };
}

function sendApplicationFailure(
  reply: FastifyReply,
  failure: SendApplicationFailure,
) {
  return reply.status(failure.statusCode).send(failure.body);
}

function sendInputFromRequest(req: FastifyRequest) {
  const { id } = req.params as { id: string };
  const {
    templateId,
    templateSettingId,
    reasonText: reasonTextRaw,
  } = req.query as {
    templateId?: string;
    templateSettingId?: string;
    reasonText?: string;
  };
  return {
    id,
    templateId,
    templateSettingId,
    reasonText: reasonTextRaw,
    evidenceRequiredActionsOverride:
      resolveEvidenceRequiredActionsOverride(req),
    actor: actorFromRequest(req),
    auditContext: auditContextFromRequest(req),
  };
}

export async function registerSendRoutes(app: FastifyInstance) {
  const sendRouteRateLimit = getRouteRateLimitOptions('RATE_LIMIT_DOC_SEND', {
    max: 20,
    timeWindow: '1 minute',
  });
  const sendRetryRateLimit = getRouteRateLimitOptions(
    'RATE_LIMIT_DOC_SEND_RETRY',
    {
      max: 10,
      timeWindow: '1 minute',
    },
  );

  app.post(
    '/estimates/:id/send',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      config: { rateLimit: sendRouteRateLimit },
    },
    async (req, reply) => {
      const result = await sendEstimateDocument(sendInputFromRequest(req));
      if (!result.ok) return sendApplicationFailure(reply, result);
      return result.value;
    },
  );

  app.get(
    '/estimates/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const estimate = await prisma.estimate.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!estimate) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'estimates', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/invoices/:id/send',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      config: { rateLimit: sendRouteRateLimit },
    },
    async (req, reply) => {
      const result = await sendInvoiceDocument(sendInputFromRequest(req));
      if (!result.ok) return sendApplicationFailure(reply, result);
      return result.value;
    },
  );

  app.get(
    '/invoices/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!invoice) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'invoices', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/purchase-orders/:id/send',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      config: { rateLimit: sendRouteRateLimit },
    },
    async (req, reply) => {
      const result = await sendPurchaseOrderDocument(sendInputFromRequest(req));
      if (!result.ok) return sendApplicationFailure(reply, result);
      return result.value;
    },
  );

  app.get(
    '/purchase-orders/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!purchaseOrder) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'purchase_orders', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.get(
    '/document-send-logs/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = await prisma.documentSendLog.findUnique({ where: { id } });
      if (!item) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return item;
    },
  );

  app.get(
    '/document-send-logs/:id/events',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sendLog = await prisma.documentSendLog.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!sendLog) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendEvent.findMany({
        where: { sendLogId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/document-send-logs/:id/retry',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      config: { rateLimit: sendRetryRateLimit },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await retryDocumentSend({
        id,
        actor: actorFromRequest(req),
        auditContext: auditContextFromRequest(req),
      });
      if (!result.ok) return sendApplicationFailure(reply, result);
      return result.value;
    },
  );
}
