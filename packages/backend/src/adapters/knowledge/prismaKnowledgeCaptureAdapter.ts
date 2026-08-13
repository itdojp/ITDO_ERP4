import { Prisma } from '@prisma/client';

import {
  knowledgeCaptureStatuses,
  KnowledgeCaptureTransactionConflictError,
  type KnowledgeCapture,
  type KnowledgeCaptureAuditEntry,
  type KnowledgeCaptureAuditWriter,
  type KnowledgeCaptureRepository,
  type KnowledgeCaptureTransaction,
  type KnowledgeCaptureUnitOfWork,
} from '../../application/knowledge/knowledgeCapturePorts.js';
import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import { prisma } from '../../services/db.js';

type CaptureRow = Prisma.KnowledgeCaptureRequestGetPayload<
  Record<string, never>
>;

type CaptureDbClient = Pick<
  Prisma.TransactionClient,
  | 'auditLog'
  | 'groupAccount'
  | 'knowledgeCaptureRequest'
  | 'knowledgeItem'
  | 'knowledgeItemGroupGrant'
  | 'knowledgeSnapshot'
> &
  Pick<Prisma.TransactionClient, '$queryRaw'>;

type TransactionHost = {
  $transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

const transactionAttempts = 3;
const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

function bounded(value: string | undefined, maximum: number) {
  if (!value) return undefined;
  return value.slice(0, maximum);
}

function retryable(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false;
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

function mapCapture(row: CaptureRow): KnowledgeCapture {
  if (!knowledgeCaptureStatuses.includes(row.status)) {
    throw new Error('knowledge_capture_status_invalid');
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    requestKeyHash: row.requestKeyHash,
    payloadHash: row.payloadHash,
    channel: row.channel,
    scope: row.scope,
    organizationId: row.organizationId,
    knowledgeItemId: row.knowledgeItemId,
    snapshotId: row.snapshotId,
    snapshotVersion: row.snapshotVersion,
    status: row.status,
    failureCode: row.failureCode,
    selectedFieldCount: row.selectedFieldCount,
    payloadByteCount: row.payloadByteCount,
    version: row.version,
    createdAt: row.createdAt,
    committedAt: row.committedAt,
    failedAt: row.failedAt,
    updatedAt: row.updatedAt,
  };
}

function currentCaptureAccessWhere(input: {
  actor: KnowledgeActor;
  captureId: string;
}): Prisma.KnowledgeCaptureRequestWhereInput {
  const actorUserId = input.actor.userId.trim();
  const organizationId = input.actor.organizationId?.trim();
  const groupAccountIds = [
    ...new Set(
      input.actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  const visibleScopes: Prisma.KnowledgeCaptureRequestWhereInput[] = [
    {
      scope: 'personal',
      organizationId: null,
      knowledgeItem: {
        is: {
          ownerUserId: actorUserId,
          scope: 'personal',
          organizationId: null,
          deletedAt: null,
        },
      },
    },
  ];
  if (organizationId && groupAccountIds.length > 0) {
    visibleScopes.push({
      scope: 'organization',
      organizationId,
      knowledgeItem: {
        is: {
          ownerUserId: actorUserId,
          scope: 'organization',
          organizationId,
          deletedAt: null,
          groupGrants: {
            some: {
              groupAccountId: { in: groupAccountIds },
              groupAccount: {
                active: true,
                memberships: {
                  some: {
                    userId: actorUserId,
                    user: {
                      active: true,
                      deletedAt: null,
                      organization: organizationId,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }
  return {
    id: input.captureId,
    ownerUserId: actorUserId,
    OR: visibleScopes,
  };
}

async function lockCurrentCaptureAccess(
  client: CaptureDbClient,
  input: {
    actor: KnowledgeActor;
    captureId: string;
    requiredGroupAccountIds: string[];
  },
) {
  const actorUserId = input.actor.userId.trim();
  const organizationId = input.actor.organizationId?.trim() ?? '';
  const actorGroupAccountIds = [
    ...new Set(
      input.actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  const requiredGroupAccountIds = [
    ...new Set(
      input.requiredGroupAccountIds
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort();
  const actorHasRequiredGroups = requiredGroupAccountIds.every((groupId) =>
    actorGroupAccountIds.includes(groupId),
  );
  const organizationAccess =
    organizationId &&
    requiredGroupAccountIds.length > 0 &&
    actorHasRequiredGroups
      ? Prisma.sql`
          OR (
            capture."scope" = 'organization'
            AND capture."organizationId" = ${organizationId}
            AND item."scope" = 'organization'
            AND item."organizationId" = ${organizationId}
            AND EXISTS (
              SELECT 1
              FROM "KnowledgeItemGroupGrant" grant_row
              JOIN "GroupAccount" group_row
                ON group_row."id" = grant_row."groupAccountId"
              JOIN "UserGroup" membership_row
                ON membership_row."groupId" = group_row."id"
              JOIN "UserAccount" user_row
                ON user_row."id" = membership_row."userId"
              WHERE grant_row."knowledgeItemId" = item."id"
                AND group_row."id" IN (${Prisma.join(requiredGroupAccountIds)})
                AND group_row."active" = true
                AND membership_row."userId" = ${actorUserId}
                AND user_row."active" = true
                AND user_row."deletedAt" IS NULL
                AND user_row."organization" = ${organizationId}
            )
          )`
      : Prisma.empty;
  const captureRows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT capture."id"
    FROM "KnowledgeCaptureRequest" capture
    JOIN "KnowledgeItem" item
      ON item."id" = capture."knowledgeItemId"
     AND item."ownerUserId" = capture."ownerUserId"
    WHERE capture."id" = ${input.captureId}
      AND capture."ownerUserId" = ${actorUserId}
      AND item."ownerUserId" = ${actorUserId}
      AND item."deletedAt" IS NULL
      AND (
        (
          capture."scope" = 'personal'
          AND capture."organizationId" IS NULL
          AND item."scope" = 'personal'
          AND item."organizationId" IS NULL
        )
        ${organizationAccess}
      )
    FOR SHARE OF capture, item
  `);
  if (captureRows.length !== 1) return false;
  const capture = await client.knowledgeCaptureRequest.findUnique({
    where: { id: input.captureId },
    select: { knowledgeItemId: true, scope: true },
  });
  if (!capture) return false;
  if (capture.scope === 'personal') {
    return requiredGroupAccountIds.length === 0;
  }
  if (!organizationId || requiredGroupAccountIds.length === 0) return false;
  const accessRows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT group_row."id"
    FROM "KnowledgeItemGroupGrant" grant_row
    JOIN "GroupAccount" group_row
      ON group_row."id" = grant_row."groupAccountId"
    JOIN "UserGroup" membership_row
      ON membership_row."groupId" = group_row."id"
     AND membership_row."userId" = ${actorUserId}
    JOIN "UserAccount" user_row
      ON user_row."id" = membership_row."userId"
    WHERE grant_row."knowledgeItemId" = ${capture.knowledgeItemId}
      AND group_row."id" IN (${Prisma.join(requiredGroupAccountIds)})
      AND group_row."active" = true
      AND user_row."active" = true
      AND user_row."deletedAt" IS NULL
      AND user_row."organization" = ${organizationId}
    ORDER BY grant_row."id", group_row."id", membership_row."id", user_row."id"
    FOR SHARE OF grant_row, group_row, membership_row, user_row
  `);
  return (
    new Set(accessRows.map((row) => row.id)).size ===
    requiredGroupAccountIds.length
  );
}

export class PrismaKnowledgeCaptureRepository implements KnowledgeCaptureRepository {
  constructor(private readonly client: CaptureDbClient = prisma) {}

  async lockActiveGroupsForActor(input: {
    actorUserId: string;
    organizationId: string;
    groupAccountIds: string[];
  }) {
    const groupAccountIds = [...new Set(input.groupAccountIds)].sort();
    if (groupAccountIds.length === 0) return 0;
    const rows = await this.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT group_row."id"
      FROM "GroupAccount" group_row
      JOIN "UserGroup" membership_row
        ON membership_row."groupId" = group_row."id"
       AND membership_row."userId" = ${input.actorUserId}
      JOIN "UserAccount" user_row
        ON user_row."id" = membership_row."userId"
      WHERE group_row."id" IN (${Prisma.join(groupAccountIds)})
        AND group_row."active" = true
        AND user_row."active" = true
        AND user_row."deletedAt" IS NULL
        AND user_row."organization" = ${input.organizationId}
      ORDER BY group_row."id", membership_row."id", user_row."id"
      FOR SHARE OF group_row, membership_row, user_row
    `);
    return new Set(rows.map((row) => row.id)).size;
  }

  async findByRequestKey(input: {
    ownerUserId: string;
    requestKeyHash: string;
  }) {
    const row = await this.client.knowledgeCaptureRequest.findUnique({
      where: {
        ownerUserId_requestKeyHash: input,
      },
    });
    return row ? mapCapture(row) : null;
  }

  async findRecentByPayload(input: {
    ownerUserId: string;
    payloadHash: string;
  }) {
    const row = await this.client.knowledgeCaptureRequest.findFirst({
      where: input,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? mapCapture(row) : null;
  }

  async hasCurrentAccess(input: { actor: KnowledgeActor; captureId: string }) {
    return (
      (await this.client.knowledgeCaptureRequest.count({
        where: currentCaptureAccessWhere(input),
      })) === 1
    );
  }

  async hasCurrentBindingAccess(input: {
    actor: KnowledgeActor;
    captureId: string;
    requiredGroupAccountIds: string[];
  }) {
    return lockCurrentCaptureAccess(this.client, input);
  }

  async findOwnedById(input: { actor: KnowledgeActor; captureId: string }) {
    const row = await this.client.knowledgeCaptureRequest.findFirst({
      where: currentCaptureAccessWhere(input),
    });
    return row ? mapCapture(row) : null;
  }

  async findOwnedArtifactState(input: {
    actor: KnowledgeActor;
    captureId: string;
  }) {
    const row = await this.client.knowledgeCaptureRequest.findFirst({
      where: currentCaptureAccessWhere(input),
      include: {
        snapshot: {
          select: {
            contentType: true,
            originalName: true,
            sha256: true,
            sizeBytes: true,
          },
        },
      },
    });
    if (!row) return null;
    const sizeBytes =
      row.snapshot.sizeBytes === null ? null : Number(row.snapshot.sizeBytes);
    if (
      sizeBytes !== null &&
      (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
    ) {
      throw new Error('knowledge_capture_size_invalid');
    }
    return {
      capture: mapCapture(row),
      contentType: row.snapshot.contentType,
      originalName: row.snapshot.originalName,
      sha256: row.snapshot.sha256,
      sizeBytes,
    };
  }

  async createAggregate(
    input: Parameters<KnowledgeCaptureRepository['createAggregate']>[0],
  ) {
    await this.client.knowledgeItem.create({
      data: {
        id: input.itemId,
        ownerUserId: input.ownerUserId,
        scope: input.scope,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        sourceAuthor: input.sourceAuthor,
        publishedAt: input.publishedAt,
        capturedAt: input.capturedAt,
        status: 'inbox',
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        groupGrants: {
          create: input.groupAccountIds.map((groupAccountId) => ({
            groupAccountId,
            createdBy: input.createdBy,
          })),
        },
      },
    });
    await this.client.knowledgeSnapshot.create({
      data: {
        id: input.snapshotId,
        knowledgeItemId: input.itemId,
        version: 1,
        status: 'pending',
        captureMethod: 'text',
        sourceUrl: input.canonicalUrl,
        originalName: 'knowledge-capture.txt',
        requestKeyHash: input.snapshotRequestKeyHash,
        requestPayloadHash: input.snapshotPayloadHash,
        contentType: input.contentType,
        extractedText: input.extractedText,
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
        capturedAt: input.capturedAt,
        capturedBy: input.createdBy,
      },
    });
    const row = await this.client.knowledgeCaptureRequest.create({
      data: {
        id: input.id,
        ownerUserId: input.ownerUserId,
        requestKeyHash: input.requestKeyHash,
        payloadHash: input.payloadHash,
        channel: input.channel,
        scope: input.scope,
        organizationId: input.organizationId,
        knowledgeItemId: input.itemId,
        snapshotId: input.snapshotId,
        snapshotVersion: 1,
        selectedFieldCount: input.selectedFieldCount,
        payloadByteCount: input.payloadByteCount,
      },
    });
    return mapCapture(row);
  }

  async markReady(input: {
    actor: KnowledgeActor;
    captureId: string;
    requiredGroupAccountIds: string[];
    artifactId: string;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    committedAt: Date;
  }) {
    if (!(await lockCurrentCaptureAccess(this.client, input))) return null;
    const capture = await this.client.knowledgeCaptureRequest.findFirst({
      where: currentCaptureAccessWhere(input),
    });
    if (!capture) return null;
    if (capture.status === 'ready') return mapCapture(capture);
    if (capture.status !== 'pending') return null;
    const snapshot = await this.client.knowledgeSnapshot.updateMany({
      where: {
        id: capture.snapshotId,
        status: 'pending',
        artifactId: null,
        contentType: input.contentType,
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
      },
      data: {
        artifactId: input.artifactId,
        status: 'ready',
        readyAt: input.committedAt,
        failedAt: null,
        failureCode: null,
      },
    });
    if (snapshot.count !== 1) return null;
    const row = await this.client.knowledgeCaptureRequest.update({
      where: { id: capture.id },
      data: {
        status: 'ready',
        committedAt: input.committedAt,
        failedAt: null,
        failureCode: null,
        version: { increment: 1 },
      },
    });
    return mapCapture(row);
  }

  async markFailed(input: {
    actor: KnowledgeActor;
    captureId: string;
    requiredGroupAccountIds: string[];
    failedAt: Date;
    failureCode: 'snapshot_storage_failed';
  }) {
    if (!(await lockCurrentCaptureAccess(this.client, input))) return null;
    const capture = await this.client.knowledgeCaptureRequest.findFirst({
      where: currentCaptureAccessWhere(input),
    });
    if (!capture) return null;
    if (capture.status === 'failed') return mapCapture(capture);
    if (capture.status !== 'pending') return null;
    const snapshot = await this.client.knowledgeSnapshot.updateMany({
      where: { id: capture.snapshotId, status: 'pending', artifactId: null },
      data: {
        status: 'failed',
        failureCode: input.failureCode,
        failedAt: input.failedAt,
        readyAt: null,
      },
    });
    if (snapshot.count !== 1) return null;
    const row = await this.client.knowledgeCaptureRequest.update({
      where: { id: capture.id },
      data: {
        status: 'failed',
        failureCode: input.failureCode,
        failedAt: input.failedAt,
        committedAt: null,
        version: { increment: 1 },
      },
    });
    return mapCapture(row);
  }
}

export class PrismaKnowledgeCaptureAuditWriter implements KnowledgeCaptureAuditWriter {
  constructor(private readonly client: Pick<CaptureDbClient, 'auditLog'>) {}

  async write(entry: KnowledgeCaptureAuditEntry) {
    const requestId = entry.actor.requestId?.trim();
    const source = entry.actor.source;
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: bounded(entry.actor.userId, 255),
        requestId:
          requestId && requestIdPattern.test(requestId) ? requestId : undefined,
        source: source === 'api' || source === 'agent' ? source : undefined,
        targetTable: 'knowledge_capture_requests',
        targetId: entry.targetId,
        metadata: {
          channel: entry.metadata.channel,
          scope: entry.metadata.scope,
          fieldCount: entry.metadata.fieldCount,
          byteCount: entry.metadata.byteCount,
          resultCode: entry.metadata.resultCode.slice(0, 100),
        },
      },
    });
  }
}

export class PrismaKnowledgeCaptureUnitOfWork implements KnowledgeCaptureUnitOfWork {
  constructor(private readonly host: TransactionHost = prisma) {}

  async run<T>(work: (transaction: KnowledgeCaptureTransaction) => Promise<T>) {
    for (let attempt = 1; attempt <= transactionAttempts; attempt += 1) {
      try {
        return await this.host.$transaction(
          async (client) =>
            work({
              captures: new PrismaKnowledgeCaptureRepository(client),
              audit: new PrismaKnowledgeCaptureAuditWriter(client),
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!retryable(error)) throw error;
        if (attempt === transactionAttempts) {
          throw new KnowledgeCaptureTransactionConflictError();
        }
      }
    }
    throw new Error('knowledge_capture_transaction_retry_exhausted');
  }
}

export const prismaKnowledgeCaptureRepository =
  new PrismaKnowledgeCaptureRepository();
export const prismaKnowledgeCaptureUnitOfWork =
  new PrismaKnowledgeCaptureUnitOfWork();
