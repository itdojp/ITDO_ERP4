import { Prisma } from '@prisma/client';
import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import {
  knowledgeSavedViewLimits,
  type KnowledgeSavedView,
  type KnowledgeSavedViewAuditWriter,
  type KnowledgeSavedViewListQuery,
  type KnowledgeSavedViewReadRepository,
  type KnowledgeSavedViewTransaction,
  KnowledgeSavedViewTransactionConflictError,
  type KnowledgeSavedViewUnitOfWork,
  type KnowledgeSavedViewWriteRepository,
} from '../../application/knowledge/knowledgeSavedViewPorts.js';
import {
  knowledgeSearchLimits,
  knowledgeSearchOperators,
  type KnowledgeCanonicalSearchFilter,
} from '../../application/knowledge/knowledgeSearchPorts.js';
import { prisma } from '../../services/db.js';
import { buildKnowledgeLabelVisibilityWhere } from './prismaKnowledgeLabelAdapter.js';

type SavedViewRow = Prisma.KnowledgeSavedViewGetPayload<{
  include: { labelFilters: true };
}>;

type KnowledgeSavedViewDbClient = Pick<
  Prisma.TransactionClient,
  | 'knowledgeSavedView'
  | 'knowledgeSavedViewLabelFilter'
  | 'knowledgeLabel'
  | 'knowledgeLabelPath'
  | 'auditLog'
>;

