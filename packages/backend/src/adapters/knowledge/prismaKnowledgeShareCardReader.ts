import { Prisma, type PrismaClient } from '@prisma/client';

import {
  knowledgeShareSelectionCategories,
  type KnowledgeShareCardSnapshot,
  type KnowledgeSharePortResult,
  type KnowledgeShareRoomCardRecord,
  type KnowledgeShareSelection,
  type KnowledgeShareStorePort,
} from '../../application/knowledge/knowledgeSharePorts.js';
import {
  ensureChatRoomContentAccess,
  hasActiveChatProject,
} from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';
import {
  safeCanonicalUrl,
  strictQuestions,
} from './knowledgeShareSanitizers.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';

const lowercaseSha256Pattern = /^[0-9a-f]{64}$/;

type ShareTransactionHost = Pick<PrismaClient, '$transaction'>;
type RoomCardInput = Parameters<KnowledgeShareStorePort['readRoomCard']>[0];

const shareCardDetailInclude = Prisma.validator<Prisma.KnowledgeShareInclude>()(
  {
    snapshot: true,
    labels: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
    annotations: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
    turns: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
    syntheses: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
  },
);

type ShareCardDetail = Prisma.KnowledgeShareGetPayload<{
  include: typeof shareCardDetailInclude;
}>;

function success<T>(value: T): KnowledgeSharePortResult<T> {
  return { ok: true, value };
}

