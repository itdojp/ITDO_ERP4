import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import type {
  KnowledgeThreadPromotionCommitRecord,
  KnowledgeThreadPromotionFailure,
  KnowledgeThreadPromotionPortResult,
  KnowledgeThreadPromotionRequest,
  KnowledgeThreadPromotionResolvedPreview,
  KnowledgeThreadPromotionSelectedMessage,
  KnowledgeThreadPromotionShareCardPreview,
  KnowledgeThreadPromotionStorePort,
} from '../../application/knowledge/knowledgeThreadPromotionPorts.js';
import { knowledgeProvenanceAuditActor } from '../../application/knowledge/knowledgeProvenanceValidation.js';
import {
  chatRoomProjectId,
  ensureChatRoomContentAccess,
  hasActiveChatProject,
} from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';
import { safeCanonicalUrl } from './knowledgeShareSanitizers.js';
import { PrismaKnowledgeProvenanceAuditWriter } from './prismaKnowledgeProvenanceAuditAdapter.js';
import { PrismaKnowledgeThreadPromotionAuditWriter } from './prismaKnowledgeThreadPromotionAuditAdapter.js';

const serializableAttempts = 3;
const hashPattern = /^[0-9a-f]{64}$/;

type PromotionHost = Pick<PrismaClient, '$transaction'>;

const shareInclude = Prisma.validator<Prisma.KnowledgeShareInclude>()({
  destinationRoom: true,
  chatMessage: true,
  snapshot: true,
  labels: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  annotations: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  turns: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  syntheses: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
});

type ShareRow = Prisma.KnowledgeShareGetPayload<{
  include: typeof shareInclude;
}>;

type InternalSelectedMessage = KnowledgeThreadPromotionSelectedMessage & {
  sourceActivitySequence: bigint;
};

type InternalResolved = KnowledgeThreadPromotionResolvedPreview & {
  sourceShareId: string;
  sourceRoomId: string;
  selectedMessages: InternalSelectedMessage[];
  contentHash: string;
  selectionHash: string;
};

type ResolveResult =
  | { ok: true; value: InternalResolved }
  | { ok: false; error: KnowledgeThreadPromotionFailure };

function success<T>(value: T): KnowledgeThreadPromotionPortResult<T> {
  return { ok: true, value };
}

function failure(
  status: number,
  code: KnowledgeThreadPromotionFailure['code'],
): KnowledgeThreadPromotionPortResult<never> {
  const messages: Record<KnowledgeThreadPromotionFailure['code'], string> = {
    invalid_request: 'Invalid request',
    not_found: 'Not found',
    stale_preview: 'Preview is stale',
    preview_token_invalid: 'Invalid preview token',
    preview_token_expired: 'Preview token expired',
    idempotency_conflict: 'Idempotency conflict',
    organization_confirmation_required: 'Organization confirmation is required',
    promotion_conflict: 'Promotion conflict',
  };
  return { ok: false, error: { status, code, message: messages[code] } };
}

