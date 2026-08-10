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

function normalizedStrings(value: unknown) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

export function knowledgeActorFromRequest(
  request: FastifyRequest,
  options: { includeChat?: boolean } = {},
): KnowledgeActor {
  const userId = knowledgeActorUserId(request);
  const orgId = request.user?.orgId;
  const groupAccountIds = request.user?.groupAccountIds;
  const chatUserId =
    typeof request.user?.userId === 'string' ? request.user.userId.trim() : '';
  return {
    userId,
    organizationId:
      typeof orgId === 'string' ? orgId.trim() || undefined : undefined,
    groupAccountIds: normalizedStrings(groupAccountIds),
    ...(options.includeChat === true && chatUserId
      ? {
          chat: {
            userId: chatUserId,
            roles: normalizedStrings(request.user?.roles),
            projectIds: normalizedStrings(request.user?.projectIds),
            groupIds: normalizedStrings(request.user?.groupIds),
            groupAccountIds: normalizedStrings(request.user?.groupAccountIds),
          },
        }
      : {}),
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
    ...(context.principalUserId !== undefined
      ? { principalUserId: context.principalUserId }
      : {}),
    ...(context.actorUserId !== undefined
      ? { actorUserId: context.actorUserId }
      : {}),
    ...(context.authScopes !== undefined
      ? { authScopes: context.authScopes }
      : {}),
    ...(context.authTokenId !== undefined
      ? { authTokenId: context.authTokenId }
      : {}),
    ...(context.authAudience !== undefined
      ? { authAudience: context.authAudience }
      : {}),
    ...(context.authExpiresAt !== undefined
      ? { authExpiresAt: context.authExpiresAt }
      : {}),
    ...(context.agentRunId !== undefined
      ? { agentRunId: context.agentRunId }
      : {}),
    ...(context.decisionRequestId !== undefined
      ? { decisionRequestId: context.decisionRequestId }
      : {}),
  };
}
