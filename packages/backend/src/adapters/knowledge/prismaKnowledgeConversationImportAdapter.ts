import { Prisma, type PrismaClient } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import {
  KnowledgeConversationImportConflictError,
  type CanonicalKnowledgeConversationImport,
  type KnowledgeConversationImportRepository,
  type KnowledgeConversationImportRequestRecord,
  type KnowledgeConversationImportTransaction,
  type KnowledgeConversationImportUnitOfWork,
} from '../../application/knowledge/knowledgeConversationImportPorts.js';
import { sha256KnowledgeText } from '../../application/knowledge/knowledgeProvenanceValidation.js';
import { prisma } from '../../services/db.js';
import { PrismaKnowledgeProvenanceAuditWriter } from './prismaKnowledgeProvenanceAuditAdapter.js';

type ImportClient = Pick<
  Prisma.TransactionClient,
  | '$queryRaw'
  | 'knowledgeConversation'
  | 'knowledgeConversationImportRequest'
  | 'knowledgeItem'
>;

type TransactionHost = {
  $transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

function isRetryableImportConflict(error: unknown) {
  if (error instanceof KnowledgeConversationImportConflictError) return true;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  if (error.code === 'P2002' || error.code === 'P2034') return true;
  if (error.code !== 'P2010' || !('meta' in error)) return false;
  const meta = error.meta;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('driverAdapterError' in meta)
  ) {
    return false;
  }
  const driverAdapterError = meta.driverAdapterError;
  if (
    typeof driverAdapterError !== 'object' ||
    driverAdapterError === null ||
    !('cause' in driverAdapterError)
  ) {
    return false;
  }
  const cause = driverAdapterError.cause;
  if (typeof cause !== 'object' || cause === null) return false;
  const sqlState =
    ('originalCode' in cause && cause.originalCode) ||
    ('code' in cause && cause.code);
  return sqlState === '40001' || sqlState === '40P01';
}

const importRequestInclude = {
  conversation: {
    select: {
      deletedAt: true,
      sourceType: true,
      contentHash: true,
      _count: { select: { turns: true, items: true } },
    },
  },
} as const;

type ImportRequestRow = Prisma.KnowledgeConversationImportRequestGetPayload<{
  include: typeof importRequestInclude;
}>;

function mapRequest(
  row: ImportRequestRow,
): KnowledgeConversationImportRequestRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    requestKeyHash: row.requestKeyHash,
    canonicalPayloadHash: row.canonicalPayloadHash,
    sourceType: row.sourceType,
    conversationId: row.conversationId,
    turnCount: row.conversation._count.turns,
    linkedItemCount: row.conversation._count.items,
    conversationDeleted: row.conversation.deletedAt !== null,
  };
}

export class PrismaKnowledgeConversationImportRepository implements KnowledgeConversationImportRepository {
  constructor(private readonly client: ImportClient) {}