function notFound(): KnowledgeSharePortResult<never> {
  return {
    ok: false,
    error: { status: 404, code: 'not_found', message: 'Not found' },
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

function selectionForShare(share: ShareCardDetail): KnowledgeShareSelection {
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

function storedRoomCard(
  share: ShareCardDetail,
): KnowledgeShareCardSnapshot | null {
  if (share.selectionSchemaVersion !== 1) return null;
  const selected = selectedCategories(selectionForShare(share));
  const omitted = knowledgeShareSelectionCategories.filter(
    (category) => !selected.includes(category),
  );
  const canonicalUrl =
    share.selectedCanonicalUrl === null
      ? undefined
      : safeCanonicalUrl(share.selectedCanonicalUrl);
  if (share.selectedCanonicalUrl !== null && canonicalUrl === undefined) {
    return null;
  }
  if (
    share.snapshot &&
    !lowercaseSha256Pattern.test(share.snapshot.sourceSha256)
  ) {
    return null;
  }
  const syntheses: KnowledgeShareCardSnapshot['syntheses'] = [];
  for (const entry of share.syntheses) {
    const unresolvedQuestions = strictQuestions(entry.unresolvedQuestions);
    if (!unresolvedQuestions) return null;
    syntheses.push({
      sourceSynthesisId: entry.sourceSynthesisId,
      sourceSynthesisVersionId: entry.sourceSynthesisVersionId,
      version: entry.version,
      title: entry.title,
      content: entry.content,
      confidenceBasisPoints: entry.confidenceBasisPoints,
      unresolvedQuestions,
      ordinal: entry.ordinal,
      contentHash: entry.contentHash,
    });
  }
  return {
    schemaVersion: 1,
    ...(share.selectedTitle === null ? {} : { title: share.selectedTitle }),
    ...(share.selectedSourceType === null
      ? {}
      : { sourceType: share.selectedSourceType }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(share.snapshot
      ? {
          snapshot: {
            sourceSnapshotId: share.snapshot.sourceSnapshotId,
            version: share.snapshot.sourceSnapshotVersion,
            sha256: share.snapshot.sourceSha256,
            ...(share.snapshot.excerptSelected &&
            share.snapshot.excerpt !== null
              ? { excerpt: share.snapshot.excerpt }
              : {}),
          },
        }
      : {}),
    ...(share.selectedSharerNote === null
      ? {}
      : { sharerNote: share.selectedSharerNote }),
    labels: share.labels.map((entry) => ({
      sourceAssignmentId: entry.sourceAssignmentId,
      sourceLabelId: entry.sourceLabelId,
      sourceLabelVersion: entry.sourceLabelVersion,
      displayName: entry.displayName,
      ordinal: entry.ordinal,
      contentHash: entry.contentHash,
    })),
    annotations: share.annotations.map((entry) => ({
      sourceAnnotationId: entry.sourceAnnotationId,
      sourceRevisionId: entry.sourceRevisionId,
      revision: entry.revision,
      kind: entry.kind,
      origin: entry.origin,
      content: entry.content,
      ordinal: entry.ordinal,
      contentHash: entry.contentHash,
    })),
    turns: share.turns.map((entry) => ({
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
    })),
    syntheses,
    selectedCategories: selected,
    omittedCategories: omitted,
    contentHash: share.contentHash,
  };
}

export async function readPrismaKnowledgeShareRoomCard(
  host: ShareTransactionHost,
  input: RoomCardInput,
): Promise<KnowledgeSharePortResult<KnowledgeShareRoomCardRecord>> {
  return host.$transaction(
    async (transaction) => {
      const header = await transaction.knowledgeShare.findFirst({
        where: {
          chatMessageId: input.messageId,
          status: { in: ['posted', 'revoked'] },
          chatMessage: {
            is: {
              id: input.messageId,
              parentMessageId: null,
              threadRootId: null,
              deletedAt: null,
            },
          },
        },
        select: {
          id: true,
          status: true,
          version: true,
          selectionSchemaVersion: true,
          sourceKnowledgeItemId: true,
          destinationRoomId: true,
        },
      });
      if (
        !header ||
        (header.status !== 'posted' && header.status !== 'revoked') ||
        header.selectionSchemaVersion !== 1
      ) {
        return notFound();
      }
      const roomAccess = await ensureChatRoomContentAccess({
        roomId: header.destinationRoomId,
        userId: input.chatActor.userId,
        roles: input.chatActor.roles,
        projectIds: input.chatActor.projectIds,
        groupIds: input.chatActor.groupIds,
        groupAccountIds: input.chatActor.groupAccountIds,
        accessLevel: 'read',
        client: transaction as unknown as typeof prisma,
      });
      if (
        !roomAccess.ok ||
        roomAccess.room.allowExternalUsers ||
        !(await hasActiveChatProject({
          room: roomAccess.room,
          client: transaction as unknown as typeof prisma,
        }))
      ) {
        return notFound();
      }
      if (header.status === 'revoked') {
        return success({
          shareId: header.id,
          status: 'revoked',
          version: header.version,
          schemaVersion: 1,
          card: null,
          canOpenSource: false,
        });
      }

      const share = await transaction.knowledgeShare.findFirst({
        where: {
          id: header.id,
          chatMessageId: input.messageId,
          destinationRoomId: header.destinationRoomId,
          status: 'posted',
          revokedAt: null,
        },
        include: shareCardDetailInclude,
      });
      if (!share) return notFound();
      const card = storedRoomCard(share);
      if (!card) return notFound();
      const source = await transaction.knowledgeItem.findFirst({
        where: {
          AND: [
            { id: share.sourceKnowledgeItemId },
            buildKnowledgeVisibilityWhere(input.actor),
          ],
        },
        select: { id: true },
      });
      return success({
        shareId: share.id,
        status: 'posted',
        version: share.version,
        schemaVersion: 1,
        card,
        canOpenSource: source !== null,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function openPrismaKnowledgeShareSource(
  host: ShareTransactionHost,
  input: Parameters<KnowledgeShareStorePort['openSource']>[0],
) {
  return host.$transaction(
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
      if (!share) return notFound();
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
      if (!roomAccess.ok) return notFound();
      if (roomAccess.room.allowExternalUsers) return notFound();
      if (
        !(await hasActiveChatProject({
          room: roomAccess.room,
          client: transaction as unknown as typeof prisma,
        }))
      ) {
        return notFound();
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
      return item ? success({ knowledgeItemId: item.id }) : notFound();
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
