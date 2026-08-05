import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  knowledgeLabelAssignmentSources,
  knowledgeLabelCapabilities,
  knowledgeLabelInputLimits,
  type KnowledgeItemLabelAssignment,
  type KnowledgeItemLabelMutationTarget,
  type KnowledgeItemLabelWriteRepository,
  type KnowledgeLabel,
  type KnowledgeLabelAlias,
  type KnowledgeLabelAuditEntry,
  type KnowledgeLabelAuditWriter,
  type KnowledgeLabelGroupGrant,
  type KnowledgeLabelListQuery,
  type KnowledgeLabelReadRepository,
  type KnowledgeLabelTransaction,
  KnowledgeLabelTransactionConflictError,
  type KnowledgeLabelUnitOfWork,
  type KnowledgeLabelWriteRepository,
} from '../../application/knowledge/knowledgeLabelPorts.js';
import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import { prisma } from '../../services/db.js';

type KnowledgeLabelDbClient = Pick<
  Prisma.TransactionClient,
  | 'knowledgeLabel'
  | 'knowledgeLabelAlias'
  | 'knowledgeLabelPath'
  | 'knowledgeItemLabel'
  | 'knowledgeLabelGroupGrant'
  | 'knowledgeItem'
  | 'groupAccount'
  | 'auditLog'
  | '$queryRaw'
>;

