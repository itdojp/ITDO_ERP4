import { Prisma, type PrismaClient } from '@prisma/client';
import {
  isKnowledgeDeletionReasonCode,
  knowledgeMutableFields,
  type KnowledgeActor,
  type KnowledgeAuditEntry,
  type KnowledgeAuditWriter,
  type KnowledgeDeletionReasonCode,
  type KnowledgeItem,
  type KnowledgeItemCreateRecord,
  type KnowledgeItemReadRepository,
  type KnowledgeItemUpdateRecord,
  type KnowledgeItemWriteRepository,
  type KnowledgeListQuery,
  type KnowledgeTransaction,
  type KnowledgeUnitOfWork,
} from '../../application/knowledge/knowledgeItemPorts.js';
import { prisma } from '../../services/db.js';

type KnowledgeDbClient = Pick<
  Prisma.TransactionClient,
  'knowledgeItem' | 'groupAccount' | 'auditLog'
>;

type KnowledgeTransactionHost = {
  $transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
};

function mapKnowledgeItem(
  row: Prisma.KnowledgeItemGetPayload<Record<string, never>>,
): KnowledgeItem {
  if (
    row.deletedReason !== null &&
    !isKnowledgeDeletionReasonCode(row.deletedReason)
  ) {
    throw new Error('knowledge_deletion_reason_code_invalid');
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    scope: row.scope,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    sourceAuthor: row.sourceAuthor,
    publishedAt: row.publishedAt,
    capturedAt: row.capturedAt,
    saveReason: row.saveReason,
    shortNote: row.shortNote,
    unresolvedQuestion: row.unresolvedQuestion,
    status: row.status,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedReason: row.deletedReason,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export function buildKnowledgeVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeItemWhereInput {
  const ownerUserId = actor.userId.trim();
  if (!ownerUserId) {
    return {
      deletedAt: null,
      AND: [
        { id: '__knowledge_missing_principal__' },
        { NOT: { id: '__knowledge_missing_principal__' } },
      ],
    };
  }
  const groups = [
    ...new Set(
      actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  const organizationId = actor.organizationId?.trim();
  const visible: Prisma.KnowledgeItemWhereInput[] = [{ ownerUserId }];
  if (organizationId && groups.length > 0) {
    visible.push({
      scope: 'organization',
      organizationId,
      groupGrants: {
        some: {
          groupAccountId: { in: groups },
          groupAccount: { active: true },
        },
      },
    });
  }
  return { deletedAt: null, OR: visible };
}

export class PrismaKnowledgeItemRepository
  implements KnowledgeItemReadRepository, KnowledgeItemWriteRepository
{
  constructor(private readonly client: KnowledgeDbClient = prisma) {}

  async listVisible(actor: KnowledgeActor, query: KnowledgeListQuery) {
    const rows = await this.client.knowledgeItem.findMany({
      where: {
        AND: [
          buildKnowledgeVisibilityWhere(actor),
          query.scope ? { scope: query.scope } : {},
          query.status ? { status: query.status } : {},
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(mapKnowledgeItem);
  }

  async countVisible(
    actor: KnowledgeActor,
    filters: Pick<KnowledgeListQuery, 'scope' | 'status'>,
  ) {
    return this.client.knowledgeItem.count({
      where: {
        AND: [
          buildKnowledgeVisibilityWhere(actor),
          filters.scope ? { scope: filters.scope } : {},
          filters.status ? { status: filters.status } : {},
        ],
      },
    });
  }

  async findVisibleById(actor: KnowledgeActor, itemId: string) {
    const row = await this.client.knowledgeItem.findFirst({
      where: { AND: [{ id: itemId }, buildKnowledgeVisibilityWhere(actor)] },
    });
    return row ? mapKnowledgeItem(row) : null;
  }

  async countActiveGroups(groupAccountIds: string[]) {
    return this.client.groupAccount.count({
      where: { id: { in: groupAccountIds }, active: true },
    });
  }

  async create(input: KnowledgeItemCreateRecord) {
    const row = await this.client.knowledgeItem.create({
      data: {
        ownerUserId: input.ownerUserId,
        scope: input.scope,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        sourceAuthor: input.sourceAuthor,
        publishedAt: input.publishedAt,
        capturedAt: input.capturedAt,
        saveReason: input.saveReason,
        shortNote: input.shortNote,
        unresolvedQuestion: input.unresolvedQuestion,
        status: input.status,
        createdBy: input.createdBy,
        updatedBy: input.updatedBy,
        groupGrants: {
          create: input.groupAccountIds.map((groupAccountId) => ({
            groupAccountId,
            createdBy: input.createdBy,
          })),
        },
      },
    });
    return mapKnowledgeItem(row);
  }

  async findOwnedForMutation(input: {
    actor: KnowledgeActor;
    itemId: string;
    deleted: boolean;
  }) {
    const row = await this.client.knowledgeItem.findFirst({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        deletedAt: input.deleted ? { not: null } : null,
      },
    });
    return row ? mapKnowledgeItem(row) : null;
  }

  async updateOwnedVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    expectedVersion: number;
    patch: KnowledgeItemUpdateRecord;
  }) {
    const result = await this.client.knowledgeItem.updateMany({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        ...input.patch,
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (result.count !== 1) return null;
    const row = await this.client.knowledgeItem.findUnique({
      where: { id: input.itemId },
    });
    return row ? mapKnowledgeItem(row) : null;
  }

  async deleteOwnedVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    expectedVersion: number;
    deletedAt: Date;
    reasonCode: KnowledgeDeletionReasonCode;
  }) {
    if (!isKnowledgeDeletionReasonCode(input.reasonCode)) {
      throw new Error('knowledge_deletion_reason_code_invalid');
    }
    const result = await this.client.knowledgeItem.updateMany({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        deletedAt: input.deletedAt,
        deletedReason: input.reasonCode,
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (result.count !== 1) return null;
    const row = await this.client.knowledgeItem.findUnique({
      where: { id: input.itemId },
    });
    return row ? mapKnowledgeItem(row) : null;
  }

  async restoreOwnedVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    expectedVersion: number;
  }) {
    const result = await this.client.knowledgeItem.updateMany({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: { not: null },
      },
      data: {
        deletedAt: null,
        deletedReason: null,
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (result.count !== 1) return null;
    const row = await this.client.knowledgeItem.findUnique({
      where: { id: input.itemId },
    });
    return row ? mapKnowledgeItem(row) : null;
  }
}

function bounded(value: string | undefined, maximum: number) {
  if (!value) return undefined;
  return value.slice(0, maximum);
}

const knowledgeAuditRequestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

function safeKnowledgeAuditRequestId(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  return knowledgeAuditRequestIdPattern.test(normalized)
    ? normalized
    : undefined;
}

function boundedScopes(values: string[] | undefined) {
  if (!values) return [];
  return [
    ...new Set(
      values
        .map((value) => value.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 64),
    ),
  ];
}

export class PrismaKnowledgeAuditWriter implements KnowledgeAuditWriter {
  constructor(private readonly client: Pick<KnowledgeDbClient, 'auditLog'>) {}

  async write(entry: KnowledgeAuditEntry) {
    const reasonCode = (() => {
      if (entry.action === 'knowledge_item_deleted') {
        if (!isKnowledgeDeletionReasonCode(entry.reasonCode)) {
          throw new Error('knowledge_audit_reason_code_invalid');
        }
        return entry.reasonCode;
      }
      if (entry.reasonCode !== undefined) {
        throw new Error('knowledge_audit_reason_code_invalid');
      }
      return undefined;
    })();
    const changedFields = entry.metadata.changedFields?.filter((field) =>
      knowledgeMutableFields.includes(field),
    );
    const principalUserId = bounded(entry.actor.principalUserId, 255);
    const actorUserId = bounded(entry.actor.actorUserId, 255);
    const authScopes = boundedScopes(entry.actor.authScopes);
    const authProvenance: Prisma.InputJsonObject = {
      ...(principalUserId ? { principalUserId } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(authScopes.length > 0 ? { scopes: authScopes } : {}),
    };
    const metadata: Prisma.InputJsonObject = {
      scope: entry.metadata.scope,
      status: entry.metadata.status,
      version: entry.metadata.version,
      ...(changedFields && changedFields.length > 0 ? { changedFields } : {}),
      ...(Object.keys(authProvenance).length > 0
        ? { _auth: authProvenance }
        : {}),
    };
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: bounded(entry.actor.userId, 255),
        actorRole: bounded(entry.actor.actorRole, 100),
        actorGroupId: bounded(entry.actor.actorGroupId, 255),
        requestId: safeKnowledgeAuditRequestId(entry.actor.requestId),
        ipAddress: bounded(entry.actor.ipAddress, 255),
        source: bounded(entry.actor.source, 100),
        reasonCode,
        targetTable: 'knowledge_items',
        targetId: entry.targetId,
        metadata,
      },
    });
  }
}

export class PrismaKnowledgeUnitOfWork implements KnowledgeUnitOfWork {
  constructor(
    private readonly host: KnowledgeTransactionHost = prisma as PrismaClient,
  ) {}

  async run<T>(work: (transaction: KnowledgeTransaction) => Promise<T>) {
    return this.host.$transaction(async (client) =>
      work({
        items: new PrismaKnowledgeItemRepository(client),
        audit: new PrismaKnowledgeAuditWriter(client),
      }),
    );
  }
}

export const prismaKnowledgeItemRepository = new PrismaKnowledgeItemRepository(
  prisma,
);
export const prismaKnowledgeUnitOfWork = new PrismaKnowledgeUnitOfWork(prisma);
