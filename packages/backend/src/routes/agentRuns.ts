import { FastifyInstance } from 'fastify';
import { createApiErrorResponse } from '../services/errors.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';

const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: true,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        category: { type: 'string' },
        details: {},
      },
    },
  },
} as const;

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const nullableIntegerSchema = {
  anyOf: [{ type: 'integer' }, { type: 'null' }],
} as const;

const nullableDateTimeSchema = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;

const decisionRequestSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'runId', 'decisionType', 'status'],
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    stepId: nullableStringSchema,
    decisionType: { type: 'string' },
    status: { type: 'string' },
    title: nullableStringSchema,
    reasonText: nullableStringSchema,
    targetTable: nullableStringSchema,
    targetId: nullableStringSchema,
    requestedBy: nullableStringSchema,
    requestedAt: { type: 'string', format: 'date-time' },
    resolvedBy: nullableStringSchema,
    resolvedAt: nullableDateTimeSchema,
    resolutionNote: nullableStringSchema,
    metadata: {},
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const agentStepSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'runId', 'stepOrder', 'kind', 'status', 'decisions'],
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    stepOrder: { type: 'integer' },
    kind: { type: 'string' },
    name: nullableStringSchema,
    status: { type: 'string' },
    errorCode: nullableStringSchema,
    input: {},
    output: {},
    metadata: {},
    startedAt: { type: 'string', format: 'date-time' },
    finishedAt: nullableDateTimeSchema,
    createdAt: { type: 'string', format: 'date-time' },
    decisions: {
      type: 'array',
      items: decisionRequestSchema,
    },
  },
} as const;

const agentRunResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'status', 'steps', 'decisionRequests'],
  properties: {
    id: { type: 'string' },
    requestId: nullableStringSchema,
    source: nullableStringSchema,
    principalUserId: nullableStringSchema,
    actorUserId: nullableStringSchema,
    scopes: {},
    method: nullableStringSchema,
    path: nullableStringSchema,
    status: { type: 'string' },
    httpStatus: nullableIntegerSchema,
    errorCode: nullableStringSchema,
    metadata: {},
    startedAt: { type: 'string', format: 'date-time' },
    finishedAt: nullableDateTimeSchema,
    createdAt: { type: 'string', format: 'date-time' },
    steps: {
      type: 'array',
      items: agentStepSchema,
    },
    decisionRequests: {
      type: 'array',
      items: decisionRequestSchema,
    },
  },
} as const;

export async function registerAgentRunRoutes(app: FastifyInstance) {
  app.get(
    '/agent-runs/:id',
    {
      preHandler: requireRole(['admin', 'mgmt', 'exec']),
      schema: {
        summary: 'Get AgentRun detail',
        tags: ['audit'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
        response: {
          200: agentRunResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const runId = String(id || '').trim();
      if (!runId) {
        return reply.status(400).send(
          createApiErrorResponse('INVALID_ID', 'id is required', {
            category: 'validation',
          }),
        );
      }

      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        include: {
          steps: {
            orderBy: [{ stepOrder: 'asc' }, { createdAt: 'asc' }],
            include: {
              decisions: {
                orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }],
              },
            },
          },
          decisionRequests: {
            where: { stepId: null },
            orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });

      if (!run) {
        return reply.status(404).send(
          createApiErrorResponse('NOT_FOUND', 'AgentRun not found', {
            category: 'not_found',
          }),
        );
      }

      await logAudit({
        ...auditContextFromRequest(req),
        action: 'agent_run_viewed',
        targetTable: 'agent_runs',
        targetId: run.id,
        metadata: {
          stepCount: run.steps.length,
          decisionCount: run.decisionRequests.length,
        },
      });

      return run;
    },
  );
}
