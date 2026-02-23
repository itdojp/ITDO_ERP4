import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../services/db.js';
import {
  decisionTypeFromErrorCode,
  extractAgentErrorCode,
  normalizeAgentErrorCode,
  shouldOpenDecisionRequest,
} from '../services/agentRuns.js';

type AgentRunRequestContext = {
  runId: string;
  stepId: string;
  statusCode?: number;
  errorCode?: string | null;
  decisionRequestId?: string;
};

type DecisionRequestMetadata = {
  requestId: string;
  routePath: string;
  method: string;
  statusCode: number;
  errorCode: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    agentRun?: AgentRunRequestContext;
  }
}

function isDelegatedAgentRequest(req: FastifyRequest) {
  return req.user?.auth?.delegated === true;
}

function normalizeScopes(scopes: string[] | undefined) {
  if (!Array.isArray(scopes)) return [];
  return scopes.map((scope) => scope.trim()).filter(Boolean);
}

function resolveRoutePath(req: FastifyRequest) {
  const routePath = (req.routeOptions as { url?: string } | undefined)?.url;
  if (typeof routePath === 'string' && routePath.trim()) {
    return routePath.trim();
  }
  const rawUrl = typeof req.url === 'string' ? req.url : '';
  const index = rawUrl.indexOf('?');
  return index >= 0 ? rawUrl.slice(0, index) : rawUrl;
}

function resolveTargetId(req: FastifyRequest) {
  const params = req.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null;
  }
  const raw = (params as Record<string, unknown>).id;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  return normalized || null;
}

function resolveTargetTableFromPath(pathname: string) {
  const normalized = pathname.trim().toLowerCase();
  if (normalized.startsWith('/invoices/')) return 'invoices';
  if (normalized.startsWith('/expenses/')) return 'expenses';
  if (normalized.startsWith('/purchase-orders/')) return 'purchase_orders';
  if (normalized.startsWith('/vendor-invoices/')) return 'vendor_invoices';
  if (normalized.startsWith('/estimates/')) return 'estimates';
  if (normalized.startsWith('/time-entries/')) return 'time_entries';
  if (normalized.startsWith('/leave/')) return 'leave_requests';
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toMetadataObject(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return { ...value };
  return {};
}

function shouldExtractErrorCode(payload: unknown) {
  if (typeof payload === 'string') return true;
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload)) return false;
  if (Buffer.isBuffer(payload)) return false;
  if (ArrayBuffer.isView(payload)) return false;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.pipe === 'function' || typeof raw.on === 'function') {
    return false;
  }
  return true;
}

function buildDecisionRequestMetadata(input: {
  requestId: string;
  routePath: string;
  method: string;
  statusCode: number;
  errorCode: string | null;
}): DecisionRequestMetadata {
  return {
    requestId: input.requestId,
    routePath: input.routePath,
    method: input.method,
    statusCode: input.statusCode,
    errorCode: input.errorCode,
  };
}

async function initializeAgentRun(req: FastifyRequest) {
  const auth = req.user?.auth;
  if (!auth || !isDelegatedAgentRequest(req) || req.agentRun) return;
  const method = req.method.toUpperCase();
  const path = resolveRoutePath(req);
  const startedAt = new Date();
  try {
    const { runId, stepId } = await prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.create({
        data: {
          requestId: req.id,
          source: 'agent',
          principalUserId: auth.principalUserId,
          actorUserId: auth.actorUserId,
          scopes: normalizeScopes(auth.scopes),
          method,
          path,
          status: 'running',
          startedAt,
          metadata: {
            routePath: path,
          },
        },
        select: { id: true },
      });
      const step = await tx.agentStep.create({
        data: {
          runId: run.id,
          stepOrder: 1,
          kind: 'api_request',
          name: `${method} ${path}`,
          status: 'running',
          startedAt,
          input: {
            requestId: req.id,
            method,
            path,
          },
        },
        select: { id: true },
      });
      return { runId: run.id, stepId: step.id };
    });
    req.agentRun = {
      runId,
      stepId,
    };
  } catch (err) {
    req.log.warn({ err }, 'agent run initialization failed');
  }
}

async function finalizeAgentRun(req: FastifyRequest) {
  const context = req.agentRun;
  if (!context) return;
  const finishedAt = new Date();
  const statusCode =
    typeof context.statusCode === 'number' ? context.statusCode : 500;
  const status = statusCode >= 400 ? 'failed' : 'completed';
  const normalizedError =
    normalizeAgentErrorCode(context.errorCode) ??
    (statusCode >= 400 ? `http_${statusCode}` : null);
  const routePath = resolveRoutePath(req);
  const targetId = resolveTargetId(req);
  const targetTable = resolveTargetTableFromPath(routePath);
  try {
    await prisma.$transaction(async (tx) => {
      const currentRun = await tx.agentRun.findUnique({
        where: { id: context.runId },
        select: { metadata: true },
      });
      await tx.agentStep.update({
        where: { id: context.stepId },
        data: {
          status,
          finishedAt,
          errorCode: normalizedError ?? undefined,
          output: {
            statusCode,
            errorCode: normalizedError,
          },
        },
      });
      let decisionRequestId: string | undefined;
      if (shouldOpenDecisionRequest(normalizedError)) {
        const decision = await tx.decisionRequest.create({
          data: {
            runId: context.runId,
            stepId: context.stepId,
            decisionType: decisionTypeFromErrorCode(normalizedError),
            status: 'open',
            title: normalizedError,
            reasonText: normalizedError,
            targetTable: targetTable ?? undefined,
            targetId: targetId ?? undefined,
            requestedBy: req.user?.auth?.actorUserId ?? req.user?.userId,
            requestedAt: finishedAt,
            metadata: buildDecisionRequestMetadata({
              requestId: req.id,
              routePath,
              method: req.method.toUpperCase(),
              statusCode,
              errorCode: normalizedError,
            }),
          },
          select: { id: true },
        });
        decisionRequestId = decision.id;
      }
      const mergedMetadata = {
        ...toMetadataObject(currentRun?.metadata),
        routePath,
        requestId: req.id,
        decisionRequestId: decisionRequestId ?? null,
      };
      await tx.agentRun.update({
        where: { id: context.runId },
        data: {
          status,
          finishedAt,
          httpStatus: statusCode,
          errorCode: normalizedError ?? undefined,
          metadata: mergedMetadata,
        },
      });
      if (decisionRequestId) {
        context.decisionRequestId = decisionRequestId;
      }
    });
  } catch (err) {
    req.log.warn({ err }, 'agent run finalize failed');
  }
}

export default fp(async (app) => {
  app.addHook('preHandler', async (req) => {
    await initializeAgentRun(req);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const context = req.agentRun;
    if (!context) return payload;
    context.statusCode = reply.statusCode;
    if (shouldExtractErrorCode(payload)) {
      context.errorCode = extractAgentErrorCode(payload);
    }
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const context = req.agentRun;
    if (!context) return;
    if (typeof context.statusCode !== 'number') {
      context.statusCode = reply.statusCode;
    }
    await finalizeAgentRun(req);
  });
});