  async checkOwnedItems(input: {
    actor: KnowledgeActor;
    itemIds: string[];
  }): Promise<boolean> {
    if (input.itemIds.length === 0) return true;
    const sorted = [...new Set(input.itemIds)].sort();
    if (sorted.length !== input.itemIds.length) return false;
    const rows = await this.client.knowledgeItem.findMany({
      where: {
        id: { in: sorted },
        ownerUserId: input.actor.userId,
        deletedAt: null,
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return (
      rows.length === sorted.length &&
      rows.every((row, index) => row.id === sorted[index])
    );
  }

  async lockOwnedItems(input: {
    actor: KnowledgeActor;
    itemIds: string[];
  }): Promise<boolean> {
    if (input.itemIds.length === 0) return true;
    const sorted = [...new Set(input.itemIds)].sort();
    if (sorted.length !== input.itemIds.length) return false;
    const rows = await this.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"::text AS "id"
        FROM "KnowledgeItem"
        WHERE "ownerUserId" = ${input.actor.userId}
          AND "deletedAt" IS NULL
          AND "id"::text IN (${Prisma.join(sorted)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
    return (
      rows.length === sorted.length &&
      rows.every((row, index) => row.id === sorted[index])
    );
  }

  async findRequest(input: { actor: KnowledgeActor; requestKeyHash: string }) {
    const row = await this.client.knowledgeConversationImportRequest.findUnique(
      {
        where: {
          ownerUserId_requestKeyHash: {
            ownerUserId: input.actor.userId,
            requestKeyHash: input.requestKeyHash,
          },
        },
        include: importRequestInclude,
      },
    );
    return row ? mapRequest(row) : null;
  }

  async findConversationByPayload(input: {
    actor: KnowledgeActor;
    canonicalPayloadHash: string;
  }) {
    const conversation = await this.client.knowledgeConversation.findUnique({
      where: {
        ownerUserId_idempotencyHash: {
          ownerUserId: input.actor.userId,
          idempotencyHash: input.canonicalPayloadHash,
        },
      },
      select: {
        id: true,
        ownerUserId: true,
        sourceType: true,
        contentHash: true,
        deletedAt: true,
        importRequests: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: {
            id: true,
            requestKeyHash: true,
            canonicalPayloadHash: true,
          },
        },
        _count: { select: { turns: true, items: true } },
      },
    });
    if (!conversation) return null;
    const request = conversation.importRequests[0];
    return {
      id: request?.id ?? conversation.id,
      ownerUserId: conversation.ownerUserId,
      requestKeyHash: request?.requestKeyHash ?? '',
      canonicalPayloadHash:
        request?.canonicalPayloadHash ?? conversation.contentHash,
      sourceType: conversation.sourceType,
      conversationId: conversation.id,
      turnCount: conversation._count.turns,
      linkedItemCount: conversation._count.items,
      conversationDeleted: conversation.deletedAt !== null,
    } satisfies KnowledgeConversationImportRequestRecord;
  }

  async createImportedConversation(input: {
    actor: KnowledgeActor;
    ledgerId: string;
    conversationId: string;
    itemIds: string[];
    turnIds: string[];
    requestKeyHash: string;
    canonical: CanonicalKnowledgeConversationImport;
    importedAt: Date;
  }) {
    const row = await this.client.knowledgeConversation.create({
      data: {
        id: input.conversationId,
        ownerUserId: input.actor.userId,
        title: input.canonical.title,
        sourceType: input.canonical.format,
        provider: input.canonical.provider,
        model: input.canonical.model,
        capturedAt: input.importedAt,
        importedAt: input.importedAt,
        contentHash: sha256KnowledgeText(
          'conversation-import-content',
          JSON.stringify({
            title: input.canonical.title,
            format: input.canonical.format,
            provider: input.canonical.provider,
            model: input.canonical.model,
            turns: input.canonical.turns,
          }),
        ),
        idempotencyHash: input.canonical.canonicalPayloadHash,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
        items: {
          create: input.canonical.linkedItems.map((item, index) => ({
            id: input.itemIds[index],
            knowledgeItemId: item.itemId,
            relationType: item.relationType,
            ordinal: item.ordinal,
            createdBy: input.actor.userId,
          })),
        },
        turns: {
          create: input.canonical.turns.map((turn, index) => ({
            id: input.turnIds[index],
            sequence: index + 1,
            role: turn.role,
            origin: turn.origin,
            content: turn.content,
            name: turn.name,
            occurredAt: turn.occurredAt ? new Date(turn.occurredAt) : null,
            contentHash: sha256KnowledgeText('conversation-turn', turn.content),
            createdBy: input.actor.userId,
          })),
        },
        importRequests: {
          create: {
            id: input.ledgerId,
            requestKeyHash: input.requestKeyHash,
            canonicalPayloadHash: input.canonical.canonicalPayloadHash,
            sourceType: input.canonical.format,
            createdBy: input.actor.userId,
          },
        },
      },
      include: {
        importRequests: {
          where: { id: input.ledgerId },
          include: importRequestInclude,
        },
      },
    });
    const request = row.importRequests[0];
    if (!request) throw new Error('knowledge_import_request_missing');
    return mapRequest(request);
  }

  async bindRequestToConversation(input: {
    actor: KnowledgeActor;
    ledgerId: string;
    requestKeyHash: string;
    canonical: CanonicalKnowledgeConversationImport;
    conversationId: string;
  }) {
    const row = await this.client.knowledgeConversationImportRequest.create({
      data: {
        id: input.ledgerId,
        ownerUserId: input.actor.userId,
        requestKeyHash: input.requestKeyHash,
        canonicalPayloadHash: input.canonical.canonicalPayloadHash,
        sourceType: input.canonical.format,
        conversationId: input.conversationId,
        createdBy: input.actor.userId,
      },
      include: importRequestInclude,
    });
    return mapRequest(row);
  }
}

export class PrismaKnowledgeConversationImportUnitOfWork implements KnowledgeConversationImportUnitOfWork {
  constructor(
    private readonly host: TransactionHost = prisma as PrismaClient,
  ) {}

  async run<T>(
    work: (transaction: KnowledgeConversationImportTransaction) => Promise<T>,
  ) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.host.$transaction(
          async (client) =>
            work({
              imports: new PrismaKnowledgeConversationImportRepository(client),
              audit: new PrismaKnowledgeProvenanceAuditWriter(client),
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryableImportConflict(error)) throw error;
        if (attempt === 3) {
          throw new KnowledgeConversationImportConflictError();
        }
      }
    }
    throw new KnowledgeConversationImportConflictError();
  }
}

export const prismaKnowledgeConversationImportUnitOfWork =
  new PrismaKnowledgeConversationImportUnitOfWork(prisma);