type KnowledgeSavedViewTransactionHost = {
  $transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

const serializableTransactionAttempts = 3;

function isRetryableTransactionConflict(
  error: unknown,
): error is { code: string } {
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

function mapView(row: SavedViewRow): KnowledgeSavedView {
  const labels: KnowledgeCanonicalSearchFilter['labels'] = {
    any: [],
    all: [],
    not: [],
  };
  for (const labelFilter of row.labelFilters) {
    labels[labelFilter.operator].push({
      id: labelFilter.labelId,
      includeDescendants: labelFilter.includeDescendants,
    });
  }
  for (const operator of knowledgeSearchOperators) {
    labels[operator].sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    filter: {
      labels,
      sourceType: row.sourceType ?? undefined,
      status: row.status ?? undefined,
      scope: row.scope ?? undefined,
      publishedFrom: row.publishedFrom ?? undefined,
      publishedTo: row.publishedTo ?? undefined,
      capturedFrom: row.capturedFrom ?? undefined,
      capturedTo: row.capturedTo ?? undefined,
    },
    schemaVersion: row.schemaVersion,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function labelRows(filter: KnowledgeCanonicalSearchFilter) {
  return knowledgeSearchOperators.flatMap((operator) =>
    filter.labels[operator].map((root) => ({
      labelId: root.id,
      operator,
      includeDescendants: root.includeDescendants,
    })),
  );
}

async function filterIsCurrentlyValid(
  client: Pick<
    KnowledgeSavedViewDbClient,
    'knowledgeLabel' | 'knowledgeLabelPath'
  >,
  actor: KnowledgeActor,
  filter: KnowledgeCanonicalSearchFilter,
) {
  const ids = [...new Set(labelRows(filter).map((row) => row.labelId))];
  if (ids.length === 0) return true;
  const visibleRoots = await client.knowledgeLabel.findMany({
    where: {
      AND: [{ id: { in: ids } }, buildKnowledgeLabelVisibilityWhere(actor)],
    },
    select: { id: true },
  });
  if (visibleRoots.length !== ids.length) return false;

  const descendantRootIds = labelRows(filter)
    .filter((row) => row.includeDescendants)
    .map((row) => row.labelId);
  if (descendantRootIds.length === 0) {
    return ids.length <= knowledgeSearchLimits.expandedLabelIds;
  }
  const paths = await client.knowledgeLabelPath.findMany({
    where: {
      ancestorId: { in: descendantRootIds },
      depth: { lte: 8 },
      descendant: buildKnowledgeLabelVisibilityWhere(actor),
    },
    select: { ancestorId: true, descendantId: true, depth: true },
  });
  for (const rootId of descendantRootIds) {
    if (
      !paths.some(
        (path) =>
          path.ancestorId === rootId &&
          path.descendantId === rootId &&
          path.depth === 0,
      )
    ) {
      return false;
    }
  }
  const expandedIds = new Set([
    ...ids.filter((id) => !descendantRootIds.includes(id)),
    ...paths.map((path) => path.descendantId),
  ]);
  return expandedIds.size <= knowledgeSearchLimits.expandedLabelIds;
}

function scalarData(filter: KnowledgeCanonicalSearchFilter) {
  return {
    sourceType: filter.sourceType ?? null,
    status: filter.status ?? null,
    scope: filter.scope ?? null,
    publishedFrom: filter.publishedFrom ?? null,
    publishedTo: filter.publishedTo ?? null,
    capturedFrom: filter.capturedFrom ?? null,
    capturedTo: filter.capturedTo ?? null,
  };
}

export class PrismaKnowledgeSavedViewRepository
  implements KnowledgeSavedViewReadRepository, KnowledgeSavedViewWriteRepository
{
  constructor(private readonly client: KnowledgeSavedViewDbClient = prisma) {}

  async listOwned(actor: KnowledgeActor, query: KnowledgeSavedViewListQuery) {
    const rows = await this.client.knowledgeSavedView.findMany({
      where: { ownerUserId: actor.userId, deletedAt: null },
      include: { labelFilters: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(mapView);
  }

  async findOwnedById(actor: KnowledgeActor, savedViewId: string) {
    const row = await this.client.knowledgeSavedView.findFirst({
      where: {
        id: savedViewId,
        ownerUserId: actor.userId,
        deletedAt: null,
      },
      include: { labelFilters: true },
    });
    return row ? mapView(row) : null;
  }

  async listOwnedRecoveryMetadata(
    actor: KnowledgeActor,
    query: KnowledgeSavedViewListQuery,
  ) {
    return this.client.knowledgeSavedView.findMany({
      where: { ownerUserId: actor.userId, deletedAt: null },
      select: { id: true, name: true, version: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    });
  }

  async create(
    input: Parameters<KnowledgeSavedViewWriteRepository['create']>[0],
  ) {
    if (
      !(await filterIsCurrentlyValid(this.client, input.actor, input.filter))
    ) {
      return { ok: false as const, reason: 'invalid_labels' as const };
    }
    const row = await this.client.knowledgeSavedView.create({
      data: {
        ownerUserId: input.actor.userId,
        name: input.name,
        ...scalarData(input.filter),
        schemaVersion: knowledgeSavedViewLimits.schemaVersion,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
        labelFilters: { create: labelRows(input.filter) },
      },
      include: { labelFilters: true },
    });
    return { ok: true as const, value: mapView(row) };
  }

  async updateOwnedVersioned(
    input: Parameters<
      KnowledgeSavedViewWriteRepository['updateOwnedVersioned']
    >[0],
  ) {
    const current = await this.client.knowledgeSavedView.findFirst({
      where: {
        id: input.savedViewId,
        ownerUserId: input.actor.userId,
        deletedAt: null,
      },
      select: { version: true },
    });
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (current.version !== input.expectedVersion) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    if (
      !(await filterIsCurrentlyValid(this.client, input.actor, input.filter))
    ) {
      return { ok: false as const, reason: 'invalid_labels' as const };
    }
    const updated = await this.client.knowledgeSavedView.updateMany({
      where: {
        id: input.savedViewId,
        ownerUserId: input.actor.userId,
        deletedAt: null,
        version: input.expectedVersion,
      },
      data: {
        name: input.name,
        ...scalarData(input.filter),
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    await this.client.knowledgeSavedViewLabelFilter.deleteMany({
      where: { savedViewId: input.savedViewId },
    });
    const filters = labelRows(input.filter);
    if (filters.length > 0) {
      await this.client.knowledgeSavedViewLabelFilter.createMany({
        data: filters.map((filter) => ({
          savedViewId: input.savedViewId,
          ...filter,
        })),
      });
    }
    const row = await this.client.knowledgeSavedView.findUniqueOrThrow({
      where: { id: input.savedViewId },
      include: { labelFilters: true },
    });
    return { ok: true as const, value: mapView(row) };
  }

  async deleteOwnedVersioned(
    input: Parameters<
      KnowledgeSavedViewWriteRepository['deleteOwnedVersioned']
    >[0],
  ) {
    const current = await this.client.knowledgeSavedView.findFirst({
      where: {
        id: input.savedViewId,
        ownerUserId: input.actor.userId,
        deletedAt: null,
      },
      select: { version: true },
    });
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (current.version !== input.expectedVersion) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const updated = await this.client.knowledgeSavedView.updateMany({
      where: {
        id: input.savedViewId,
        ownerUserId: input.actor.userId,
        deletedAt: null,
        version: input.expectedVersion,
      },
      data: {
        deletedAt: input.deletedAt,
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const row = await this.client.knowledgeSavedView.findUniqueOrThrow({
      where: { id: input.savedViewId },
      include: { labelFilters: true },
    });
    return { ok: true as const, value: mapView(row) };
  }
}

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export class PrismaKnowledgeSavedViewAuditWriter implements KnowledgeSavedViewAuditWriter {
  constructor(
    private readonly client: Pick<KnowledgeSavedViewDbClient, 'auditLog'>,
  ) {}

  async write(entry: Parameters<KnowledgeSavedViewAuditWriter['write']>[0]) {
    const requestId = entry.actor.requestId?.trim();
    const source =
      entry.actor.source === 'api' || entry.actor.source === 'agent'
        ? entry.actor.source
        : undefined;
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.actor.userId.slice(0, 255),
        targetTable: 'knowledge_saved_views',
        targetId: entry.targetId,
        requestId:
          requestId && requestIdPattern.test(requestId) ? requestId : undefined,
        source,
        metadata: {
          targetKind: 'saved_view',
          schemaVersion: entry.schemaVersion,
          version: entry.version,
        } satisfies Prisma.InputJsonObject,
      },
    });
  }
}

export class PrismaKnowledgeSavedViewUnitOfWork implements KnowledgeSavedViewUnitOfWork {
  constructor(
    private readonly host: KnowledgeSavedViewTransactionHost = prisma,
  ) {}

  async run<T>(
    work: (transaction: KnowledgeSavedViewTransaction) => Promise<T>,
  ) {
    for (
      let attempt = 1;
      attempt <= serializableTransactionAttempts;
      attempt += 1
    ) {
      try {
        return await this.host.$transaction(
          async (client) =>
            work({
              savedViews: new PrismaKnowledgeSavedViewRepository(client),
              audit: new PrismaKnowledgeSavedViewAuditWriter(client),
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryableTransactionConflict(error)) throw error;
        if (attempt === serializableTransactionAttempts) {
          throw new KnowledgeSavedViewTransactionConflictError();
        }
      }
    }
    throw new Error('knowledge_saved_view_transaction_retry_exhausted');
  }
}

export const prismaKnowledgeSavedViewRepository =
  new PrismaKnowledgeSavedViewRepository();
export const prismaKnowledgeSavedViewUnitOfWork =
  new PrismaKnowledgeSavedViewUnitOfWork();
