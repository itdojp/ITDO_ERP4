import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import {
  knowledgeShareLimits,
  knowledgeShareSelectionCategories,
  type KnowledgeShareAuditMetadata,
  type KnowledgeShareCardSnapshot,
  type KnowledgeShareChatActor,
  type KnowledgeShareChatIntegrationPort,
  type KnowledgeShareCommitRecord,
  type KnowledgeShareFailure,
  type KnowledgeShareFailureCode,
  type KnowledgeSharePortResult,
  type KnowledgeSharePreviewInput,
  type KnowledgeShareResolvedPreview,
  type KnowledgeShareSelection,
  type KnowledgeShareStatusRecord,
  type KnowledgeShareStorePort,
} from '../../application/knowledge/knowledgeSharePorts.js';
import { tryCreateChatMessageNotificationEffects } from '../../application/chat/chatNotificationEffects.js';
import {
  createSynthesisAccessContext,
  KnowledgeSynthesisAccessBudgetError,
} from '../../application/knowledge/knowledgeSynthesisAccessContext.js';
import { knowledgeProvenanceAuditActor } from '../../application/knowledge/knowledgeProvenanceValidation.js';
import { ensureChatRoomContentAccess } from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';
import { defaultChatNotificationPort } from '../notifications/chatNotificationAdapter.js';
import {
  boundedUtf8Excerpt,
  safeCanonicalUrl,
  strictQuestions,
} from './knowledgeShareSanitizers.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';
import { buildKnowledgeLabelVisibilityWhere } from './prismaKnowledgeLabelAdapter.js';
import { PrismaKnowledgeSynthesisRepository } from './prismaKnowledgeProvenanceAdapter.js';
import { PrismaKnowledgeShareAuditWriter } from './prismaKnowledgeShareAuditAdapter.js';

const genericShareBody = 'Knowledge was shared.';
const serializableAttempts = 3;
const lowercaseSha256Pattern = /^[0-9a-f]{64}$/;

type ShareTransactionHost = Pick<PrismaClient, '$transaction'>;

type ResolvedMaterial = KnowledgeShareResolvedPreview & {
  sourceScope: 'personal' | 'organization';
  roomUpdatedAt: Date;
};

type ResolveFailure = {
  ok: false;
  error: KnowledgeShareFailure;
  deterministicFailureCode: KnowledgeShareFailureCode;
};

type ResolveResult = { ok: true; value: ResolvedMaterial } | ResolveFailure;

const shareDetailInclude = Prisma.validator<Prisma.KnowledgeShareInclude>()({
  snapshot: true,
  labels: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  annotations: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  turns: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  syntheses: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
});

type ShareDetail = Prisma.KnowledgeShareGetPayload<{
  include: typeof shareDetailInclude;
}>;

function success<T>(value: T): KnowledgeSharePortResult<T> {
  return { ok: true, value };
}

function failure(
  status: number,
  code: KnowledgeShareFailure['code'],
): KnowledgeSharePortResult<never> {
  const messages: Record<KnowledgeShareFailure['code'], string> = {
    invalid_request: 'Invalid request',
    not_found: 'Not found',
    stale_preview: 'Preview is stale',
    preview_token_invalid: 'Invalid preview token',
    preview_token_expired: 'Preview token expired',
    idempotency_conflict: 'Idempotency conflict',
    external_audience_not_supported: 'Destination is not supported',
    share_post_failed: 'Share post failed',
  };
  return { ok: false, error: { status, code, message: messages[code] } };
}

function resolveFailure(
  status: number,
  code: KnowledgeShareFailure['code'],
  deterministicFailureCode: KnowledgeShareFailureCode,
): ResolveFailure {
  const result = failure(status, code);
  if (result.ok) throw new Error('knowledge_share_failure_contract_invalid');
  return { ...result, deterministicFailureCode };
}

