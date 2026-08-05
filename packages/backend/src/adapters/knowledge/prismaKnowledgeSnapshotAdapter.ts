import { Prisma } from '@prisma/client';

import {
  knowledgeSnapshotCaptureMethods,
  knowledgeSnapshotStatuses,
  KnowledgeSnapshotTransactionConflictError,
  type KnowledgeSnapshot,
  type KnowledgeSnapshotAuditEntry,
  type KnowledgeSnapshotAuditWriter,
  type KnowledgeSnapshotReadRepository,
  type KnowledgeSnapshotTransaction,
  type KnowledgeSnapshotUnitOfWork,
  type KnowledgeSnapshotWriteRepository,
} from '../../application/knowledge/knowledgeSnapshotPorts.js';
import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import { prisma } from '../../services/db.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';

type SnapshotRow = Prisma.KnowledgeSnapshotGetPayload<Record<string, never>>;

type KnowledgeSnapshotDbClient = Pick<
  Prisma.TransactionClient,
  'knowledgeItem' | 'knowledgeSnapshot' | 'auditLog'
>;

type KnowledgeSnapshotTransactionHost = {
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

function safeSize(value: bigint | null) {
  if (value === null) return null;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('knowledge_snapshot_size_invalid');
  }
  return size;
}

function mapSnapshot(row: SnapshotRow): KnowledgeSnapshot {
  if (!knowledgeSnapshotStatuses.includes(row.status)) {
    throw new Error('knowledge_snapshot_status_invalid');
  }
  if (!knowledgeSnapshotCaptureMethods.includes(row.captureMethod)) {
    throw new Error('knowledge_snapshot_capture_method_invalid');
  }
  return {
    id: row.id,
    knowledgeItemId: row.knowledgeItemId,
    artifactId: row.artifactId,
    version: row.version,
    status: row.status,
    captureMethod: row.captureMethod,
    sourceUrl: row.sourceUrl,
    originalName: row.originalName,
    contentType: row.contentType,
    sizeBytes: safeSize(row.sizeBytes),
    sha256: row.sha256,
    extractedText: row.extractedText,
    requestKeyHash: row.requestKeyHash,
    requestPayloadHash: row.requestPayloadHash,
    failureCode: row.failureCode,
    capturedAt: row.capturedAt,
    capturedBy: row.capturedBy,
    readyAt: row.readyAt,
    failedAt: row.failedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaKnowledgeSnapshotRepository
  implements KnowledgeSnapshotReadRepository, KnowledgeSnapshotWriteRepository
{
  constructor(private readonly client: KnowledgeSnapshotDbClient = prisma) {}

  async findVisibleById(input: {
    actor: KnowledgeActor;
    itemId: string;
    snapshotId: string;
  }) {
    const row = await this.client.knowledgeSnapshot.findFirst({
      where: {
        id: input.snapshotId,
        knowledgeItemId: input.itemId,
        knowledgeItem: { is: buildKnowledgeVisibilityWhere(input.actor) },
      },
    });
    return row ? mapSnapshot(row) : null;
  }

  async listVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    limit: number;
  }) {
    const visible = await this.client.knowledgeItem.findFirst({
      where: {
        AND: [{ id: input.itemId }, buildKnowledgeVisibilityWhere(input.actor)],
      },
      select: {
        snapshots: {
          orderBy: [{ version: 'desc' as const }, { id: 'desc' as const }],
          take: input.limit,
        },
      },
    });
    if (!visible) return null;
    return visible.snapshots.map(mapSnapshot);
  }

  async findByRequestKey(input: { itemId: string; requestKeyHash: string }) {
    const row = await this.client.knowledgeSnapshot.findUnique({
      where: {
        knowledgeItemId_requestKeyHash: {
          knowledgeItemId: input.itemId,
          requestKeyHash: input.requestKeyHash,
        },
      },
    });
    return row ? mapSnapshot(row) : null;
  }

  async findOwnedItem(input: { actor: KnowledgeActor; itemId: string }) {
    return this.client.knowledgeItem.findFirst({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        deletedAt: null,
      },
      select: { id: true, ownerUserId: true },
    });
  }

  async findOwnedSnapshot(input: {
    actor: KnowledgeActor;
    itemId: string;
    snapshotId: string;
  }) {
    const row = await this.client.knowledgeSnapshot.findFirst({
      where: {
        id: input.snapshotId,
        knowledgeItemId: input.itemId,
        knowledgeItem: {
          is: { ownerUserId: input.actor.userId, deletedAt: null },
        },
      },
    });
    return row ? mapSnapshot(row) : null;
  }

  async nextVersion(itemId: string) {
    const result = await this.client.knowledgeSnapshot.aggregate({
      where: { knowledgeItemId: itemId },
      _max: { version: true },
    });
    const current = result._max.version ?? 0;
    if (!Number.isInteger(current) || current >= 2_147_483_647) {
      throw new Error('knowledge_snapshot_version_exhausted');
    }
    return current + 1;
  }

  async createIntent(
    input: Parameters<KnowledgeSnapshotWriteRepository['createIntent']>[0],
  ) {
    const row = await this.client.knowledgeSnapshot.create({ data: input });
    return mapSnapshot(row);
  }

  async recordMaterialized(
    input: Parameters<
      KnowledgeSnapshotWriteRepository['recordMaterialized']
    >[0],
  ) {
    const updated = await this.client.knowledgeSnapshot.updateMany({
      where: {
        id: input.snapshotId,
        status: 'pending',
        artifactId: null,
        sha256: null,
        sizeBytes: null,
      },
      data: {
        contentType: input.contentType,
        extractedText: input.extractedText,
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.client.knowledgeSnapshot.findUnique({
      where: { id: input.snapshotId },
    });
    return row ? mapSnapshot(row) : null;
  }

  async markReady(
    input: Parameters<KnowledgeSnapshotWriteRepository['markReady']>[0],
  ) {
    const updated = await this.client.knowledgeSnapshot.updateMany({
      where: {
        id: input.snapshotId,
        status: 'pending',
        artifactId: null,
        contentType: input.contentType,
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
      },
      data: {
        artifactId: input.artifactId,
        status: 'ready',
        failureCode: null,
        readyAt: input.readyAt,
        failedAt: null,
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.client.knowledgeSnapshot.findUnique({
      where: { id: input.snapshotId },
    });
    return row ? mapSnapshot(row) : null;
  }

  async markFailed(
    input: Parameters<KnowledgeSnapshotWriteRepository['markFailed']>[0],
  ) {
    const updated = await this.client.knowledgeSnapshot.updateMany({
      where: { id: input.snapshotId, status: 'pending', artifactId: null },
      data: {
        status: 'failed',
        failureCode: input.failureCode,
        failedAt: input.failedAt,
        readyAt: null,
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.client.knowledgeSnapshot.findUnique({
      where: { id: input.snapshotId },
    });
    return row ? mapSnapshot(row) : null;
  }
}

function bounded(value: string | undefined, maximum: number) {
  if (!value) return undefined;
  return value.slice(0, maximum);
}

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export class PrismaKnowledgeSnapshotAuditWriter implements KnowledgeSnapshotAuditWriter {
  constructor(
    private readonly client: Pick<KnowledgeSnapshotDbClient, 'auditLog'>,
  ) {}

  async write(entry: KnowledgeSnapshotAuditEntry) {
    const metadata: Prisma.InputJsonObject = {
      itemId: entry.metadata.itemId,
      version: entry.metadata.version,
      status: entry.metadata.status,
      captureMethod: entry.metadata.captureMethod,
      ...(entry.metadata.contentType
        ? { contentType: entry.metadata.contentType.slice(0, 100) }
        : {}),
      ...(entry.metadata.sha256 ? { sha256: entry.metadata.sha256 } : {}),
      ...(entry.metadata.sizeBytes !== undefined
        ? { sizeBytes: entry.metadata.sizeBytes }
        : {}),
      ...(entry.metadata.failureCode
        ? { failureCode: entry.metadata.failureCode.slice(0, 100) }
        : {}),
    };
    const requestId = entry.actor.requestId?.trim();
    const source = entry.actor.source;
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: bounded(entry.actor.userId, 255),
        requestId:
          requestId && requestIdPattern.test(requestId) ? requestId : undefined,
        source: source === 'api' || source === 'agent' ? source : undefined,
        targetTable: 'knowledge_snapshots',
        targetId: entry.targetId,
        metadata,
      },
    });
  }
}

export class PrismaKnowledgeSnapshotUnitOfWork implements KnowledgeSnapshotUnitOfWork {
  constructor(
    private readonly host: KnowledgeSnapshotTransactionHost = prisma,
  ) {}

  async run<T>(
    work: (transaction: KnowledgeSnapshotTransaction) => Promise<T>,
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
              snapshots: new PrismaKnowledgeSnapshotRepository(client),
              audit: new PrismaKnowledgeSnapshotAuditWriter(client),
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryableTransactionConflict(error)) throw error;
        if (attempt === serializableTransactionAttempts) {
          throw new KnowledgeSnapshotTransactionConflictError();
        }
      }
    }
    throw new Error('knowledge_snapshot_transaction_retry_exhausted');
  }
}

export const prismaKnowledgeSnapshotRepository =
  new PrismaKnowledgeSnapshotRepository();
export const prismaKnowledgeSnapshotUnitOfWork =
  new PrismaKnowledgeSnapshotUnitOfWork();
