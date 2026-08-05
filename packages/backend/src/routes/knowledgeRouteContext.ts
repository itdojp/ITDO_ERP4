import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from '../application/knowledge/knowledgeItemPorts.js';
import { auditContextFromRequest } from '../services/audit.js';
import { createApiErrorResponse } from '../services/errors.js';

function knowledgeActorUserId(request: FastifyRequest) {
  const auth = request.user?.auth;
  const hasCanonicalIdentity =
    typeof auth?.identityId === 'string' && auth.identityId.trim().length > 0;
  const candidate =
    auth?.providerType === 'header'
      ? request.user?.userId
      : hasCanonicalIdentity
        ? auth?.userAccountId
        : undefined;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

export function knowledgeActorFromRequest(
  request: FastifyRequest,
): KnowledgeActor {
  const userId = knowledgeActorUserId(request);
  const orgId = request.user?.orgId;
  const groupAccountIds = request.user?.groupAccountIds;
  return {
    userId,
    organizationId:
      typeof orgId === 'string' ? orgId.trim() || undefined : undefined,
    groupAccountIds: [
      ...new Set(
        (Array.isArray(groupAccountIds) ? groupAccountIds : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
  };
}

export async function requireCanonicalKnowledgeActor(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (knowledgeActorUserId(request)) return;
  return reply.code(403).send(
    createApiErrorResponse('forbidden', 'Forbidden', {
      category: 'permission',
      details: { reason: 'canonical_account_required' },
    }),
  );
}

export function knowledgeAuditActorFromRequest(
  request: FastifyRequest,
): KnowledgeAuditActorContext {
  const context = auditContextFromRequest(request);
  return {
    requestId: context.requestId,
    source: context.source,
  };
}