function sha256(domain: string, value: string) {
  return createHash('sha256')
    .update(`erp4:knowledge:thread-promotion:${domain}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function strictQuestions(value: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('knowledge_thread_promotion_questions_invalid');
  }
  return value.map((entry) => entry as string);
}

function selectedCategories(share: ShareRow) {
  const result: string[] = [];
  if (share.selectedTitle !== null) result.push('title');
  if (share.selectedSourceType !== null) result.push('source_type');
  if (share.selectedCanonicalUrl !== null) result.push('canonical_url');
  if (share.snapshot?.provenanceSelected) result.push('snapshot_provenance');
  if (share.snapshot?.excerptSelected) result.push('snapshot_excerpt');
  if (share.labels.length > 0) result.push('label');
  if (share.annotations.length > 0) result.push('annotation');
  if (share.turns.length > 0) result.push('conversation_turn');
  if (share.syntheses.length > 0) result.push('synthesis');
  if (share.selectedSharerNote !== null) result.push('sharer_note');
  return result;
}

function publicShareCard(
  share: ShareRow,
): KnowledgeThreadPromotionShareCardPreview | null {
  const canonicalUrl =
    share.selectedCanonicalUrl === null
      ? undefined
      : safeCanonicalUrl(share.selectedCanonicalUrl);
  if (share.selectedCanonicalUrl !== null && !canonicalUrl) return null;
  return {
    schemaVersion: 1,
    shareVersion: share.version,
    ...(share.selectedTitle === null ? {} : { title: share.selectedTitle }),
    ...(share.selectedSourceType === null
      ? {}
      : { sourceType: share.selectedSourceType }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(share.snapshot
      ? {
          snapshot: {
            version: share.snapshot.sourceSnapshotVersion,
            sha256: share.snapshot.sourceSha256,
            ...(share.snapshot.excerpt === null
              ? {}
              : { excerpt: share.snapshot.excerpt }),
          },
        }
      : {}),
    ...(share.selectedSharerNote === null
      ? {}
      : { sharerNote: share.selectedSharerNote }),
    labels: share.labels.map((entry) => ({
      displayName: entry.displayName,
      ordinal: entry.ordinal,
    })),
    annotations: share.annotations.map((entry) => ({
      revision: entry.revision,
      kind: entry.kind,
      origin: entry.origin,
      content: entry.content,
      ordinal: entry.ordinal,
    })),
    turns: share.turns.map((entry) => ({
      role: entry.role,
      origin: entry.origin,
      content: entry.content,
      name: entry.name,
      occurredAt: entry.occurredAt,
      ordinal: entry.ordinal,
    })),
    syntheses: share.syntheses.map((entry) => ({
      version: entry.version,
      title: entry.title,
      content: entry.content,
      confidenceBasisPoints: entry.confidenceBasisPoints,
      unresolvedQuestions: strictQuestions(entry.unresolvedQuestions),
      ordinal: entry.ordinal,
    })),
    selectedCategories: selectedCategories(share),
  };
}

function publicResolved(value: InternalResolved) {
  return {
    promotionId: value.promotionId,
    rootMessageId: value.rootMessageId,
    sourceRoomName: value.sourceRoomName,
    sourceRoomType: value.sourceRoomType,
    sourceShareVersion: value.sourceShareVersion,
    sourceShareContentHash: value.sourceShareContentHash,
    threadReplyCount: value.threadReplyCount,
    selectedMessages: value.selectedMessages.map((message) => ({
      sourceMessageId: message.sourceMessageId,
      sourceActivitySequence: message.sourceActivitySequence,
      ordinal: message.ordinal,
      content: message.content,
      contentHash: message.contentHash,
      createdAt: message.createdAt,
      authorCategory: message.authorCategory,
    })),
    selectedShareCard: value.selectedShareCard,
    destination: value.destination,
    bindingHash: value.bindingHash,
  } satisfies KnowledgeThreadPromotionResolvedPreview;
}

function auditMetadata(
  request: KnowledgeThreadPromotionRequest,
  resultCode: 'previewed' | 'created' | 'reused' | 'rejected' | 'conflict',
  duplicate = false,
) {
  return {
    schemaVersion: 1 as const,
    resultCode,
    scope: request.destination.scope,
    selectedMessageCount: request.selectedReplyMessageIds.length,
    includesSharedCard: request.includeSharedCard,
    organizationGrantCount:
      request.destination.organizationGroupAccountIds.length,
    duplicate,
  };
}

async function writePromotionAudit(
  transaction: Prisma.TransactionClient,
  input: {
    actor: KnowledgeActor;
    auditActor: Parameters<typeof knowledgeProvenanceAuditActor>[1];
    promotionId: string;
    request: KnowledgeThreadPromotionRequest;
    action:
      | 'knowledge_thread_promote_previewed'
      | 'knowledge_thread_promoted'
      | 'knowledge_thread_promote_duplicate_detected'
      | 'knowledge_thread_promote_rejected';
    resultCode: 'previewed' | 'created' | 'reused' | 'rejected' | 'conflict';
    duplicate?: boolean;
  },
) {
  await new PrismaKnowledgeThreadPromotionAuditWriter(transaction).write({
    action: input.action,
    actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
    targetTable: 'knowledge_thread_promotions',
    targetId: input.promotionId,
    metadata: auditMetadata(
      input.request,
      input.resultCode,
      input.duplicate ?? false,
    ),
  });
}

async function resolveMaterial(
  transaction: Prisma.TransactionClient,
  input: {
    actor: KnowledgeActor;
    rootMessageId: string;
    promotionId: string;
    request: KnowledgeThreadPromotionRequest;
  },
  lock: boolean,
): Promise<ResolveResult> {
  const chat = input.actor.chat;
  if (!chat?.userId) return failure(404, 'not_found');

  const share = await transaction.knowledgeShare.findFirst({
    where: {
      status: 'posted',
      chatMessageId: input.rootMessageId,
      chatMessage: {
        is: {
          id: input.rootMessageId,
          parentMessageId: null,
          threadRootId: null,
          deletedAt: null,
        },
      },
    },
    include: shareInclude,
  });
  if (
    !share ||
    !share.chatMessage ||
    share.chatMessageId !== input.rootMessageId ||
    share.destinationRoomId !== share.chatMessage.roomId ||
    share.destinationRoom.allowExternalUsers
  ) {
    return failure(404, 'not_found');
  }

  const roomAccess = await ensureChatRoomContentAccess({
    roomId: share.destinationRoomId,
    userId: chat.userId,
    roles: chat.roles,
    projectIds: chat.projectIds,
    groupIds: chat.groupIds,
    groupAccountIds: chat.groupAccountIds,
    accessLevel: 'read',
    client: transaction as unknown as typeof prisma,
  });
  if (
    !roomAccess.ok ||
    !(await hasActiveChatProject({
      room: roomAccess.room,
      client: transaction as unknown as typeof prisma,
    }))
  ) {
    return failure(404, 'not_found');
  }

  if (lock) {
    await transaction.$queryRaw(Prisma.sql`
      SELECT message."id"
      FROM "ChatMessage" AS message
      WHERE message."id" = ${input.rootMessageId}
        AND message."roomId" = ${share.destinationRoomId}
      FOR SHARE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT room."id"
      FROM "ChatRoom" AS room
      WHERE room."id" = ${share.destinationRoomId}
        AND room."deletedAt" IS NULL
      FOR SHARE
    `);
    const projectId = chatRoomProjectId(roomAccess.room);
    if (projectId) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT project."id"
        FROM "Project" AS project
        WHERE project."id" = ${projectId}
          AND project."deletedAt" IS NULL
        FOR SHARE
      `);
    }
    await transaction.$queryRaw(Prisma.sql`
      SELECT share."id"
      FROM "KnowledgeShare" AS share
      WHERE share."id" = ${share.id}
      FOR SHARE
    `);
    const selectedIds = [...input.request.selectedReplyMessageIds].sort();
    await transaction.$queryRaw(Prisma.sql`
      SELECT message."id"
      FROM "ChatMessage" AS message
      WHERE message."id" IN (${Prisma.join(selectedIds)})
      ORDER BY message."id"
      FOR SHARE
    `);
    const grantIds = [
      ...input.request.destination.organizationGroupAccountIds,
    ].sort();
    if (grantIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT account."id"
        FROM "GroupAccount" AS account
        WHERE account."id" IN (${Prisma.join(grantIds)})
        ORDER BY account."id"
        FOR SHARE
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT membership."id"
        FROM "UserGroup" AS membership
        WHERE membership."userId" = ${input.actor.userId}
          AND membership."groupId" IN (${Prisma.join(grantIds)})
        ORDER BY membership."groupId", membership."id"
        FOR SHARE
      `);
    }
    return resolveMaterial(transaction, input, false);
  }

  if (input.request.destination.scope === 'organization') {
    const organizationId = input.actor.organizationId?.trim();
    const groupIds = input.request.destination.organizationGroupAccountIds;
    if (!organizationId || groupIds.length === 0) {
      return failure(400, 'organization_confirmation_required');
    }
    const activeCount = await transaction.groupAccount.count({
      where: {
        id: { in: groupIds },
        active: true,
        memberships: {
          some: {
            userId: input.actor.userId,
            user: {
              active: true,
              deletedAt: null,
              organization: organizationId,
            },
          },
        },
      },
    });
    if (activeCount !== groupIds.length) {
      return failure(404, 'not_found');
    }
  }

  const rows = await transaction.chatMessage.findMany({
    where: {
      id: { in: input.request.selectedReplyMessageIds },
      roomId: share.destinationRoomId,
      parentMessageId: input.rootMessageId,
      threadRootId: input.rootMessageId,
      messageType: 'text',
      deletedAt: null,
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      activitySequence: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== input.request.selectedReplyMessageIds.length) {
    return failure(404, 'not_found');
  }
  const selectedMessages: InternalSelectedMessage[] = [];
  for (const [
    ordinal,
    messageId,
  ] of input.request.selectedReplyMessageIds.entries()) {
    const row = byId.get(messageId);
    if (!row) return failure(404, 'not_found');
    selectedMessages.push({
      sourceMessageId: row.id,
      ordinal,
      content: row.body,
      contentHash: sha256(
        'selected-message',
        JSON.stringify({
          body: row.body,
          createdAt: row.createdAt.toISOString(),
          activitySequence: row.activitySequence.toString(),
        }),
      ),
      createdAt: row.createdAt,
      // Knowledge shares cannot be posted to external-enabled rooms. The
      // persisted category therefore remains an allowlisted, non-identifying
      // internal user category rather than copying an author identity.
      authorCategory: 'user',
      sourceActivitySequence: row.activitySequence,
    });
  }
  const threadReplyCount = await transaction.chatMessage.count({
    where: {
      roomId: share.destinationRoomId,
      parentMessageId: input.rootMessageId,
      threadRootId: input.rootMessageId,
      deletedAt: null,
    },
  });
  const selectedShareCard = input.request.includeSharedCard
    ? publicShareCard(share)
    : null;
  if (input.request.includeSharedCard && !selectedShareCard) {
    return failure(404, 'not_found');
  }
  const destination = input.request.destination;
  const canonical = {
    promotionId: input.promotionId,
    sourceShareId: share.id,
    sourceShareVersion: share.version,
    sourceShareContentHash: share.contentHash,
    sourceRoomId: share.destinationRoomId,
    rootMessageId: input.rootMessageId,
    selectedMessages: selectedMessages.map((message) => ({
      sourceMessageId: message.sourceMessageId,
      ordinal: message.ordinal,
      contentHash: message.contentHash,
      sourceActivitySequence: message.sourceActivitySequence.toString(),
    })),
    includeSharedCard: input.request.includeSharedCard,
    destination,
    synthesis: input.request.synthesis,
  };
  const selectionHash = sha256(
    'selection',
    JSON.stringify({
      selectedMessages: canonical.selectedMessages,
      includeSharedCard: canonical.includeSharedCard,
    }),
  );
  const contentHash = sha256('content', JSON.stringify(canonical));
  const bindingHash = sha256(
    'preview-binding',
    JSON.stringify({
      ...canonical,
      selectionHash,
      contentHash,
    }),
  );
  return success({
    promotionId: input.promotionId,
    sourceShareId: share.id,
    sourceRoomId: share.destinationRoomId,
    rootMessageId: input.rootMessageId,
    sourceRoomName: share.destinationRoom.name,
    sourceRoomType: share.destinationRoom.type,
    sourceShareVersion: share.version,
    sourceShareContentHash: share.contentHash,
    threadReplyCount,
    selectedMessages,
    selectedShareCard,
    destination,
    bindingHash,
    contentHash,
    selectionHash,
  });
}

function commitRecord(
  row: {
    id: string;
    destinationSynthesisId: string;
    destinationSynthesisVersionId: string;
    destinationSynthesisVersionNumber: number;
    scope: 'personal' | 'organization';
    selectedMessageCount: number;
    includesSharedCard: boolean;
    createdAt: Date;
  },
  created: boolean,
): KnowledgeThreadPromotionCommitRecord {
  if (row.destinationSynthesisVersionNumber !== 1) {
    throw new Error('knowledge_thread_promotion_version_invalid');
  }
  return {
    promotionId: row.id,
    synthesisId: row.destinationSynthesisId,
    synthesisVersionId: row.destinationSynthesisVersionId,
    synthesisVersion: 1,
    scope: row.scope,
    selectedMessageCount: row.selectedMessageCount,
    includesSharedCard: row.includesSharedCard,
    createdAt: row.createdAt,
    created,
  };
}

function retryable(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'P2034' || error.code === 'P2002';
}

export class PrismaKnowledgeThreadPromotionAdapter implements KnowledgeThreadPromotionStorePort {
  constructor(private readonly host: PromotionHost = prisma as PrismaClient) {}

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 1; attempt <= serializableAttempts; attempt += 1) {
      try {
        return await this.host.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!retryable(error) || attempt === serializableAttempts) throw error;
      }
    }
    throw new Error('knowledge_thread_promotion_retry_exhausted');
  }

  async preview(
    input: Parameters<KnowledgeThreadPromotionStorePort['preview']>[0],
  ) {
    return this.host.$transaction(
      async (transaction) => {
        const resolved = await resolveMaterial(transaction, input, false);
        if (!resolved.ok) {
          await writePromotionAudit(transaction, {
            ...input,
            action: 'knowledge_thread_promote_rejected',
            resultCode: 'rejected',
          });
          return resolved;
        }
        await writePromotionAudit(transaction, {
          ...input,
          action: 'knowledge_thread_promote_previewed',
          resultCode: 'previewed',
        });
        return success(publicResolved(resolved.value));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async resolveForCommit(
    input: Parameters<KnowledgeThreadPromotionStorePort['resolveForCommit']>[0],
  ) {
    return this.host.$transaction(
      async (transaction) => {
        const resolved = await resolveMaterial(transaction, input, false);
        return resolved.ok ? success(publicResolved(resolved.value)) : resolved;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findIdempotent(
    input: Parameters<KnowledgeThreadPromotionStorePort['findIdempotent']>[0],
  ) {
    if (
      !hashPattern.test(input.requestKeyHash) ||
      !hashPattern.test(input.requestPayloadHash)
    ) {
      return failure(400, 'invalid_request');
    }
    return this.host.$transaction(async (transaction) => {
      const ledger =
        await transaction.knowledgeThreadPromotionRequest.findUnique({
          where: {
            promoterUserId_requestKeyHash: {
              promoterUserId: input.actor.userId,
              requestKeyHash: input.requestKeyHash,
            },
          },
          include: { promotion: true },
        });
      if (!ledger) return success(null);
      const request = {
        selectedReplyMessageIds: Array.from(
          { length: ledger.promotion.selectedMessageCount },
          () => '__redacted__',
        ),
        includeSharedCard: ledger.promotion.includesSharedCard,
        destination:
          ledger.promotion.scope === 'personal'
            ? { scope: 'personal' as const, organizationGroupAccountIds: [] }
            : {
                scope: 'organization' as const,
                organizationGroupAccountIds: Array.from(
                  { length: ledger.promotion.destinationGrantCount },
                  () => '__redacted__',
                ),
              },
        synthesis: {
          title: '__redacted__',
          content: '__redacted__',
          confidenceBasisPoints: null,
          unresolvedQuestions: [],
        },
      } satisfies KnowledgeThreadPromotionRequest;
      const same = ledger.requestPayloadHash === input.requestPayloadHash;
      await writePromotionAudit(transaction, {
        actor: input.actor,
        auditActor: input.auditActor,
        promotionId: ledger.promotion.id,
        request,
        action: 'knowledge_thread_promote_duplicate_detected',
        resultCode: same ? 'reused' : 'conflict',
        duplicate: true,
      });
      return same
        ? success(commitRecord(ledger.promotion, false))
        : failure(409, 'idempotency_conflict');
    });
  }

  async commit(
    input: Parameters<KnowledgeThreadPromotionStorePort['commit']>[0],
  ) {
    if (
      !hashPattern.test(input.expectedBindingHash) ||
      !hashPattern.test(input.requestKeyHash) ||
      !hashPattern.test(input.requestPayloadHash)
    ) {
      return failure(400, 'invalid_request');
    }
    const synthesisId = randomUUID();
    const synthesisVersionId = randomUUID();
    return this.serializable(async (transaction) => {
      const existing =
        await transaction.knowledgeThreadPromotionRequest.findUnique({
          where: {
            promoterUserId_requestKeyHash: {
              promoterUserId: input.actor.userId,
              requestKeyHash: input.requestKeyHash,
            },
          },
          include: { promotion: true },
        });
      if (existing) {
        const same = existing.requestPayloadHash === input.requestPayloadHash;
        await writePromotionAudit(transaction, {
          ...input,
          promotionId: existing.promotion.id,
          action: 'knowledge_thread_promote_duplicate_detected',
          resultCode: same ? 'reused' : 'conflict',
          duplicate: true,
        });
        return same
          ? success(commitRecord(existing.promotion, false))
          : failure(409, 'idempotency_conflict');
      }
      const resolved = await resolveMaterial(transaction, input, true);
      if (!resolved.ok) {
        await writePromotionAudit(transaction, {
          ...input,
          action: 'knowledge_thread_promote_rejected',
          resultCode: 'rejected',
        });
        return resolved;
      }
      if (resolved.value.bindingHash !== input.expectedBindingHash) {
        await writePromotionAudit(transaction, {
          ...input,
          action: 'knowledge_thread_promote_rejected',
          resultCode: 'conflict',
        });
        return failure(409, 'stale_preview');
      }
      const organizationId =
        input.request.destination.scope === 'organization'
          ? (input.actor.organizationId ?? null)
          : null;
      await transaction.knowledgeSynthesis.create({
        data: {
          id: synthesisId,
          ownerUserId: input.actor.userId,
          scope: input.request.destination.scope,
          organizationId,
          title: input.request.synthesis.title,
          currentVersion: 1,
          createdBy: input.actor.userId,
          updatedBy: input.actor.userId,
          versions: {
            create: {
              id: synthesisVersionId,
              version: 1,
              content: input.request.synthesis.content,
              unresolvedQuestions: input.request.synthesis.unresolvedQuestions,
              confidenceBasisPoints:
                input.request.synthesis.confidenceBasisPoints,
              createdBy: input.actor.userId,
            },
          },
          groupGrants: {
            create: input.request.destination.organizationGroupAccountIds.map(
              (groupAccountId) => ({
                groupAccountId,
                createdBy: input.actor.userId,
                updatedBy: input.actor.userId,
              }),
            ),
          },
        },
      });
      const row = await transaction.knowledgeThreadPromotion.create({
        data: {
          id: input.promotionId,
          sourceShareId: resolved.value.sourceShareId,
          sourceShareVersion: resolved.value.sourceShareVersion,
          sourceShareContentHash: resolved.value.sourceShareContentHash,
          sourceRoomId: resolved.value.sourceRoomId,
          sourceRootMessageId: input.rootMessageId,
          promoterUserId: input.actor.userId,
          ownerUserId: input.actor.userId,
          scope: input.request.destination.scope,
          organizationId,
          destinationSynthesisId: synthesisId,
          destinationSynthesisVersionId: synthesisVersionId,
          destinationSynthesisVersionNumber: 1,
          previewSchemaVersion: 1,
          selectionHash: resolved.value.selectionHash,
          contentHash: resolved.value.contentHash,
          selectedMessageCount: resolved.value.selectedMessages.length,
          includesSharedCard: input.request.includeSharedCard,
          destinationGrantCount:
            input.request.destination.organizationGroupAccountIds.length,
          destinationGrantHash:
            input.request.destination.organizationGroupAccountIds.length === 0
              ? null
              : sha256(
                  'destination-grants',
                  JSON.stringify(
                    input.request.destination.organizationGroupAccountIds,
                  ),
                ),
          version: 1,
          createdBy: input.actor.userId,
        },
      });
      await transaction.knowledgeThreadPromotionMessage.createMany({
        data: resolved.value.selectedMessages.map((message) => ({
          id: randomUUID(),
          promotionId: row.id,
          sourceRoomId: resolved.value.sourceRoomId,
          sourceRootMessageId: input.rootMessageId,
          sourceMessageId: message.sourceMessageId,
          sourceActivitySequence: message.sourceActivitySequence,
          sourceMessageCreatedAt: message.createdAt,
          ordinal: message.ordinal,
          authorCategory: message.authorCategory,
          content: message.content,
          contentHash: message.contentHash,
          createdBy: input.actor.userId,
        })),
      });
      await transaction.knowledgeThreadPromotionRequest.create({
        data: {
          id: randomUUID(),
          promoterUserId: input.actor.userId,
          requestKeyHash: input.requestKeyHash,
          requestPayloadHash: input.requestPayloadHash,
          promotionId: row.id,
          createdBy: input.actor.userId,
        },
      });
      await transaction.knowledgeSynthesisSource.create({
        data: {
          synthesisVersionId,
          relationType: 'primary',
          ordinal: 0,
          sourceThreadPromotionId: row.id,
          createdBy: input.actor.userId,
        },
      });
      const auditActor = knowledgeProvenanceAuditActor(
        input.actor,
        input.auditActor,
      );
      const synthesisAudit = new PrismaKnowledgeProvenanceAuditWriter(
        transaction,
      );
      await synthesisAudit.write({
        action: 'knowledge_synthesis_created',
        actor: auditActor,
        targetTable: 'knowledge_syntheses',
        targetId: synthesisId,
        metadata: {
          scope: input.request.destination.scope,
          sourceCount: 1,
          version: 1,
        },
      });
      await synthesisAudit.write({
        action: 'knowledge_synthesis_source_linked',
        actor: auditActor,
        targetTable: 'knowledge_syntheses',
        targetId: synthesisId,
        metadata: {
          sourceKind: 'thread_promotion',
          relationType: 'primary',
          version: 1,
        },
      });
      await writePromotionAudit(transaction, {
        ...input,
        action: 'knowledge_thread_promoted',
        resultCode: 'created',
      });
      return success(commitRecord(row, true));
    });
  }
}

export const prismaKnowledgeThreadPromotionAdapter =
  new PrismaKnowledgeThreadPromotionAdapter();
