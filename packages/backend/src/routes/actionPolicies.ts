import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  actionPolicyEvaluateSchema,
  actionPolicyPatchSchema,
  actionPolicySchema,
} from './validators.js';
import { requireUserContext } from '../services/authContext.js';

type ActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function matchesSubjects(subjects: unknown, actor: ActorContext): boolean {
  if (!subjects || typeof subjects !== 'object') return true;
  const obj = subjects as Record<string, unknown>;
  const roles = normalizeStringArray(obj.roles);
  const groupIds = normalizeStringArray(obj.groupIds);
  const userIds = normalizeStringArray(obj.userIds);
  const hasAny = roles.length || groupIds.length || userIds.length;
  if (!hasAny) return true;

  if (roles.length && roles.some((role) => actor.roles.includes(role)))
    return true;
  if (
    groupIds.length &&
    groupIds.some((groupId) => actor.groupIds.includes(groupId))
  )
    return true;
  if (userIds.length && actor.userId && userIds.includes(actor.userId))
    return true;
  return false;
}

function matchesStateConstraints(stateConstraints: unknown, state: unknown) {
  if (!stateConstraints || typeof stateConstraints !== 'object') return true;
  if (!state || typeof state !== 'object') return true;
  const constraints = stateConstraints as Record<string, unknown>;
  const current = state as Record<string, unknown>;
  const status = normalizeString(current.status);

  const statusIn = normalizeStringArray(constraints.statusIn);
  if (statusIn.length && !statusIn.includes(status)) return false;
  const statusNotIn = normalizeStringArray(constraints.statusNotIn);
  if (statusNotIn.length && statusNotIn.includes(status)) return false;
  return true;
}

export async function registerActionPolicyRoutes(app: FastifyInstance) {
  app.get(
    '/action-policies',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const query = (req.query || {}) as {
        flowType?: string;
        actionKey?: string;
        isEnabled?: string;
      };
      const flowType = normalizeString(query.flowType);
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
          ...(flowType ? { flowType: flowType as any } : {}),
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
    async (req) => {
      const { userId } = requireUserContext(req);
      const created = await prisma.actionPolicy.create({
        data: {
          ...(req.body as any),
          createdBy: userId ?? undefined,
          updatedBy: userId ?? undefined,
        },
      });
      await logAudit({
        action: 'action_policy_created',
        targetTable: 'action_policies',
        targetId: created.id,
        metadata: { flowType: created.flowType, actionKey: created.actionKey },
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
    async (req) => {
      const { id } = req.params as { id: string };
      const { userId } = requireUserContext(req);
      const updated = await prisma.actionPolicy.update({
        where: { id },
        data: {
          ...(req.body as any),
          updatedBy: userId ?? undefined,
        },
      });
      await logAudit({
        action: 'action_policy_updated',
        targetTable: 'action_policies',
        targetId: updated.id,
        metadata: { flowType: updated.flowType, actionKey: updated.actionKey },
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
    async (req) => {
      const body = (req.body || {}) as {
        flowType?: string;
        actionKey?: string;
        state?: unknown;
        actor?: { userId?: string; roles?: unknown; groupIds?: unknown };
        reasonText?: string;
      };
      const flowType = normalizeString(body.flowType);
      const actionKey = normalizeString(body.actionKey);
      const reasonText = normalizeString(body.reasonText);

      const actor: ActorContext = {
        userId: normalizeString(body.actor?.userId) || null,
        roles: normalizeStringArray(body.actor?.roles),
        groupIds: normalizeStringArray(body.actor?.groupIds),
      };

      const items = await prisma.actionPolicy.findMany({
        where: { flowType: flowType as any, actionKey, isEnabled: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      });

      const matched = items.find((policy) => {
        if (!matchesStateConstraints(policy.stateConstraints, body.state))
          return false;
        if (!matchesSubjects(policy.subjects, actor)) return false;
        return true;
      });

      if (!matched) {
        return { allowed: false, reason: 'no_matching_policy' };
      }
      if (matched.requireReason && !reasonText) {
        return {
          allowed: false,
          reason: 'reason_required',
          matchedPolicyId: matched.id,
        };
      }
      return {
        allowed: true,
        matchedPolicyId: matched.id,
        requireReason: matched.requireReason,
      };
    },
  );
}