function sha256(domain: string, value: string): string {
  return createHash('sha256')
    .update(`erp4:knowledge:share:${domain}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function projectIdForCurrentMembership(room: {
  id: string;
  type: string;
  projectId?: string | null;
  isOfficial: boolean;
}): string | null {
  return room.type === 'project'
    ? (room.projectId ?? (room.isOfficial ? room.id : null))
    : null;
}

function bypassesProjectMembership(chatActor: KnowledgeShareChatActor) {
  return chatActor.roles.includes('admin') || chatActor.roles.includes('mgmt');
}

async function hasCurrentProjectMembership(
  transaction: Prisma.TransactionClient,
  chatActor: KnowledgeShareChatActor,
  projectId: string | null,
): Promise<boolean> {
  if (!projectId || bypassesProjectMembership(chatActor)) return true;
  return Boolean(
    await transaction.projectMember.findFirst({
      where: {
        projectId,
        userId: chatActor.userId,
        project: { deletedAt: null },
      },
      select: { id: true },
    }),
  );
}

function isKnowledgeShareIdempotencyUniqueConflict(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== 'P2002' ||
    !('meta' in error) ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return false;
  }
  const meta = error.meta as { modelName?: unknown; target?: unknown };
  if (meta.modelName !== 'KnowledgeShare') return false;
  let targetValue = meta.target;
  if (
    targetValue === undefined &&
    'driverAdapterError' in meta &&
    typeof meta.driverAdapterError === 'object' &&
    meta.driverAdapterError !== null &&
    'cause' in meta.driverAdapterError &&
    typeof meta.driverAdapterError.cause === 'object' &&
    meta.driverAdapterError.cause !== null &&
    'constraint' in meta.driverAdapterError.cause &&
    typeof meta.driverAdapterError.cause.constraint === 'object' &&
    meta.driverAdapterError.cause.constraint !== null &&
    'fields' in meta.driverAdapterError.cause.constraint
  ) {
    targetValue = meta.driverAdapterError.cause.constraint.fields;
  }
  const targets = Array.isArray(targetValue)
    ? targetValue.filter((entry): entry is string => typeof entry === 'string')
    : typeof targetValue === 'string'
      ? [targetValue]
      : [];
  const normalized = new Set(
    targets.map((target) => target.replace(/"/g, '').trim()),
  );
  return (
    (normalized.size === 1 && normalized.has('id')) ||
    (normalized.size === 2 &&
      normalized.has('sharerUserId') &&
      normalized.has('requestKeyHash'))
  );
}

function isRetryableTransactionConflict(
  error: unknown,
  allowIdempotencyUniqueConflict = false,
): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = error.code;
  if (code === 'P2034') return true;
  if (code === 'P2002') {
    return (
      allowIdempotencyUniqueConflict &&
      isKnowledgeShareIdempotencyUniqueConflict(error)
    );
  }
  if (code !== 'P2010' || !('meta' in error)) return false;
  const meta = error.meta;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('driverAdapterError' in meta)
  ) {
    return false;
  }
  const driver = meta.driverAdapterError;
  if (typeof driver !== 'object' || driver === null || !('cause' in driver)) {
    return false;
  }
  const cause = driver.cause;
  if (typeof cause !== 'object' || cause === null) return false;
  const sqlState =
    ('originalCode' in cause && cause.originalCode) ||
    ('code' in cause && cause.code);
  return sqlState === '40001' || sqlState === '40P01';
}

function conversationVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeConversationWhereInput {
  const itemVisibility = buildKnowledgeVisibilityWhere(actor);
  return {
    deletedAt: null,
    OR: [
      { ownerUserId: actor.userId, items: { none: {} } },
      {
        items: { some: {} },
        AND: { items: { every: { knowledgeItem: { is: itemVisibility } } } },
      },
    ],
  };
}

function selectedCategories(selection: KnowledgeShareSelection) {
  const selected: Array<(typeof knowledgeShareSelectionCategories)[number]> =
    [];
  if (selection.includeTitle) selected.push('title');
  if (selection.includeSourceType) selected.push('source_type');
  if (selection.includeCanonicalUrl) selected.push('canonical_url');
  if (selection.snapshot?.includeProvenance)
    selected.push('snapshot_provenance');
  if (selection.snapshot?.includeExcerpt) selected.push('snapshot_excerpt');
  if (selection.labelAssignmentIds.length > 0) selected.push('label');
  if (selection.annotations.length > 0) selected.push('annotation');
  if (selection.conversationTurnIds.length > 0)
    selected.push('conversation_turn');
  if (selection.syntheses.length > 0) selected.push('synthesis');
  if (selection.sharerNote !== null) selected.push('sharer_note');
  return selected;
}

function selectionForShare(share: ShareDetail): KnowledgeShareSelection {
  return {
    includeTitle: share.selectedTitle !== null,
    includeSourceType: share.selectedSourceType !== null,
    includeCanonicalUrl: share.selectedCanonicalUrl !== null,
    snapshot: share.snapshot
      ? {
          snapshotId: share.snapshot.sourceSnapshotId,
          includeProvenance: share.snapshot.provenanceSelected,
          includeExcerpt: share.snapshot.excerptSelected,
        }
      : null,
    labelAssignmentIds: share.labels.map((entry) => entry.sourceAssignmentId),
    annotations: share.annotations.map((entry) => ({
      annotationId: entry.sourceAnnotationId,
      revision: entry.revision,
    })),
    conversationTurnIds: share.turns.map((entry) => entry.sourceTurnId),
    syntheses: share.syntheses.map((entry) => ({
      synthesisId: entry.sourceSynthesisId,
      version: entry.version,
    })),
    sharerNote: share.selectedSharerNote,
  };
}

function statusRecord(
  row: Pick<
    ShareDetail,
    | 'id'
    | 'status'
    | 'version'
    | 'chatMessageId'
    | 'failureCode'
    | 'createdAt'
    | 'postedAt'
    | 'failedAt'
    | 'revokedAt'
  >,
): KnowledgeShareStatusRecord {
  return {
    shareId: row.id,
    status: row.status,
    version: row.version,
    chatMessageId: row.chatMessageId,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    postedAt: row.postedAt,
    failedAt: row.failedAt,
    revokedAt: row.revokedAt,
  };
}

function auditMetadata(
  material: Pick<ResolvedMaterial, 'sourceScope' | 'snapshot'>,
  details: Omit<KnowledgeShareAuditMetadata, 'schemaVersion' | 'scope'> = {},
): KnowledgeShareAuditMetadata {
  return {
    schemaVersion: 1,
    scope: material.sourceScope,
    selectedCategoryCount: material.snapshot.selectedCategories.length,
    labelCount: material.snapshot.labels.length,
    annotationCount: material.snapshot.annotations.length,
    turnCount: material.snapshot.turns.length,
    synthesisCount: material.snapshot.syntheses.length,
    ...details,
  };
}

async function lockRows(
  transaction: Prisma.TransactionClient,
  actor: KnowledgeActor,
  chatActor: KnowledgeShareChatActor,
  itemId: string,
  destinationRoomId: string,
  destinationProjectId: string | null,
  selection: KnowledgeShareSelection,
) {
  await transaction.$queryRaw(Prisma.sql`
    SELECT item."id"
    FROM "KnowledgeItem" AS item
    WHERE item."id" = ${itemId}
    FOR SHARE
  `);
  await transaction.$queryRaw(Prisma.sql`
    SELECT room."id"
    FROM "ChatRoom" AS room
    WHERE room."id" = ${destinationRoomId}
      AND room."deletedAt" IS NULL
    FOR SHARE
  `);
  if (destinationProjectId && !bypassesProjectMembership(chatActor)) {
    await transaction.$queryRaw(Prisma.sql`
      SELECT membership."id"
      FROM "ProjectMember" AS membership
      INNER JOIN "Project" AS project
        ON project."id" = membership."projectId"
       AND project."deletedAt" IS NULL
      WHERE membership."projectId" = ${destinationProjectId}
        AND membership."userId" = ${chatActor.userId}
      FOR SHARE OF membership, project
    `);
  }
  await transaction.$queryRaw(Prisma.sql`
    SELECT member."id"
    FROM "ChatRoomMember" AS member
    WHERE member."roomId" = ${destinationRoomId}
      AND member."userId" = ${chatActor.userId}
      AND member."deletedAt" IS NULL
    FOR SHARE
  `);

  const actorGroupIds = uniqueSorted(actor.groupAccountIds);
  if (actorGroupIds.length > 0) {
    await transaction.$queryRaw(Prisma.sql`
      SELECT grant."id"
      FROM "KnowledgeItemGroupGrant" AS grant
      WHERE grant."knowledgeItemId" = ${itemId}
        AND grant."groupAccountId" IN (${Prisma.join(actorGroupIds)})
      ORDER BY grant."groupAccountId", grant."id"
      FOR SHARE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT account."id"
      FROM "GroupAccount" AS account
      WHERE account."id" IN (${Prisma.join(actorGroupIds)})
      ORDER BY account."id"
      FOR SHARE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT membership."id"
      FROM "UserGroup" AS membership
      WHERE membership."userId" = ${actor.userId}
        AND membership."groupId" IN (${Prisma.join(actorGroupIds)})
      ORDER BY membership."groupId", membership."id"
      FOR SHARE
    `);
  }

  const lockSelected = async (table: string, ids: readonly string[]) => {
    const sorted = uniqueSorted(ids);
    if (sorted.length === 0) return;
    const tableSql = Prisma.raw(`"${table}"`);
    await transaction.$queryRaw(Prisma.sql`
      SELECT selected."id"
      FROM ${tableSql} AS selected
      WHERE selected."id" IN (${Prisma.join(sorted)})
      ORDER BY selected."id"
      FOR SHARE
    `);
  };

  await lockSelected(
    'KnowledgeSnapshot',
    selection.snapshot ? [selection.snapshot.snapshotId] : [],
  );
  await lockSelected('KnowledgeItemLabel', selection.labelAssignmentIds);
  await lockSelected(
    'KnowledgeAnnotation',
    selection.annotations.map((entry) => entry.annotationId),
  );
  await lockSelected(
    'KnowledgeConversationTurn',
    selection.conversationTurnIds,
  );
  await lockSelected(
    'KnowledgeSynthesis',
    selection.syntheses.map((entry) => entry.synthesisId),
  );
}

async function resolveMaterial(
  transaction: Prisma.TransactionClient,
  input: Omit<KnowledgeSharePreviewInput, 'auditActor'>,
  lock: boolean,
): Promise<ResolveResult> {
  const item = await transaction.knowledgeItem.findFirst({
    where: {
      AND: [{ id: input.itemId }, buildKnowledgeVisibilityWhere(input.actor)],
    },
    select: {
      id: true,
      ownerUserId: true,
      scope: true,
      sourceType: true,
      canonicalUrl: true,
      title: true,
      version: true,
      updatedAt: true,
    },
  });
  if (!item) return resolveFailure(404, 'not_found', 'source_unavailable');

  const roomAccess = await ensureChatRoomContentAccess({
    roomId: input.destinationRoomId,
    userId: input.chatActor.userId,
    roles: input.chatActor.roles,
    projectIds: input.chatActor.projectIds,
    groupIds: input.chatActor.groupIds,
    groupAccountIds: input.chatActor.groupAccountIds,
    accessLevel: 'post',
    client: transaction as unknown as typeof prisma,
  });
  if (!roomAccess.ok) {
    return resolveFailure(404, 'not_found', 'room_unavailable');
  }
  if (roomAccess.room.allowExternalUsers) {
    return resolveFailure(
      400,
      'external_audience_not_supported',
      'post_rejected',
    );
  }
  const destinationProjectId = projectIdForCurrentMembership(roomAccess.room);
  if (
    !(await hasCurrentProjectMembership(
      transaction,
      input.chatActor,
      destinationProjectId,
    ))
  ) {
    return resolveFailure(404, 'not_found', 'room_unavailable');
  }
  const room = await transaction.chatRoom.findFirst({
    where: { id: roomAccess.room.id, deletedAt: null },
    select: { id: true, name: true, type: true, updatedAt: true },
  });
  if (!room) return resolveFailure(404, 'not_found', 'room_unavailable');

  if (lock) {
    await lockRows(
      transaction,
      input.actor,
      input.chatActor,
      item.id,
      room.id,
      destinationProjectId,
      input.selection,
    );
    return resolveMaterial(transaction, input, false);
  }

  let selectedTitle: string | undefined;
  if (input.selection.includeTitle) {
    if (!item.title)
      return resolveFailure(400, 'invalid_request', 'source_unavailable');
    selectedTitle = item.title;
  }

  let selectedCanonicalUrl: string | undefined;
  if (input.selection.includeCanonicalUrl) {
    selectedCanonicalUrl = safeCanonicalUrl(item.canonicalUrl);
    if (!selectedCanonicalUrl) {
      return resolveFailure(400, 'invalid_request', 'source_unavailable');
    }
  }

  let selectedSnapshot: KnowledgeShareCardSnapshot['snapshot'];
  if (input.selection.snapshot) {
    const row = await transaction.knowledgeSnapshot.findFirst({
      where: {
        id: input.selection.snapshot.snapshotId,
        knowledgeItemId: item.id,
        status: 'ready',
        sha256: { not: null },
      },
      select: {
        id: true,
        version: true,
        sha256: true,
        extractedText: true,
      },
    });
    if (!row?.sha256 || !lowercaseSha256Pattern.test(row.sha256)) {
      return resolveFailure(404, 'not_found', 'source_unavailable');
    }
    const excerpt = input.selection.snapshot.includeExcerpt
      ? boundedUtf8Excerpt(row.extractedText)
      : undefined;
    if (input.selection.snapshot.includeExcerpt && !excerpt) {
      return resolveFailure(400, 'invalid_request', 'source_unavailable');
    }
    selectedSnapshot = {
      sourceSnapshotId: row.id,
      version: row.version,
      sha256: row.sha256,
      ...(excerpt === undefined ? {} : { excerpt }),
    };
  }

  const labelRows =
    input.selection.labelAssignmentIds.length === 0
      ? []
      : await transaction.knowledgeItemLabel.findMany({
          where: {
            id: { in: input.selection.labelAssignmentIds },
            knowledgeItemId: item.id,
            detachedAt: null,
            label: { is: buildKnowledgeLabelVisibilityWhere(input.actor) },
          },
          include: { label: true },
        });
  const labelById = new Map(labelRows.map((entry) => [entry.id, entry]));
  const labels = input.selection.labelAssignmentIds.map(
    (assignmentId, ordinal) => {
      const row = labelById.get(assignmentId);
      if (!row || row.label.deletedAt !== null) return null;
      return {
        sourceAssignmentId: row.id,
        sourceLabelId: row.labelId,
        sourceLabelVersion: row.label.version,
        displayName: row.label.displayName,
        ordinal,
        contentHash: sha256(
          'label',
          stableJson({
            assignmentId: row.id,
            labelId: row.labelId,
            version: row.label.version,
            displayName: row.label.displayName,
          }),
        ),
      };
    },
  );
  if (labels.some((entry) => entry === null)) {
    return resolveFailure(404, 'not_found', 'source_unavailable');
  }

  const annotationIds = input.selection.annotations.map(
    (entry) => entry.annotationId,
  );
  const annotationRows =
    annotationIds.length === 0
      ? []
      : await transaction.knowledgeAnnotation.findMany({
          where: {
            id: { in: annotationIds },
            knowledgeItemId: item.id,
            ownerUserId: item.ownerUserId,
            deletedAt: null,
          },
          include: { revisions: true },
        });
  const annotationById = new Map(
    annotationRows.map((entry) => [entry.id, entry]),
  );
  const annotations = input.selection.annotations.map((selector, ordinal) => {
    const annotation = annotationById.get(selector.annotationId);
    const revision = annotation?.revisions.find(
      (entry) => entry.revision === selector.revision,
    );
    if (
      !annotation ||
      !revision ||
      annotation.currentRevision !== selector.revision ||
      revision.kind !== annotation.kind ||
      revision.origin !== annotation.origin
    ) {
      return null;
    }
    return {
      sourceAnnotationId: annotation.id,
      sourceRevisionId: revision.id,
      revision: revision.revision,
      kind: revision.kind,
      origin: revision.origin,
      content: revision.content,
      ordinal,
      contentHash: sha256(
        'annotation',
        stableJson({
          annotationId: annotation.id,
          revisionId: revision.id,
          revision: revision.revision,
          kind: revision.kind,
          origin: revision.origin,
          content: revision.content,
        }),
      ),
    };
  });
  if (annotations.some((entry) => entry === null)) {
    return resolveFailure(404, 'not_found', 'source_unavailable');
  }

  const turnRows =
    input.selection.conversationTurnIds.length === 0
      ? []
      : await transaction.knowledgeConversationTurn.findMany({
          where: {
            id: { in: input.selection.conversationTurnIds },
            conversation: {
              is: {
                AND: [
                  conversationVisibilityWhere(input.actor),
                  {
                    ownerUserId: item.ownerUserId,
                    items: {
                      some: {
                        knowledgeItemId: item.id,
                        ownerUserId: item.ownerUserId,
                      },
                    },
                  },
                ],
              },
            },
          },
          include: { conversation: true },
        });
  const turnById = new Map(turnRows.map((entry) => [entry.id, entry]));
  const turns = input.selection.conversationTurnIds.map((turnId, ordinal) => {
    const row = turnById.get(turnId);
    if (!row || row.conversation.deletedAt !== null) return null;
    return {
      sourceConversationId: row.conversationId,
      sourceConversationVersion: row.conversation.version,
      sourceTurnId: row.id,
      role: row.role,
      origin: row.origin,
      content: row.content,
      name: row.name,
      occurredAt: row.occurredAt,
      ordinal,
      contentHash: sha256(
        'conversation-turn',
        stableJson({
          conversationId: row.conversationId,
          conversationVersion: row.conversation.version,
          turnId: row.id,
          role: row.role,
          origin: row.origin,
          content: row.content,
          name: row.name,
          occurredAt: row.occurredAt?.toISOString() ?? null,
        }),
      ),
    };
  });
  if (turns.some((entry) => entry === null)) {
    return resolveFailure(404, 'not_found', 'source_unavailable');
  }

  const synthesisRepository = new PrismaKnowledgeSynthesisRepository(
    transaction,
  );
  const synthesisContext = createSynthesisAccessContext();
  const syntheses: Array<KnowledgeShareCardSnapshot['syntheses'][number]> = [];
  try {
    for (const [ordinal, selector] of input.selection.syntheses.entries()) {
      const visible = await synthesisRepository.findVisible({
        actor: input.actor,
        synthesisId: selector.synthesisId,
        accessContext: synthesisContext,
      });
      if (
        !visible ||
        visible.synthesis.ownerUserId !== item.ownerUserId ||
        visible.synthesis.currentVersion !== selector.version ||
        visible.currentVersion.version !== selector.version
      ) {
        return resolveFailure(404, 'not_found', 'source_unavailable');
      }
      const questions = strictQuestions(
        visible.currentVersion.unresolvedQuestions as Prisma.JsonValue,
      );
      if (!questions) {
        return resolveFailure(404, 'not_found', 'source_unavailable');
      }
      syntheses.push({
        sourceSynthesisId: visible.synthesis.id,
        sourceSynthesisVersionId: visible.currentVersion.id,
        version: visible.currentVersion.version,
        title: visible.synthesis.title,
        content: visible.currentVersion.content,
        confidenceBasisPoints: visible.currentVersion.confidenceBasisPoints,
        unresolvedQuestions: questions,
        ordinal,
        contentHash: sha256(
          'synthesis',
          stableJson({
            synthesisId: visible.synthesis.id,
            synthesisVersionId: visible.currentVersion.id,
            version: visible.currentVersion.version,
            title: visible.synthesis.title,
            content: visible.currentVersion.content,
            confidenceBasisPoints: visible.currentVersion.confidenceBasisPoints,
            unresolvedQuestions: questions,
          }),
        ),
      });
    }
  } catch (error) {
    if (error instanceof KnowledgeSynthesisAccessBudgetError) {
      return resolveFailure(404, 'not_found', 'source_unavailable');
    }
    throw error;
  }

  const selected = selectedCategories(input.selection);
  const omitted = knowledgeShareSelectionCategories.filter(
    (category) => !selected.includes(category),
  );
  const selectionHash = sha256(
    'selection',
    stableJson({
      includeTitle: input.selection.includeTitle,
      includeSourceType: input.selection.includeSourceType,
      includeCanonicalUrl: input.selection.includeCanonicalUrl,
      snapshot: input.selection.snapshot,
      labelAssignmentIds: input.selection.labelAssignmentIds,
      annotations: input.selection.annotations,
      conversationTurnIds: input.selection.conversationTurnIds,
      syntheses: input.selection.syntheses,
      sharerNote: input.selection.sharerNote,
    }),
  );
  const cardWithoutHash = {
    schemaVersion: 1 as const,
    ...(selectedTitle === undefined ? {} : { title: selectedTitle }),
    ...(input.selection.includeSourceType
      ? { sourceType: item.sourceType }
      : {}),
    ...(selectedCanonicalUrl === undefined
      ? {}
      : { canonicalUrl: selectedCanonicalUrl }),
    ...(selectedSnapshot === undefined ? {} : { snapshot: selectedSnapshot }),
    ...(input.selection.sharerNote === null
      ? {}
      : { sharerNote: input.selection.sharerNote }),
    labels: labels.filter((entry) => entry !== null),
    annotations: annotations.filter((entry) => entry !== null),
    turns: turns.filter((entry) => entry !== null),
    syntheses,
    selectedCategories: selected,
    omittedCategories: omitted,
  };
  const contentHash = sha256('card-content', stableJson(cardWithoutHash));
  const snapshot: KnowledgeShareCardSnapshot = {
    ...cardWithoutHash,
    contentHash,
  };
  const bindingHash = sha256(
    'preview-binding',
    stableJson({
      sourceItemId: item.id,
      sourceOwnerUserId: item.ownerUserId,
      sourceItemVersion: item.version,
      sourceItemUpdatedAt: item.updatedAt.toISOString(),
      destinationRoomId: room.id,
      destinationRoomName: room.name,
      destinationRoomType: room.type,
      destinationRoomUpdatedAt: room.updatedAt.toISOString(),
      selectionHash,
      contentHash,
    }),
  );
  return {
    ok: true,
    value: {
      sourceItemId: item.id,
      sourceOwnerUserId: item.ownerUserId,
      sourceItemVersion: item.version,
      sourceItemUpdatedAt: item.updatedAt,
      sourceScope: item.scope,
      destinationRoomId: room.id,
      destinationRoomName: room.name,
      destinationRoomType: room.type,
      roomUpdatedAt: room.updatedAt,
      snapshot,
      selectionHash,
      bindingHash,
    },
  };
}

export class PrismaKnowledgeShareAdapter
  implements KnowledgeShareStorePort, KnowledgeShareChatIntegrationPort
{
  constructor(
    private readonly host: ShareTransactionHost = prisma as PrismaClient,
  ) {}

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: { retryIdempotencyUniqueConflict?: boolean } = {},
  ): Promise<T> {
    for (let attempt = 1; attempt <= serializableAttempts; attempt += 1) {
      try {
        return await this.host.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !isRetryableTransactionConflict(
            error,
            options.retryIdempotencyUniqueConflict === true,
          ) ||
          attempt === serializableAttempts
        ) {
          throw error;
        }
      }
    }
    throw new Error('knowledge_share_transaction_retry_exhausted');
  }

  async preview(input: Parameters<KnowledgeShareStorePort['preview']>[0]) {
    return this.host.$transaction(
      async (transaction) => {
        const resolved = await resolveMaterial(transaction, input, false);
        if (!resolved.ok) return resolved;
        await new PrismaKnowledgeShareAuditWriter(transaction).write({
          action: 'knowledge_share_previewed',
          actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
          targetTable: 'knowledge_shares',
          targetId: input.shareId,
          metadata: auditMetadata(resolved.value),
        });
        return success(resolved.value);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async resolveForCommit(
    input: Omit<KnowledgeSharePreviewInput, 'auditActor'>,
  ) {
    return this.host.$transaction(
      async (transaction) => {
        const resolved = await resolveMaterial(transaction, input, false);
        return resolved.ok ? success(resolved.value) : resolved;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findIdempotent(
    input: Parameters<KnowledgeShareStorePort['findIdempotent']>[0],
  ): Promise<KnowledgeSharePortResult<KnowledgeShareCommitRecord | null>> {
    if (
      !lowercaseSha256Pattern.test(input.requestKeyHash) ||
      !lowercaseSha256Pattern.test(input.requestPayloadHash)
    ) {
      return failure(400, 'invalid_request');
    }
    return this.host.$transaction(async (transaction) => {
      const existing = await transaction.knowledgeShare.findUnique({
        where: {
          sharerUserId_requestKeyHash: {
            sharerUserId: input.actor.userId,
            requestKeyHash: input.requestKeyHash,
          },
        },
        include: shareDetailInclude,
      });
      if (!existing) return success(null);
      const samePayload =
        existing.requestPayloadHash === input.requestPayloadHash;
      await new PrismaKnowledgeShareAuditWriter(transaction).write({
        action: 'knowledge_share_duplicate_detected',
        actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
        targetTable: 'knowledge_shares',
        targetId: existing.id,
        metadata: {
          schemaVersion: 1,
          status: existing.status,
          resultCode: samePayload ? 'reused' : undefined,
          duplicate: true,
        },
      });
      return samePayload
        ? success({ ...statusRecord(existing), created: false })
        : failure(409, 'idempotency_conflict');
    });
  }

  async createPending(
    input: Parameters<KnowledgeShareStorePort['createPending']>[0],
  ): Promise<KnowledgeSharePortResult<KnowledgeShareCommitRecord>> {
    if (
      !lowercaseSha256Pattern.test(input.requestKeyHash) ||
      !lowercaseSha256Pattern.test(input.requestPayloadHash) ||
      !lowercaseSha256Pattern.test(input.expectedBindingHash)
    ) {
      return failure(400, 'invalid_request');
    }
    return this.serializable(
      async (transaction) => {
        const audit = new PrismaKnowledgeShareAuditWriter(transaction);
        const existing = await transaction.knowledgeShare.findUnique({
          where: {
            sharerUserId_requestKeyHash: {
              sharerUserId: input.actor.userId,
              requestKeyHash: input.requestKeyHash,
            },
          },
          include: shareDetailInclude,
        });
        if (existing) {
          const samePayload =
            existing.requestPayloadHash === input.requestPayloadHash;
          await audit.write({
            action: 'knowledge_share_duplicate_detected',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_shares',
            targetId: existing.id,
            metadata: {
              schemaVersion: 1,
              status: existing.status,
              resultCode: samePayload ? 'reused' : undefined,
              duplicate: true,
            },
          });
          if (!samePayload) return failure(409, 'idempotency_conflict');
          return success({ ...statusRecord(existing), created: false });
        }

        const existingShareId = await transaction.knowledgeShare.findUnique({
          where: { id: input.shareId },
          include: shareDetailInclude,
        });
        if (existingShareId) {
          await audit.write({
            action: 'knowledge_share_duplicate_detected',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_shares',
            targetId: existingShareId.id,
            metadata: {
              schemaVersion: 1,
              status: existingShareId.status,
              duplicate: true,
            },
          });
          return failure(409, 'idempotency_conflict');
        }

        const resolved = await resolveMaterial(transaction, input, true);
        if (!resolved.ok) return resolved;
        if (resolved.value.bindingHash !== input.expectedBindingHash) {
          return failure(409, 'stale_preview');
        }
        const card = resolved.value.snapshot;
        const row = await transaction.knowledgeShare.create({
          data: {
            id: input.shareId,
            sourceKnowledgeItemId: resolved.value.sourceItemId,
            sourceOwnerUserId: resolved.value.sourceOwnerUserId,
            sharerUserId: input.actor.userId,
            chatPosterUserId: input.chatActor.userId,
            destinationRoomId: resolved.value.destinationRoomId,
            selectionSchemaVersion: 1,
            requestKeyHash: input.requestKeyHash,
            requestPayloadHash: input.requestPayloadHash,
            selectionHash: resolved.value.selectionHash,
            contentHash: card.contentHash,
            sourceItemVersion: resolved.value.sourceItemVersion,
            sourceItemUpdatedAt: resolved.value.sourceItemUpdatedAt,
            selectedTitle: card.title ?? null,
            selectedSourceType: card.sourceType ?? null,
            selectedCanonicalUrl: card.canonicalUrl ?? null,
            selectedSharerNote: card.sharerNote ?? null,
            status: 'pending',
            createdBy: input.actor.userId,
            updatedBy: input.actor.userId,
            ...(card.snapshot
              ? {
                  snapshot: {
                    create: {
                      sourceSnapshotId: card.snapshot.sourceSnapshotId,
                      sourceSnapshotVersion: card.snapshot.version,
                      sourceSha256: card.snapshot.sha256,
                      provenanceSelected:
                        input.selection.snapshot?.includeProvenance ?? false,
                      excerptSelected:
                        input.selection.snapshot?.includeExcerpt ?? false,
                      excerpt: card.snapshot.excerpt ?? null,
                      contentHash: sha256(
                        'snapshot',
                        stableJson(card.snapshot),
                      ),
                      createdBy: input.actor.userId,
                    },
                  },
                }
              : {}),
            labels: {
              create: card.labels.map((entry) => ({
                sourceAssignmentId: entry.sourceAssignmentId,
                sourceLabelId: entry.sourceLabelId,
                sourceLabelVersion: entry.sourceLabelVersion,
                displayName: entry.displayName,
                ordinal: entry.ordinal,
                contentHash: entry.contentHash,
                createdBy: input.actor.userId,
              })),
            },
            annotations: {
              create: card.annotations.map((entry) => ({
                sourceAnnotationId: entry.sourceAnnotationId,
                sourceRevisionId: entry.sourceRevisionId,
                revision: entry.revision,
                kind: entry.kind,
                origin: entry.origin,
                content: entry.content,
                ordinal: entry.ordinal,
                contentHash: entry.contentHash,
                createdBy: input.actor.userId,
              })),
            },
            turns: {
              create: card.turns.map((entry) => ({
                sourceConversationId: entry.sourceConversationId,
                sourceConversationVersion: entry.sourceConversationVersion,
                sourceTurnId: entry.sourceTurnId,
                role: entry.role,
                origin: entry.origin,
                content: entry.content,
                name: entry.name,
                occurredAt: entry.occurredAt,
                ordinal: entry.ordinal,
                contentHash: entry.contentHash,
                createdBy: input.actor.userId,
              })),
            },
            syntheses: {
              create: card.syntheses.map((entry) => ({
                sourceSynthesisId: entry.sourceSynthesisId,
                sourceSynthesisVersionId: entry.sourceSynthesisVersionId,
                version: entry.version,
                title: entry.title,
                content: entry.content,
                confidenceBasisPoints: entry.confidenceBasisPoints,
                unresolvedQuestions: entry.unresolvedQuestions,
                ordinal: entry.ordinal,
                contentHash: entry.contentHash,
                createdBy: input.actor.userId,
              })),
            },
          },
          include: shareDetailInclude,
        });
        await audit.write({
          action: 'knowledge_share_requested',
          actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
          targetTable: 'knowledge_shares',
          targetId: row.id,
          metadata: auditMetadata(resolved.value, {
            status: 'pending',
            resultCode: 'created',
          }),
        });
        return success({ ...statusRecord(row), created: true });
      },
      { retryIdempotencyUniqueConflict: true },
    );
  }

  async findStatus(
    input: Parameters<KnowledgeShareStorePort['findStatus']>[0],
  ) {
    return this.host.$transaction(async (transaction) => {
      const row = await transaction.knowledgeShare.findFirst({
        where: { id: input.shareId, sharerUserId: input.actor.userId },
        include: shareDetailInclude,
      });
      return row ? success(statusRecord(row)) : failure(404, 'not_found');
    });
  }

  async postPending(
    input: Parameters<KnowledgeShareChatIntegrationPort['postPending']>[0],
  ) {
    return this.serializable(async (transaction) => {
      const initial = await transaction.knowledgeShare.findFirst({
        where: { id: input.shareId, sharerUserId: input.actor.userId },
        include: shareDetailInclude,
      });
      if (!initial) return failure(404, 'not_found');
      await transaction.$queryRaw(Prisma.sql`
        SELECT share."id"
        FROM "KnowledgeShare" AS share
        WHERE share."id" = ${initial.id}
          AND share."sharerUserId" = ${input.actor.userId}
        FOR UPDATE
      `);
      const share = await transaction.knowledgeShare.findFirst({
        where: { id: initial.id, sharerUserId: input.actor.userId },
        include: shareDetailInclude,
      });
      if (!share) return failure(404, 'not_found');
      if (share.status === 'posted') return success(statusRecord(share));
      if (share.status !== 'pending') return failure(502, 'share_post_failed');

      const selection = selectionForShare(share);
      const resolved = await resolveMaterial(
        transaction,
        {
          actor: input.actor,
          chatActor: input.chatActor,
          itemId: share.sourceKnowledgeItemId,
          destinationRoomId: share.destinationRoomId,
          selection,
        },
        true,
      );
      const sourceStillExact =
        resolved.ok &&
        resolved.value.sourceItemVersion === share.sourceItemVersion &&
        resolved.value.sourceItemUpdatedAt.getTime() ===
          share.sourceItemUpdatedAt.getTime() &&
        resolved.value.selectionHash === share.selectionHash &&
        resolved.value.snapshot.contentHash === share.contentHash;
      if (
        !resolved.ok ||
        !sourceStillExact ||
        resolved.value.bindingHash !== input.expectedBindingHash
      ) {
        const failureCode = !resolved.ok
          ? resolved.deterministicFailureCode
          : sourceStillExact
            ? 'room_unavailable'
            : 'source_unavailable';
        const failedAt = new Date();
        const updated = await transaction.knowledgeShare.update({
          where: { id: share.id },
          data: {
            status: 'failed',
            failureCode,
            failedAt,
            version: { increment: 1 },
            updatedBy: input.actor.userId,
          },
          include: shareDetailInclude,
        });
        await new PrismaKnowledgeShareAuditWriter(transaction).write({
          action: 'knowledge_share_failed',
          actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
          targetTable: 'knowledge_shares',
          targetId: share.id,
          metadata: {
            schemaVersion: 1,
            status: 'failed',
            resultCode: 'failed',
          },
        });
        void updated;
        return failure(502, 'share_post_failed');
      }

      const createdAt = new Date();
      await transaction.chatMessage.create({
        data: {
          id: share.id,
          roomId: share.destinationRoomId,
          messageType: 'text',
          parentMessageId: null,
          threadRootId: null,
          userId: share.chatPosterUserId,
          body: genericShareBody,
          tags: undefined,
          reactions: undefined,
          mentions: undefined,
          mentionsAll: false,
          createdAt,
          createdBy: share.chatPosterUserId,
          updatedBy: share.chatPosterUserId,
        },
      });
      const posted = await transaction.knowledgeShare.update({
        where: { id: share.id },
        data: {
          chatMessageId: share.id,
          status: 'posted',
          failureCode: null,
          postedAt: createdAt,
          version: { increment: 1 },
          updatedBy: input.actor.userId,
        },
        include: shareDetailInclude,
      });
      await new PrismaKnowledgeShareAuditWriter(transaction).write({
        action: 'knowledge_share_posted',
        actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
        targetTable: 'knowledge_shares',
        targetId: share.id,
        metadata: auditMetadata(resolved.value, {
          status: 'posted',
          resultCode: 'posted',
        }),
      });
      return success(statusRecord(posted));
    });
  }

  async reconcile(
    input: Parameters<KnowledgeShareChatIntegrationPort['reconcile']>[0],
  ) {
    return this.serializable(async (transaction) => {
      const initial = await transaction.knowledgeShare.findFirst({
        where: { id: input.shareId, sharerUserId: input.actor.userId },
        include: shareDetailInclude,
      });
      if (!initial) return failure(404, 'not_found');
      await transaction.$queryRaw(Prisma.sql`
        SELECT share."id"
        FROM "KnowledgeShare" AS share
        WHERE share."id" = ${initial.id}
          AND share."sharerUserId" = ${input.actor.userId}
        FOR UPDATE
      `);
      let row = await transaction.knowledgeShare.findFirst({
        where: { id: initial.id, sharerUserId: input.actor.userId },
        include: shareDetailInclude,
      });
      if (!row) return failure(404, 'not_found');

      if (row.status === 'pending') {
        const existingMessages = await transaction.$queryRaw<
          Array<{ id: string; createdAt: Date }>
        >(Prisma.sql`
          SELECT message."id", message."createdAt"
          FROM "ChatMessage" AS message
          WHERE message."id" = ${row.id}
            AND message."roomId" = ${row.destinationRoomId}
            AND message."userId" = ${row.chatPosterUserId}
            AND message."messageType" = 'text'
            AND message."body" = ${genericShareBody}
            AND message."parentMessageId" IS NULL
            AND message."threadRootId" IS NULL
            AND message."deletedAt" IS NULL
          FOR UPDATE
        `);
        const existingMessage = existingMessages[0];
        if (existingMessage) {
          row = await transaction.knowledgeShare.update({
            where: { id: row.id },
            data: {
              chatMessageId: existingMessage.id,
              status: 'posted',
              postedAt: existingMessage.createdAt,
              version: { increment: 1 },
              updatedBy: input.actor.userId,
            },
            include: shareDetailInclude,
          });
        }
      }

      await new PrismaKnowledgeShareAuditWriter(transaction).write({
        action: 'knowledge_share_reconciled',
        actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
        targetTable: 'knowledge_shares',
        targetId: row.id,
        metadata: {
          schemaVersion: 1,
          status: row.status,
          resultCode: row.status,
        },
      });
      return success(statusRecord(row));
    });
  }

  async revoke(input: Parameters<KnowledgeShareStorePort['revoke']>[0]) {
    return this.serializable(async (transaction) => {
      const initial = await transaction.knowledgeShare.findFirst({
        where: {
          id: input.shareId,
          OR: [
            { sharerUserId: input.actor.userId },
            { sourceOwnerUserId: input.actor.userId },
          ],
        },
        include: shareDetailInclude,
      });
      if (!initial) return failure(404, 'not_found');
      await transaction.$queryRaw(Prisma.sql`
        SELECT share."id"
        FROM "KnowledgeShare" AS share
        WHERE share."id" = ${initial.id}
        FOR UPDATE
      `);
      const row = await transaction.knowledgeShare.findFirst({
        where: {
          id: initial.id,
          OR: [
            { sharerUserId: input.actor.userId },
            { sourceOwnerUserId: input.actor.userId },
          ],
        },
        include: shareDetailInclude,
      });
      if (!row) return failure(404, 'not_found');
      if (row.status === 'revoked') return success(statusRecord(row));
      if (row.status !== 'pending' && row.status !== 'posted') {
        return failure(400, 'invalid_request');
      }
      const revoked = await transaction.knowledgeShare.update({
        where: { id: row.id },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy: input.actor.userId,
          version: { increment: 1 },
          updatedBy: input.actor.userId,
        },
        include: shareDetailInclude,
      });
      await new PrismaKnowledgeShareAuditWriter(transaction).write({
        action: 'knowledge_share_revoked',
        actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
        targetTable: 'knowledge_shares',
        targetId: row.id,
        metadata: {
          schemaVersion: 1,
          status: 'revoked',
          resultCode: 'revoked',
        },
      });
      return success(statusRecord(revoked));
    });
  }

  async notifyPosted(
    input: Parameters<KnowledgeShareChatIntegrationPort['notifyPosted']>[0],
  ): Promise<void> {
    try {
      const notification = await this.host.$transaction(
        async (transaction) => {
          const share = await transaction.knowledgeShare.findFirst({
            where: {
              id: input.shareId,
              sharerUserId: input.actor.userId,
              chatPosterUserId: input.chatActor.userId,
              status: 'posted',
              chatMessageId: { not: null },
            },
            select: {
              chatMessageId: true,
              chatPosterUserId: true,
              destinationRoom: {
                select: {
                  id: true,
                  type: true,
                  projectId: true,
                  groupId: true,
                  isOfficial: true,
                  viewerGroupIds: true,
                  allowExternalUsers: true,
                },
              },
            },
          });
          if (!share?.chatMessageId) return null;
          const existingNotifications =
            await transaction.appNotification.findMany({
              where: {
                kind: 'chat_message',
                messageId: share.chatMessageId,
              },
              select: { userId: true },
            });
          return {
            ...share,
            existingRecipientUserIds: existingNotifications.map(
              (entry) => entry.userId,
            ),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      if (!notification?.chatMessageId) return;
      await tryCreateChatMessageNotificationEffects({
        auditContext: input.auditActor,
        logger: {
          warn(payload, message) {
            console.warn(message, payload);
          },
        },
        failureMessage: 'Failed to create Knowledge share notifications',
        notificationPort: defaultChatNotificationPort,
        room: notification.destinationRoom,
        messageId: notification.chatMessageId,
        messageBody: genericShareBody,
        senderUserId: notification.chatPosterUserId,
        excludeUserIds: notification.existingRecipientUserIds,
        idempotencyDomain: 'knowledge_share',
      });
    } catch {
      console.warn('Failed to prepare Knowledge share notifications', {
        phase: 'knowledge_share_notification_prepare',
        errorClass: 'notification_failure',
      });
    }
  }

  async openSource(
    input: Parameters<KnowledgeShareStorePort['openSource']>[0],
  ) {
    return this.host.$transaction(
      async (transaction) => {
        const share = await transaction.knowledgeShare.findFirst({
          where: {
            id: input.shareId,
            status: 'posted',
            revokedAt: null,
          },
          select: {
            sourceKnowledgeItemId: true,
            destinationRoomId: true,
          },
        });
        if (!share) return failure(404, 'not_found');
        const roomAccess = await ensureChatRoomContentAccess({
          roomId: share.destinationRoomId,
          userId: input.chatActor.userId,
          roles: input.chatActor.roles,
          projectIds: input.chatActor.projectIds,
          groupIds: input.chatActor.groupIds,
          groupAccountIds: input.chatActor.groupAccountIds,
          accessLevel: 'read',
          client: transaction as unknown as typeof prisma,
        });
        if (!roomAccess.ok) return failure(404, 'not_found');
        const destinationProjectId = projectIdForCurrentMembership(
          roomAccess.room,
        );
        if (
          !(await hasCurrentProjectMembership(
            transaction,
            input.chatActor,
            destinationProjectId,
          ))
        ) {
          return failure(404, 'not_found');
        }
        const item = await transaction.knowledgeItem.findFirst({
          where: {
            AND: [
              { id: share.sourceKnowledgeItemId },
              buildKnowledgeVisibilityWhere(input.actor),
            ],
          },
          select: { id: true },
        });
        return item
          ? success({ knowledgeItemId: item.id })
          : failure(404, 'not_found');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

export function createPrismaKnowledgeShareAdapter(
  host: ShareTransactionHost = prisma as PrismaClient,
) {
  return new PrismaKnowledgeShareAdapter(host);
}

export const prismaKnowledgeShareAdapter =
  createPrismaKnowledgeShareAdapter(prisma);
