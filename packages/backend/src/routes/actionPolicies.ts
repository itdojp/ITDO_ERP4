import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { FlowTypeValue, type FlowType } from '../types.js';
import {
  actionPolicyEvaluateSchema,
  actionPolicyPatchSchema,
  actionPolicySchema,
} from './validators.js';
import { requireUserContext } from '../services/authContext.js';
import { evaluateActionPolicy } from '../services/actionPolicy.js';

type ActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
};

type ActionPolicyInput = {
  flowType: FlowType;
  actionKey: string;
  priority?: number;
  isEnabled?: boolean;
  subjects?: unknown;
  stateConstraints?: unknown;
  requireReason?: boolean;
  guards?: unknown;
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function parseFlowType(value: string): FlowType | null {
  if (!value) return null;
  if (Object.prototype.hasOwnProperty.call(FlowTypeValue, value)) {
    return value as FlowType;
  }
  return null;
}

function actionPolicySnapshotForAudit(policy: any) {
  const toIso = (value: unknown) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  return {
    id: policy?.id,
    flowType: policy?.flowType,
    actionKey: policy?.actionKey,
    priority: policy?.priority,
    isEnabled: policy?.isEnabled,
    subjects: policy?.subjects ?? null,
    stateConstraints: policy?.stateConstraints ?? null,
    requireReason: policy?.requireReason,
    guards: policy?.guards ?? null,
    createdAt: toIso(policy?.createdAt),
    createdBy: policy?.createdBy ?? null,
    updatedAt: toIso(policy?.updatedAt),
    updatedBy: policy?.updatedBy ?? null,
  };
}

export async function registerActionPolicyRoutes(app: FastifyInstance) {
  app.get(
    '/action-policies',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const query = (req.query || {}) as {
        flowType?: string;
        actionKey?: string;
        isEnabled?: string;
      };
      const flowTypeRaw = normalizeString(query.flowType);
      const flowType = flowTypeRaw ? parseFlowType(flowTypeRaw) : null;
      if (flowTypeRaw && !flowType) {
        return reply.status(400).send({ error: 'invalid_flowType' });
      }
      const actionKey = normalizeString(query.actionKey);
      const isEnabledRaw = normalizeString(query.isEnabled);
      const isEnabled =
        isEnabledRaw === 'true'
          ? true
          : isEnabledRaw === 'false'
            ? false
            : undefined;

      const items = await prisma.actionPolicy.findMany({
        where: {
          ...(flowType ? { flowType } : {}),
          ...(actionKey ? { actionKey } : {}),
          ...(isEnabled !== undefined ? { isEnabled } : {}),
        },
        orderBy: [
          { flowType: 'asc' },
          { actionKey: 'asc' },
          { priority: 'desc' },
        ],
      });
      return { items };
    },
  );

  app.post(
    '/action-policies',
    { preHandler: requireRole(['admin', 'mgmt']), schema: actionPolicySchema },
    async (req, reply) => {
      const { userId } = requireUserContext(req);
      const body = req.body as ActionPolicyInput;
      const actionKey = normalizeString(body.actionKey);
      if (!actionKey) {
        return reply.status(400).send({ error: 'actionKey_required' });
      }
      const created = await prisma.actionPolicy.create({
        data: {
          ...(body as any),
          actionKey,
          createdBy: userId ?? undefined,
          updatedBy: userId ?? undefined,
        },
      });
      await logAudit({
        action: 'action_policy_created',
        targetTable: 'action_policies',
        targetId: created.id,
        metadata: {
          flowType: created.flowType,
          actionKey: created.actionKey,
          after: actionPolicySnapshotForAudit(created),
        },
        ...auditContextFromRequest(req),
      });
      return created;
    },
  );

  app.patch(
    '/action-policies/:id',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: actionPolicyPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { userId } = requireUserContext(req);
      const body = (req.body || {}) as Partial<ActionPolicyInput>;
      const hasActionKey = Object.prototype.hasOwnProperty.call(
        body,
        'actionKey',
      );
      const actionKey = hasActionKey
        ? normalizeString(body.actionKey)
        : undefined;
      if (hasActionKey && !actionKey) {
        return reply.status(400).send({ error: 'actionKey_required' });
      }
      const data = {
        ...(body as any),
        ...(actionKey !== undefined ? { actionKey } : {}),
        updatedBy: userId ?? undefined,
      };

      const { before, updated } = await prisma.$transaction(async (tx) => {
        const before = await tx.actionPolicy.findUnique({ where: { id } });
        const updated = await tx.actionPolicy.update({
          where: { id },
          data,
        });
        return { before, updated };
      });
      await logAudit({
        action: 'action_policy_updated',
        targetTable: 'action_policies',
        targetId: updated.id,
        metadata: {
          flowType: updated.flowType,
          actionKey: updated.actionKey,
          before: before ? actionPolicySnapshotForAudit(before) : null,
          after: actionPolicySnapshotForAudit(updated),
          patch: data,
        },
        ...auditContextFromRequest(req),
      });
      return updated;
    },
  );

  app.post(
    '/action-policies/evaluate',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: actionPolicyEvaluateSchema,
    },
    async (req, reply) => {
      const body = (req.body || {}) as {
        flowType?: FlowType;
        actionKey?: string;
        state?: unknown;
        targetTable?: string;
        targetId?: string;
        actor?: { userId?: string; roles?: unknown; groupIds?: unknown };
        reasonText?: string;
      };
      const flowType = body.flowType as FlowType;
      const actionKey = normalizeString(body.actionKey);
      if (!actionKey) {
        return reply.status(400).send({ error: 'actionKey_required' });
      }
      const reasonText = normalizeString(body.reasonText);

      const actor: ActorContext = {
        userId: normalizeString(body.actor?.userId) || null,
        roles: normalizeStringArray(body.actor?.roles),
        groupIds: normalizeStringArray(body.actor?.groupIds),
      };

      const result = await evaluateActionPolicy({
        flowType,
        actionKey,
        state: body.state,
        targetTable: normalizeString(body.targetTable) || undefined,
        targetId: normalizeString(body.targetId) || undefined,
        actor,
        reasonText,
      });
      return result;
    },
  );
}