type KnowledgeLabelTransactionHost = {
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

function transactionConflictKind(error: { code: string }) {
  return error.code === 'P2002'
    ? ('duplicate' as const)
    : ('concurrent' as const);
}

function actorGroups(actor: KnowledgeActor) {
  return [
    ...new Set(
      actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
    ),
  ];
}

function impossibleLabelWhere(): Prisma.KnowledgeLabelWhereInput {
  return {
    AND: [
      { id: '__knowledge_label_missing_principal__' },
      { NOT: { id: '__knowledge_label_missing_principal__' } },
    ],
  };
}

export function buildKnowledgeLabelVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeLabelWhereInput {
  const ownerUserId = actor.userId.trim();
  if (!ownerUserId) return impossibleLabelWhere();
  const organizationId = actor.organizationId?.trim();
  const groups = actorGroups(actor);
  const visible: Prisma.KnowledgeLabelWhereInput[] = [
    { scope: 'personal', ownerUserId },
  ];
  if (organizationId && groups.length > 0) {
    visible.push({
      scope: 'organization',
      organizationId,
      groupGrants: {
        some: {
          groupAccountId: { in: groups },
          capability: { in: ['use', 'manage'] },
          active: true,
          groupAccount: { active: true },
        },
      },
    });
  }
  return { deletedAt: null, OR: visible };
}

export function buildKnowledgeLabelManageabilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeLabelWhereInput {
  const ownerUserId = actor.userId.trim();
  if (!ownerUserId) return impossibleLabelWhere();
  const organizationId = actor.organizationId?.trim();
  const groups = actorGroups(actor);
  const manageable: Prisma.KnowledgeLabelWhereInput[] = [
    { scope: 'personal', ownerUserId },
  ];
  if (organizationId) {
    manageable.push({
      scope: 'organization',
      organizationId,
      OR: [
        { ownerUserId },
        ...(groups.length > 0
          ? [
              {
                groupGrants: {
                  some: {
                    groupAccountId: { in: groups },
                    capability: 'manage' as const,
                    active: true,
                    groupAccount: { active: true },
                  },
                },
              },
            ]
          : []),
      ],
    });
  }
  return { deletedAt: null, OR: manageable };
}

function mapLabel(
  row: Prisma.KnowledgeLabelGetPayload<Record<string, never>>,
): KnowledgeLabel {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    scope: row.scope,
    organizationId: row.organizationId,
    displayName: row.displayName,
    slug: row.slug,
    parentId: row.parentId,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function mapAlias(
  row: Prisma.KnowledgeLabelAliasGetPayload<Record<string, never>>,
): KnowledgeLabelAlias {
  return {
    id: row.id,
    labelId: row.labelId,
    alias: row.alias,
    normalizedAlias: row.normalizedAlias,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function mapGrant(
  row: Prisma.KnowledgeLabelGroupGrantGetPayload<Record<string, never>>,
): KnowledgeLabelGroupGrant {
  if (!knowledgeLabelCapabilities.includes(row.capability)) {
    throw new Error('knowledge_label_capability_invalid');
  }
  return {
    id: row.id,
    labelId: row.labelId,
    groupAccountId: row.groupAccountId,
    capability: row.capability,
    active: row.active,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function mapAssignment(
  row: Prisma.KnowledgeItemLabelGetPayload<Record<string, never>>,
): KnowledgeItemLabelAssignment {
  if (!knowledgeLabelAssignmentSources.includes(row.assignmentSource)) {
    throw new Error('knowledge_label_assignment_source_invalid');
  }
  return {
    itemId: row.knowledgeItemId,
    labelId: row.labelId,
    assignmentSource: row.assignmentSource,
    assignedBy: row.assignedBy,
    confidenceBasisPoints: row.confidenceBasisPoints,
    detachedAt: row.detachedAt,
    detachedBy: row.detachedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapItemMutationTarget(
  row: Pick<
    Prisma.KnowledgeItemGetPayload<Record<string, never>>,
    'id' | 'ownerUserId' | 'scope' | 'organizationId' | 'status' | 'version'
  >,
): KnowledgeItemLabelMutationTarget {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    scope: row.scope,
    organizationId: row.organizationId,
    status: row.status,
    version: row.version,
  };
}

async function lockLabel(
  client: Pick<KnowledgeLabelDbClient, '$queryRaw'>,
  labelId: string,
  mode: 'share' | 'update',
) {
  const suffix =
    mode === 'share' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`;
  return client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "KnowledgeLabel"
    WHERE "id" = ${labelId}
    ${suffix}
  `);
}

function visibleLabelLockPredicate(actor: KnowledgeActor) {
  const ownerUserId = actor.userId.trim();
  if (!ownerUserId) return Prisma.sql`FALSE`;
  const organizationId = actor.organizationId?.trim();
  const groups = actorGroups(actor);
  const organizationPredicate =
    organizationId && groups.length > 0
      ? Prisma.sql`
          OR (
            label."scope" = 'organization'
            AND label."organizationId" = ${organizationId}
            AND EXISTS (
              SELECT 1
              FROM "KnowledgeLabelGroupGrant" AS label_grant
              INNER JOIN "GroupAccount" AS group_account
                ON group_account."id" = label_grant."groupAccountId"
              WHERE label_grant."labelId" = label."id"
                AND label_grant."groupAccountId" IN (${Prisma.join(groups)})
                AND label_grant."capability" IN ('use', 'manage')
                AND label_grant."active" = TRUE
                AND group_account."active" = TRUE
            )
          )`
      : Prisma.empty;
  return Prisma.sql`
    (
      (label."scope" = 'personal' AND label."ownerUserId" = ${ownerUserId})
      ${organizationPredicate}
    )
  `;
}

function manageableLabelLockPredicate(actor: KnowledgeActor) {
  const ownerUserId = actor.userId.trim();
  if (!ownerUserId) return Prisma.sql`FALSE`;
  const organizationId = actor.organizationId?.trim();
  const groups = actorGroups(actor);
  const manageGrantPredicate =
    groups.length > 0
      ? Prisma.sql`
          OR EXISTS (
            SELECT 1
            FROM "KnowledgeLabelGroupGrant" AS label_grant
            INNER JOIN "GroupAccount" AS group_account
              ON group_account."id" = label_grant."groupAccountId"
            WHERE label_grant."labelId" = label."id"
              AND label_grant."groupAccountId" IN (${Prisma.join(groups)})
              AND label_grant."capability" = 'manage'
              AND label_grant."active" = TRUE
              AND group_account."active" = TRUE
          )`
      : Prisma.empty;
  const organizationPredicate = organizationId
    ? Prisma.sql`
        OR (
          label."scope" = 'organization'
          AND label."organizationId" = ${organizationId}
          AND (
            label."ownerUserId" = ${ownerUserId}
            ${manageGrantPredicate}
          )
        )`
    : Prisma.empty;
  return Prisma.sql`
    (
      (label."scope" = 'personal' AND label."ownerUserId" = ${ownerUserId})
      ${organizationPredicate}
    )
  `;
}

function canIncrementVersion(version: number) {
  return (
    Number.isInteger(version) &&
    version >= 1 &&
    version <= knowledgeLabelInputLimits.expectedVersion
  );
}

export class PrismaKnowledgeLabelRepository
  implements KnowledgeLabelReadRepository, KnowledgeLabelWriteRepository
{
  constructor(private readonly client: KnowledgeLabelDbClient = prisma) {}

  async listVisible(actor: KnowledgeActor, query: KnowledgeLabelListQuery) {
    const rows = await this.client.knowledgeLabel.findMany({
      where: {
        AND: [
          buildKnowledgeLabelVisibilityWhere(actor),
          query.scope ? { scope: query.scope } : {},
          query.parentId !== undefined ? { parentId: query.parentId } : {},
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(mapLabel);
  }

  async findVisibleById(actor: KnowledgeActor, labelId: string) {
    const row = await this.client.knowledgeLabel.findFirst({
      where: {
        AND: [{ id: labelId }, buildKnowledgeLabelVisibilityWhere(actor)],
      },
    });
    return row ? mapLabel(row) : null;
  }

  async listVisibleAliases(actor: KnowledgeActor, labelId: string) {
    const label = await this.client.knowledgeLabel.findFirst({
      where: {
        AND: [{ id: labelId }, buildKnowledgeLabelVisibilityWhere(actor)],
      },
      select: {
        aliases: {
          orderBy: [
            { normalizedAlias: 'asc' as const },
            { id: 'asc' as const },
          ],
        },
      },
    });
    return label ? label.aliases.map(mapAlias) : null;
  }

  async listManageableGrants(actor: KnowledgeActor, labelId: string) {
    const label = await this.client.knowledgeLabel.findFirst({
      where: {
        AND: [{ id: labelId }, buildKnowledgeLabelManageabilityWhere(actor)],
      },
      select: {
        scope: true,
        groupGrants: {
          where: { active: true },
          orderBy: [{ groupAccountId: 'asc' as const }, { id: 'asc' as const }],
        },
      },
    });
    if (!label || label.scope !== 'organization') return null;
    return label.groupGrants.map(mapGrant);
  }

  async countActiveGroups(groupAccountIds: string[]) {
    return this.client.groupAccount.count({
      where: { id: { in: groupAccountIds }, active: true },
    });
  }

  async findManageableById(actor: KnowledgeActor, labelId: string) {
    const locked = await this.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT label."id"
        FROM "KnowledgeLabel" AS label
        WHERE label."id" = ${labelId}
          AND label."deletedAt" IS NULL
          AND ${manageableLabelLockPredicate(actor)}
        FOR UPDATE
      `,
    );
    if (locked.length !== 1) return null;
    const row = await this.client.knowledgeLabel.findUnique({
      where: { id: labelId },
    });
    return row ? mapLabel(row) : null;
  }

  async findUsableById(actor: KnowledgeActor, labelId: string) {
    const locked = await this.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT label."id"
        FROM "KnowledgeLabel" AS label
        WHERE label."id" = ${labelId}
          AND label."deletedAt" IS NULL
          AND ${visibleLabelLockPredicate(actor)}
        FOR SHARE
      `,
    );
    if (locked.length !== 1) return null;
    const row = await this.client.knowledgeLabel.findUnique({
      where: { id: labelId },
    });
    return row ? mapLabel(row) : null;
  }

  async isNameAvailable(input: {
    actor: KnowledgeActor;
    scope: KnowledgeLabel['scope'];
    organizationId: string | null;
    normalizedName: string;
    excludeLabelId?: string;
  }) {
    const domain: Prisma.KnowledgeLabelWhereInput =
      input.scope === 'personal'
        ? { scope: 'personal', ownerUserId: input.actor.userId }
        : {
            scope: 'organization',
            organizationId: input.organizationId ?? '__missing_organization__',
          };
    const row = await this.client.knowledgeLabel.findFirst({
      where: {
        AND: [
          domain,
          { deletedAt: null },
          {
            OR: [
              {
                AND: [
                  input.excludeLabelId
                    ? { NOT: { id: input.excludeLabelId } }
                    : {},
                  {
                    OR: [
                      { slug: input.normalizedName },
                      {
                        displayName: {
                          equals: input.normalizedName,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                ],
              },
              {
                aliases: {
                  some: { normalizedAlias: input.normalizedName },
                },
              },
            ],
          },
        ],
      },
      select: { id: true },
    });
    return row === null;
  }

  async create(input: Parameters<KnowledgeLabelWriteRepository['create']>[0]) {
    let inheritedPaths: Array<{ ancestorId: string; depth: number }> = [];
    if (input.parentId) {
      await lockLabel(this.client, input.parentId, 'share');
      inheritedPaths = await this.client.knowledgeLabelPath.findMany({
        where: { descendantId: input.parentId },
        select: { ancestorId: true, depth: true },
      });
      if (
        inheritedPaths.length === 0 ||
        !inheritedPaths.some(
          (path) => path.ancestorId === input.parentId && path.depth === 0,
        )
      ) {
        return { ok: false as const, reason: 'broken_hierarchy' as const };
      }
      if (
        inheritedPaths.some(
          (path) => path.depth + 1 > knowledgeLabelInputLimits.hierarchyDepth,
        )
      ) {
        return { ok: false as const, reason: 'hierarchy_too_deep' as const };
      }
    }
    const row = await this.client.knowledgeLabel.create({
      data: {
        ownerUserId: input.ownerUserId,
        scope: input.scope,
        organizationId: input.organizationId,
        displayName: input.displayName,
        slug: input.slug,
        parentId: input.parentId,
        createdBy: input.createdBy,
        updatedBy: input.updatedBy,
        groupGrants: {
          create: input.groupGrants.map((grant) => ({
            groupAccountId: grant.groupAccountId,
            capability: grant.capability,
            active: true,
            createdBy: input.createdBy,
            updatedBy: input.updatedBy,
          })),
        },
      },
    });
    await this.client.knowledgeLabelPath.createMany({
      data: [
        {
          id: randomUUID(),
          ancestorId: row.id,
          descendantId: row.id,
          depth: 0,
          createdBy: input.createdBy,
        },
        ...inheritedPaths.map((path) => ({
          id: randomUUID(),
          ancestorId: path.ancestorId,
          descendantId: row.id,
          depth: path.depth + 1,
          createdBy: input.createdBy,
        })),
      ],
    });
    return { ok: true as const, value: mapLabel(row) };
  }

  async updateVersioned(
    input: Parameters<KnowledgeLabelWriteRepository['updateVersioned']>[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    if (!('parentId' in input.patch)) {
      const result = await this.client.knowledgeLabel.updateMany({
        where: {
          AND: [
            { id: input.labelId, version: input.expectedVersion },
            buildKnowledgeLabelManageabilityWhere(input.actor),
          ],
        },
        data: {
          displayName: input.patch.displayName,
          slug: input.patch.slug,
          version: { increment: 1 },
          updatedBy: input.actor.userId,
        },
      });
      if (result.count !== 1) {
        return { ok: false as const, reason: 'version_conflict' as const };
      }
      const updated = await this.client.knowledgeLabel.findUniqueOrThrow({
        where: { id: input.labelId },
      });
      return { ok: true as const, value: mapLabel(updated) };
    }

    const subtreeRootPaths = await this.client.knowledgeLabelPath.findMany({
      where: { ancestorId: input.labelId },
      select: { descendantId: true, depth: true },
    });
    if (
      subtreeRootPaths.length === 0 ||
      !subtreeRootPaths.some(
        (path) => path.descendantId === input.labelId && path.depth === 0,
      )
    ) {
      return { ok: false as const, reason: 'broken_hierarchy' as const };
    }
    const subtreeIds = subtreeRootPaths.map((path) => path.descendantId);
    const activeSubtreeCount = await this.client.knowledgeLabel.count({
      where: { id: { in: subtreeIds }, deletedAt: null },
    });
    const lockedSubtree = await this.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
      SELECT label."id"
      FROM "KnowledgeLabel" AS label
      WHERE label."id" IN (${Prisma.join(subtreeIds)})
        AND label."deletedAt" IS NULL
        AND ${manageableLabelLockPredicate(input.actor)}
      ORDER BY label."id"
      FOR UPDATE
    `,
    );
    if (lockedSubtree.length !== activeSubtreeCount) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const selfPaths = await this.client.knowledgeLabelPath.findMany({
      where: {
        ancestorId: { in: subtreeIds },
        descendantId: { in: subtreeIds },
        depth: 0,
      },
      select: { ancestorId: true, descendantId: true },
    });
    if (
      selfPaths.length !== subtreeIds.length ||
      selfPaths.some((path) => path.ancestorId !== path.descendantId)
    ) {
      return { ok: false as const, reason: 'broken_hierarchy' as const };
    }

    let parentPaths: Array<{ ancestorId: string; depth: number }> = [];
    if (input.patch.parentId) {
      if (subtreeIds.includes(input.patch.parentId)) {
        return { ok: false as const, reason: 'cycle' as const };
      }
      parentPaths = await this.client.knowledgeLabelPath.findMany({
        where: { descendantId: input.patch.parentId },
        select: { ancestorId: true, depth: true },
      });
      if (
        parentPaths.length === 0 ||
        !parentPaths.some(
          (path) =>
            path.ancestorId === input.patch.parentId && path.depth === 0,
        )
      ) {
        return { ok: false as const, reason: 'broken_hierarchy' as const };
      }
      const parentDepth = Math.max(...parentPaths.map((path) => path.depth));
      const subtreeDepth = Math.max(
        ...subtreeRootPaths.map((path) => path.depth),
      );
      if (
        parentDepth + 1 + subtreeDepth >
        knowledgeLabelInputLimits.hierarchyDepth
      ) {
        return { ok: false as const, reason: 'hierarchy_too_deep' as const };
      }
    }

    const update = await this.client.knowledgeLabel.updateMany({
      where: {
        AND: [
          { id: input.labelId, version: input.expectedVersion },
          buildKnowledgeLabelManageabilityWhere(input.actor),
        ],
      },
      data: {
        displayName: input.patch.displayName,
        slug: input.patch.slug,
        parentId: input.patch.parentId,
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (update.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    await this.client.knowledgeLabelPath.deleteMany({
      where: {
        descendantId: { in: subtreeIds },
        ancestorId: { notIn: subtreeIds },
      },
    });
    if (input.patch.parentId) {
      await this.client.knowledgeLabelPath.createMany({
        data: parentPaths.flatMap((parentPath) =>
          subtreeRootPaths.map((subtreePath) => ({
            id: randomUUID(),
            ancestorId: parentPath.ancestorId,
            descendantId: subtreePath.descendantId,
            depth: parentPath.depth + 1 + subtreePath.depth,
            createdBy: input.actor.userId,
          })),
        ),
      });
    }
    const updated = await this.client.knowledgeLabel.findUniqueOrThrow({
      where: { id: input.labelId },
    });
    return { ok: true as const, value: mapLabel(updated) };
  }

  async deleteVersioned(
    input: Parameters<KnowledgeLabelWriteRepository['deleteVersioned']>[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const activeChildren = await this.client.knowledgeLabel.count({
      where: { parentId: input.labelId, deletedAt: null },
    });
    if (activeChildren > 0) {
      return { ok: false as const, reason: 'has_active_children' as const };
    }
    const result = await this.client.knowledgeLabel.updateMany({
      where: {
        AND: [
          { id: input.labelId, version: input.expectedVersion },
          buildKnowledgeLabelManageabilityWhere(input.actor),
        ],
      },
      data: {
        deletedAt: input.deletedAt,
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (result.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const row = await this.client.knowledgeLabel.findUniqueOrThrow({
      where: { id: input.labelId },
    });
    return { ok: true as const, value: mapLabel(row) };
  }

  async addAliasVersioned(
    input: Parameters<KnowledgeLabelWriteRepository['addAliasVersioned']>[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const updated = await this.client.knowledgeLabel.updateMany({
      where: {
        AND: [
          { id: input.labelId, version: input.expectedVersion },
          buildKnowledgeLabelManageabilityWhere(input.actor),
        ],
      },
      data: {
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const alias = await this.client.knowledgeLabelAlias.create({
      data: {
        labelId: input.labelId,
        alias: input.alias,
        normalizedAlias: input.normalizedAlias,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
      },
    });
    return {
      ok: true as const,
      value: {
        alias: mapAlias(alias),
        labelVersion: input.expectedVersion + 1,
      },
    };
  }

  async removeAliasVersioned(
    input: Parameters<KnowledgeLabelWriteRepository['removeAliasVersioned']>[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const alias = await this.client.knowledgeLabelAlias.findFirst({
      where: { id: input.aliasId, labelId: input.labelId },
    });
    if (!alias) return null;
    const updated = await this.client.knowledgeLabel.updateMany({
      where: {
        AND: [
          { id: input.labelId, version: input.expectedVersion },
          buildKnowledgeLabelManageabilityWhere(input.actor),
        ],
      },
      data: {
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    await this.client.knowledgeLabelAlias.delete({
      where: { id: input.aliasId },
    });
    return {
      ok: true as const,
      value: {
        alias: mapAlias(alias),
        labelVersion: input.expectedVersion + 1,
      },
    };
  }

  async replaceGrantsVersioned(
    input: Parameters<
      KnowledgeLabelWriteRepository['replaceGrantsVersioned']
    >[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const updated = await this.client.knowledgeLabel.updateMany({
      where: {
        AND: [
          {
            id: input.labelId,
            scope: 'organization',
            version: input.expectedVersion,
          },
          buildKnowledgeLabelManageabilityWhere(input.actor),
        ],
      },
      data: {
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const requestedIds = input.grants.map((grant) => grant.groupAccountId);
    await this.client.knowledgeLabelGroupGrant.updateMany({
      where: {
        labelId: input.labelId,
        ...(requestedIds.length > 0
          ? { groupAccountId: { notIn: requestedIds } }
          : {}),
        active: true,
      },
      data: { active: false, updatedBy: input.actor.userId },
    });
    for (const grant of input.grants) {
      await this.client.knowledgeLabelGroupGrant.upsert({
        where: {
          labelId_groupAccountId: {
            labelId: input.labelId,
            groupAccountId: grant.groupAccountId,
          },
        },
        create: {
          labelId: input.labelId,
          groupAccountId: grant.groupAccountId,
          capability: grant.capability,
          active: true,
          createdBy: input.actor.userId,
          updatedBy: input.actor.userId,
        },
        update: {
          capability: grant.capability,
          active: true,
          updatedBy: input.actor.userId,
        },
      });
    }
    const rows = await this.client.knowledgeLabelGroupGrant.findMany({
      where: { labelId: input.labelId, active: true },
      orderBy: [{ groupAccountId: 'asc' }, { id: 'asc' }],
    });
    return {
      ok: true as const,
      value: {
        grants: rows.map(mapGrant),
        labelVersion: input.expectedVersion + 1,
      },
    };
  }
}

export class PrismaKnowledgeItemLabelRepository implements KnowledgeItemLabelWriteRepository {
  constructor(private readonly client: KnowledgeLabelDbClient = prisma) {}

  async findOwnedItemForMutation(input: {
    actor: KnowledgeActor;
    itemId: string;
  }) {
    const ownerUserId = input.actor.userId.trim();
    if (!ownerUserId) return null;
    const locked = await this.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT item."id"
        FROM "KnowledgeItem" AS item
        WHERE item."id" = ${input.itemId}
          AND item."ownerUserId" = ${ownerUserId}
          AND item."deletedAt" IS NULL
        FOR UPDATE
      `,
    );
    if (locked.length !== 1) return null;
    const row = await this.client.knowledgeItem.findUnique({
      where: {
        id: input.itemId,
      },
      select: {
        id: true,
        ownerUserId: true,
        scope: true,
        organizationId: true,
        status: true,
        version: true,
      },
    });
    return row ? mapItemMutationTarget(row) : null;
  }

  async attachVersioned(
    input: Parameters<KnowledgeItemLabelWriteRepository['attachVersioned']>[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const existing = await this.client.knowledgeItemLabel.findFirst({
      where: {
        knowledgeItemId: input.itemId,
        labelId: input.labelId,
        detachedAt: null,
      },
    });
    if (existing) return { ok: false as const, reason: 'duplicate' as const };
    const updated = await this.client.knowledgeItem.updateMany({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const assignment = await this.client.knowledgeItemLabel.create({
      data: {
        knowledgeItemId: input.itemId,
        labelId: input.labelId,
        assignmentSource: input.assignmentSource,
        assignedBy: input.actor.userId,
        confidenceBasisPoints: input.confidenceBasisPoints,
      },
    });
    return {
      ok: true as const,
      value: {
        assignment: mapAssignment(assignment),
        itemVersion: input.expectedVersion + 1,
      },
    };
  }

  async detachVersioned(
    input: Parameters<KnowledgeItemLabelWriteRepository['detachVersioned']>[0],
  ) {
    if (!canIncrementVersion(input.expectedVersion)) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const assignment = await this.client.knowledgeItemLabel.findFirst({
      where: {
        knowledgeItemId: input.itemId,
        labelId: input.labelId,
        detachedAt: null,
      },
      orderBy: { id: 'asc' },
    });
    if (!assignment) {
      return {
        ok: true as const,
        value: { assignment: null, itemVersion: input.expectedVersion },
      };
    }
    const updated = await this.client.knowledgeItem.updateMany({
      where: {
        id: input.itemId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        version: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, reason: 'version_conflict' as const };
    }
    const detached = await this.client.knowledgeItemLabel.update({
      where: { id: assignment.id },
      data: {
        detachedAt: new Date(),
        detachedBy: input.actor.userId,
      },
    });
    return {
      ok: true as const,
      value: {
        assignment: mapAssignment(detached),
        itemVersion: input.expectedVersion + 1,
      },
    };
  }
}

const auditRequestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

function safeRequestId(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  return auditRequestIdPattern.test(normalized) ? normalized : undefined;
}

function safeSource(value: string | undefined) {
  return value === 'api' || value === 'agent' ? value : undefined;
}

export class PrismaKnowledgeLabelAuditWriter implements KnowledgeLabelAuditWriter {
  constructor(
    private readonly client: Pick<KnowledgeLabelDbClient, 'auditLog'>,
  ) {}

  async write(entry: KnowledgeLabelAuditEntry) {
    const target =
      entry.target.kind === 'label_master'
        ? {
            targetTable: 'knowledge_labels',
            targetId: 'label_master',
            metadata: {
              scope: entry.target.scope,
              version: entry.target.version,
              targetKind: 'label_master',
            } satisfies Prisma.InputJsonObject,
          }
        : {
            targetTable: 'knowledge_items',
            targetId: entry.target.itemId,
            metadata: {
              scope: entry.target.scope,
              status: entry.target.status,
              version: entry.target.version,
              relation: 'label',
              ...(entry.target.assignmentSource
                ? { assignmentSource: entry.target.assignmentSource }
                : {}),
            } satisfies Prisma.InputJsonObject,
          };
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.actor.userId.slice(0, 255),
        requestId: safeRequestId(entry.actor.requestId),
        source: safeSource(entry.actor.source),
        targetTable: target.targetTable,
        targetId: target.targetId,
        metadata: target.metadata,
      },
    });
  }
}

export class PrismaKnowledgeLabelUnitOfWork implements KnowledgeLabelUnitOfWork {
  constructor(
    private readonly host: KnowledgeLabelTransactionHost = prisma as PrismaClient,
  ) {}

  async run<T>(work: (transaction: KnowledgeLabelTransaction) => Promise<T>) {
    for (
      let attempt = 1;
      attempt <= serializableTransactionAttempts;
      attempt += 1
    ) {
      try {
        return await this.host.$transaction(
          async (client) =>
            work({
              labels: new PrismaKnowledgeLabelRepository(client),
              itemLabels: new PrismaKnowledgeItemLabelRepository(client),
              audit: new PrismaKnowledgeLabelAuditWriter(client),
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryableTransactionConflict(error)) throw error;
        if (attempt === serializableTransactionAttempts) {
          throw new KnowledgeLabelTransactionConflictError(
            transactionConflictKind(error),
          );
        }
      }
    }
    throw new Error('knowledge_label_transaction_retry_exhausted');
  }
}

export const prismaKnowledgeLabelRepository =
  new PrismaKnowledgeLabelRepository(prisma);
export const prismaKnowledgeLabelUnitOfWork =
  new PrismaKnowledgeLabelUnitOfWork(prisma);
