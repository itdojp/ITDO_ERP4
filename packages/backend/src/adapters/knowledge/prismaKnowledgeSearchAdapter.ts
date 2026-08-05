import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  KnowledgeActor,
  KnowledgeItem,
} from '../../application/knowledge/knowledgeItemPorts.js';
import {
  type KnowledgeCanonicalLabelRoot,
  type KnowledgeLabelSuggestion,
  type KnowledgeResolvedLabel,
  type KnowledgeSearchExecutionQuery,
  type KnowledgeSearchFacets,
  type KnowledgeSearchRepository,
  type KnowledgeSearchRepositoryResult,
} from '../../application/knowledge/knowledgeSearchPorts.js';
import { normalizeKnowledgeLabelName } from '../../application/knowledge/knowledgeLabelUseCases.js';
import { prisma } from '../../services/db.js';
import { buildKnowledgeLabelVisibilityWhere } from './prismaKnowledgeLabelAdapter.js';

type KnowledgeSearchDbClient = Pick<
  Prisma.TransactionClient,
  'knowledgeLabel' | 'knowledgeLabelPath' | '$queryRaw'
>;

type KnowledgeSearchTransactionHost = {
  $transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

type SearchPayloadRow = {
  items: unknown;
  total: bigint | number;
  facets: unknown;
  hasMore: boolean;
  nextUpdatedAt: Date | string | null;
  nextId: string | null;
  visibleRootCount: bigint | number;
};

function actorGroups(actor: KnowledgeActor) {
  return [
    ...new Set(
      actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
    ),
  ].sort();
}

function itemVisibilityPredicate(actor: KnowledgeActor) {
  const ownerUserId = actor.userId.trim();
  if (!ownerUserId) return Prisma.sql`FALSE`;
  const organizationId = actor.organizationId?.trim();
  const groups = actorGroups(actor);
  const organizationPredicate =
    organizationId && groups.length > 0
      ? Prisma.sql`
          OR (
            item."scope" = 'organization'
            AND item."organizationId" = ${organizationId}
            AND EXISTS (
              SELECT 1
              FROM "KnowledgeItemGroupGrant" AS item_grant
              INNER JOIN "GroupAccount" AS item_group
                ON item_group."id" = item_grant."groupAccountId"
              WHERE item_grant."knowledgeItemId" = item."id"
                AND item_grant."groupAccountId" IN (${Prisma.join(groups)})
                AND item_group."active" = TRUE
            )
          )`
      : Prisma.empty;
  return Prisma.sql`
    (
      item."ownerUserId" = ${ownerUserId}
      ${organizationPredicate}
    )
  `;
}

function labelVisibilityPredicate(actor: KnowledgeActor) {
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
              INNER JOIN "GroupAccount" AS label_group
                ON label_group."id" = label_grant."groupAccountId"
              WHERE label_grant."labelId" = label."id"
                AND label_grant."groupAccountId" IN (${Prisma.join(groups)})
                AND label_grant."capability" IN ('use', 'manage')
                AND label_grant."active" = TRUE
                AND label_group."active" = TRUE
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

function scalarPredicate(query: KnowledgeSearchExecutionQuery) {
  const predicates: Prisma.Sql[] = [];
  if (query.sourceType) {
    predicates.push(
      Prisma.sql`item."sourceType" = ${query.sourceType}::"KnowledgeSourceType"`,
    );
  }
  if (query.status) {
    predicates.push(
      Prisma.sql`item."status" = ${query.status}::"KnowledgeItemStatus"`,
    );
  }
  if (query.scope) {
    predicates.push(
      Prisma.sql`item."scope" = ${query.scope}::"KnowledgeItemScope"`,
    );
  }
  if (query.publishedFrom) {
    predicates.push(Prisma.sql`item."publishedAt" >= ${query.publishedFrom}`);
  }
  if (query.publishedTo) {
    predicates.push(Prisma.sql`item."publishedAt" <= ${query.publishedTo}`);
  }
  if (query.capturedFrom) {
    predicates.push(Prisma.sql`item."capturedAt" >= ${query.capturedFrom}`);
  }
  if (query.capturedTo) {
    predicates.push(Prisma.sql`item."capturedAt" <= ${query.capturedTo}`);
  }
  return predicates;
}

function labelPredicates(query: KnowledgeSearchExecutionQuery) {
  const predicates: Prisma.Sql[] = [];
  const anyIds = [
    ...new Set(query.labels.any.flatMap((root) => root.labelIds)),
  ];
  if (anyIds.length > 0) {
    predicates.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM effective_assignments AS any_assignment
        WHERE any_assignment."knowledgeItemId" = item."id"
          AND any_assignment."labelId" IN (${Prisma.join(anyIds)})
      )
    `);
  }
  for (const root of query.labels.all) {
    predicates.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM effective_assignments AS all_assignment
        WHERE all_assignment."knowledgeItemId" = item."id"
          AND all_assignment."labelId" IN (${Prisma.join(root.labelIds)})
      )
    `);
  }
  const notIds = [
    ...new Set(query.labels.not.flatMap((root) => root.labelIds)),
  ];
  if (notIds.length > 0) {
    predicates.push(Prisma.sql`
      NOT EXISTS (
        SELECT 1 FROM effective_assignments AS not_assignment
        WHERE not_assignment."knowledgeItemId" = item."id"
          AND not_assignment."labelId" IN (${Prisma.join(notIds)})
      )
    `);
  }
  return predicates;
}

function joinAnd(predicates: Prisma.Sql[]) {
  return predicates.length === 0
    ? Prisma.sql`TRUE`
    : Prisma.join(predicates, ' AND ');
}

function facetExpression(query: KnowledgeSearchExecutionQuery) {
  const expressions: Prisma.Sql[] = [Prisma.sql`'{}'::jsonb`];
  if (query.facets.includes('sourceType')) {
    expressions.push(Prisma.sql`
      jsonb_build_object(
        'sourceType',
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('value', bucket."value", 'count', bucket."count")
            ORDER BY bucket."count" DESC, bucket."value" ASC
          )
          FROM (
            SELECT item."sourceType"::text AS "value", COUNT(*)::int AS "count"
            FROM matched
            INNER JOIN "KnowledgeItem" AS item ON item."id" = matched."id"
            GROUP BY item."sourceType"
          ) AS bucket
        ), '[]'::jsonb)
      )
    `);
  }
  if (query.facets.includes('status')) {
    expressions.push(Prisma.sql`
      jsonb_build_object(
        'status',
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('value', bucket."value", 'count', bucket."count")
            ORDER BY bucket."count" DESC, bucket."value" ASC
          )
          FROM (
            SELECT item."status"::text AS "value", COUNT(*)::int AS "count"
            FROM matched
            INNER JOIN "KnowledgeItem" AS item ON item."id" = matched."id"
            GROUP BY item."status"
          ) AS bucket
        ), '[]'::jsonb)
      )
    `);
  }
  if (query.facets.includes('scope')) {
    expressions.push(Prisma.sql`
      jsonb_build_object(
        'scope',
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('value', bucket."value", 'count', bucket."count")
            ORDER BY bucket."count" DESC, bucket."value" ASC
          )
          FROM (
            SELECT item."scope"::text AS "value", COUNT(*)::int AS "count"
            FROM matched
            INNER JOIN "KnowledgeItem" AS item ON item."id" = matched."id"
            GROUP BY item."scope"
          ) AS bucket
        ), '[]'::jsonb)
      )
    `);
  }
  if (query.facets.includes('label')) {
    expressions.push(Prisma.sql`
      jsonb_build_object(
        'label',
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bucket."id",
              'displayName', bucket."displayName",
              'slug', bucket."slug",
              'count', bucket."count"
            ) ORDER BY bucket."count" DESC, bucket."displayName" ASC, bucket."id" ASC
          )
          FROM (
            SELECT
              visible_label."id",
              visible_label."displayName",
              visible_label."slug",
              COUNT(DISTINCT assignment."knowledgeItemId")::int AS "count"
            FROM matched
            INNER JOIN effective_assignments AS assignment
              ON assignment."knowledgeItemId" = matched."id"
            INNER JOIN visible_labels AS visible_label
              ON visible_label."id" = assignment."labelId"
            GROUP BY visible_label."id", visible_label."displayName", visible_label."slug"
            ORDER BY "count" DESC, visible_label."displayName" ASC, visible_label."id" ASC
            LIMIT 100
          ) AS bucket
        ), '[]'::jsonb)
      )
    `);
  }
  return Prisma.join(expressions, ' || ');
}

function rootCountExpression(query: KnowledgeSearchExecutionQuery) {
  const rootIds = [
    ...new Set(
      [...query.labels.any, ...query.labels.all, ...query.labels.not].map(
        (root) => root.id,
      ),
    ),
  ];
  return rootIds.length === 0
    ? Prisma.sql`0::bigint`
    : Prisma.sql`(
        SELECT COUNT(*) FROM visible_labels
        WHERE visible_labels."id" IN (${Prisma.join(rootIds)})
      )`;
}

function cursorPredicate(query: KnowledgeSearchExecutionQuery) {
  if (!query.cursorBoundary) return Prisma.sql`TRUE`;
  return Prisma.sql`
    (
      item."updatedAt" < ${query.cursorBoundary.updatedAt}
      OR (
        item."updatedAt" = ${query.cursorBoundary.updatedAt}
        AND item."id" < ${query.cursorBoundary.id}
      )
    )
  `;
}

function safeCount(value: bigint | number) {
  const count = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('knowledge_search_count_out_of_range');
  }
  return count;
}

function date(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new Error(`knowledge_search_${field}_invalid`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`knowledge_search_${field}_invalid`);
  }
  return parsed;
}

function nullableString(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`knowledge_search_${field}_invalid`);
  }
  return value;
}

function mapItem(value: unknown): KnowledgeItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('knowledge_search_item_invalid');
  }
  const row = value as Record<string, unknown>;
  for (const field of ['id', 'ownerUserId', 'scope', 'sourceType', 'status']) {
    if (typeof row[field] !== 'string') {
      throw new Error(`knowledge_search_${field}_invalid`);
    }
  }
  if (typeof row.version !== 'number') {
    throw new Error('knowledge_search_version_invalid');
  }
  return {
    id: row.id as string,
    ownerUserId: row.ownerUserId as string,
    scope: row.scope as KnowledgeItem['scope'],
    organizationId: nullableString(row.organizationId, 'organization_id'),
    sourceType: row.sourceType as KnowledgeItem['sourceType'],
    canonicalUrl: nullableString(row.canonicalUrl, 'canonical_url'),
    title: nullableString(row.title, 'title'),
    sourceAuthor: nullableString(row.sourceAuthor, 'source_author'),
    publishedAt: date(row.publishedAt, 'published_at'),
    capturedAt: date(row.capturedAt, 'captured_at') as Date,
    saveReason: nullableString(row.saveReason, 'save_reason'),
    shortNote: nullableString(row.shortNote, 'short_note'),
    unresolvedQuestion: nullableString(
      row.unresolvedQuestion,
      'unresolved_question',
    ),
    status: row.status as KnowledgeItem['status'],
    version: row.version,
    deletedAt: date(row.deletedAt, 'deleted_at'),
    deletedReason: nullableString(
      row.deletedReason,
      'deleted_reason',
    ) as KnowledgeItem['deletedReason'],
    createdAt: date(row.createdAt, 'created_at') as Date,
    createdBy: nullableString(row.createdBy, 'created_by'),
    updatedAt: date(row.updatedAt, 'updated_at') as Date,
    updatedBy: nullableString(row.updatedBy, 'updated_by'),
  };
}

function mapFacets(value: unknown): KnowledgeSearchFacets {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('knowledge_search_facets_invalid');
  }
  return value as KnowledgeSearchFacets;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class PrismaKnowledgeSearchRepository implements KnowledgeSearchRepository {
  private readonly client: KnowledgeSearchDbClient;
  private readonly transactionHost: KnowledgeSearchTransactionHost | null;

  constructor(
    client: KnowledgeSearchDbClient = prisma,
    transactionHost?: KnowledgeSearchTransactionHost | null,
  ) {
    this.client = client;
    this.transactionHost =
      transactionHost === undefined
        ? client === prisma
          ? (prisma as PrismaClient)
          : null
        : transactionHost;
  }

  async runInReadSnapshot<T>(
    work: (repository: KnowledgeSearchRepository) => Promise<T>,
  ): Promise<T> {
    if (!this.transactionHost) return work(this);
    return this.transactionHost.$transaction(
      (client) => work(new PrismaKnowledgeSearchRepository(client, null)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async resolveVisibleLabelReferences(
    actor: KnowledgeActor,
    references: string[],
  ) {
    if (references.length === 0) return [];
    const normalized = [
      ...new Set(
        references.map((reference) => normalizeKnowledgeLabelName(reference)),
      ),
    ];
    const rows = await this.client.knowledgeLabel.findMany({
      where: {
        AND: [
          buildKnowledgeLabelVisibilityWhere(actor),
          {
            OR: [
              { id: { in: references } },
              { slug: { in: normalized } },
              {
                displayName: {
                  in: references,
                  mode: 'insensitive' as const,
                },
              },
              {
                aliases: {
                  some: { normalizedAlias: { in: normalized } },
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        displayName: true,
        slug: true,
        aliases: { select: { normalizedAlias: true } },
      },
      orderBy: { id: 'asc' },
    });
    return references.map((reference) => {
      const normalizedReference = normalizeKnowledgeLabelName(reference);
      const candidates: KnowledgeResolvedLabel[] = rows
        .filter(
          (row) =>
            row.id === reference ||
            normalizeKnowledgeLabelName(row.displayName) ===
              normalizedReference ||
            row.slug === normalizedReference ||
            row.aliases.some(
              (alias) => alias.normalizedAlias === normalizedReference,
            ),
        )
        .map(({ id, displayName, slug }) => ({ id, displayName, slug }));
      return { reference, candidates };
    });
  }

  async expandVisibleLabelRoots(
    actor: KnowledgeActor,
    roots: KnowledgeCanonicalLabelRoot[],
  ) {
    if (roots.length === 0) return [];
    const visibleRows = await this.client.knowledgeLabel.findMany({
      where: {
        AND: [
          { id: { in: roots.map((root) => root.id) } },
          buildKnowledgeLabelVisibilityWhere(actor),
        ],
      },
      select: { id: true },
    });
    const visible = new Set(visibleRows.map((row) => row.id));
    const descendantRoots = roots.filter(
      (root) => root.includeDescendants && visible.has(root.id),
    );
    const paths =
      descendantRoots.length === 0
        ? []
        : await this.client.knowledgeLabelPath.findMany({
            where: {
              ancestorId: { in: descendantRoots.map((root) => root.id) },
              depth: { lte: 8 },
              descendant: buildKnowledgeLabelVisibilityWhere(actor),
            },
            select: { ancestorId: true, descendantId: true },
            orderBy: [
              { ancestorId: 'asc' },
              { depth: 'asc' },
              { descendantId: 'asc' },
            ],
          });
    return roots.flatMap((root) => {
      if (!visible.has(root.id)) return [];
      const labelIds = root.includeDescendants
        ? paths
            .filter((path) => path.ancestorId === root.id)
            .map((path) => path.descendantId)
        : [root.id];
      return [{ ...root, labelIds: [...new Set(labelIds)].sort() }];
    });
  }

  async execute(
    actor: KnowledgeActor,
    query: KnowledgeSearchExecutionQuery,
  ): Promise<KnowledgeSearchRepositoryResult> {
    const predicates = [...scalarPredicate(query), ...labelPredicates(query)];
    const rows = await this.client.$queryRaw<SearchPayloadRow[]>(Prisma.sql`
      WITH visible_labels AS MATERIALIZED (
        SELECT label."id", label."displayName", label."slug"
        FROM "KnowledgeLabel" AS label
        WHERE label."deletedAt" IS NULL
          AND ${labelVisibilityPredicate(actor)}
      ),
      effective_assignments AS MATERIALIZED (
        SELECT DISTINCT assignment."knowledgeItemId", assignment."labelId"
        FROM "KnowledgeItemLabel" AS assignment
        INNER JOIN visible_labels AS visible_label
          ON visible_label."id" = assignment."labelId"
        WHERE assignment."detachedAt" IS NULL
      ),
      visible_items AS MATERIALIZED (
        SELECT item.*
        FROM "KnowledgeItem" AS item
        WHERE item."deletedAt" IS NULL
          AND ${itemVisibilityPredicate(actor)}
      ),
      matched AS MATERIALIZED (
        SELECT DISTINCT item."id"
        FROM visible_items AS item
        WHERE ${joinAnd(predicates)}
      ),
      ordered_page AS MATERIALIZED (
        SELECT item.*
        FROM matched
        INNER JOIN "KnowledgeItem" AS item ON item."id" = matched."id"
        WHERE ${cursorPredicate(query)}
        ORDER BY item."updatedAt" DESC, item."id" DESC
        LIMIT ${query.limit + 1}
      ),
      page AS MATERIALIZED (
        SELECT * FROM ordered_page
        ORDER BY "updatedAt" DESC, "id" DESC
        LIMIT ${query.limit}
      )
      SELECT
        COALESCE((
          SELECT jsonb_agg(to_jsonb(page) ORDER BY page."updatedAt" DESC, page."id" DESC)
          FROM page
        ), '[]'::jsonb) AS "items",
        (SELECT COUNT(*) FROM matched) AS "total",
        (${facetExpression(query)}) AS "facets",
        (SELECT COUNT(*) > ${query.limit} FROM ordered_page) AS "hasMore",
        CASE WHEN (SELECT COUNT(*) > ${query.limit} FROM ordered_page)
          THEN (SELECT page."updatedAt" FROM page ORDER BY page."updatedAt" ASC, page."id" ASC LIMIT 1)
          ELSE NULL
        END AS "nextUpdatedAt",
        CASE WHEN (SELECT COUNT(*) > ${query.limit} FROM ordered_page)
          THEN (SELECT page."id" FROM page ORDER BY page."updatedAt" ASC, page."id" ASC LIMIT 1)
          ELSE NULL
        END AS "nextId",
        ${rootCountExpression(query)} AS "visibleRootCount"
    `);
    if (rows.length !== 1) throw new Error('knowledge_search_payload_missing');
    const row = rows[0];
    if (!Array.isArray(row.items)) {
      throw new Error('knowledge_search_items_invalid');
    }
    const nextUpdatedAt = date(row.nextUpdatedAt, 'next_updated_at');
    const nextBoundary =
      row.hasMore && nextUpdatedAt && row.nextId
        ? { updatedAt: nextUpdatedAt, id: row.nextId }
        : null;
    if (row.hasMore && !nextBoundary) {
      throw new Error('knowledge_search_next_boundary_invalid');
    }
    return {
      items: row.items.map(mapItem),
      total: safeCount(row.total),
      facets: mapFacets(row.facets),
      nextBoundary,
      visibleRootCount: safeCount(row.visibleRootCount),
    };
  }

  async suggest(input: {
    actor: KnowledgeActor;
    query: string;
    limit: number;
  }): Promise<KnowledgeLabelSuggestion[]> {
    const pattern = `%${escapeLike(input.query)}%`;
    const rows = await this.client.$queryRaw<
      Array<{
        id: string;
        displayName: string;
        slug: string;
        usageCount: bigint | number;
      }>
    >(Prisma.sql`
      WITH visible_labels AS MATERIALIZED (
        SELECT label."id", label."displayName", label."slug"
        FROM "KnowledgeLabel" AS label
        WHERE label."deletedAt" IS NULL
          AND ${labelVisibilityPredicate(input.actor)}
      ),
      visible_items AS MATERIALIZED (
        SELECT item."id"
        FROM "KnowledgeItem" AS item
        WHERE item."deletedAt" IS NULL
          AND ${itemVisibilityPredicate(input.actor)}
      ),
      effective_assignments AS MATERIALIZED (
        SELECT DISTINCT assignment."knowledgeItemId", assignment."labelId"
        FROM "KnowledgeItemLabel" AS assignment
        INNER JOIN visible_labels AS visible_label
          ON visible_label."id" = assignment."labelId"
        INNER JOIN visible_items AS visible_item
          ON visible_item."id" = assignment."knowledgeItemId"
        WHERE assignment."detachedAt" IS NULL
      )
      SELECT
        visible_label."id",
        visible_label."displayName",
        visible_label."slug",
        COUNT(DISTINCT assignment."knowledgeItemId") AS "usageCount"
      FROM visible_labels AS visible_label
      LEFT JOIN effective_assignments AS assignment
        ON assignment."labelId" = visible_label."id"
      WHERE
        LOWER(visible_label."displayName") LIKE ${pattern} ESCAPE '\\'
        OR visible_label."slug" LIKE ${pattern} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM "KnowledgeLabelAlias" AS alias
          WHERE alias."labelId" = visible_label."id"
            AND alias."normalizedAlias" LIKE ${pattern} ESCAPE '\\'
        )
      GROUP BY visible_label."id", visible_label."displayName", visible_label."slug"
      ORDER BY "usageCount" DESC, visible_label."displayName" ASC, visible_label."id" ASC
      LIMIT ${input.limit}
    `);
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      slug: row.slug,
      usageCount: safeCount(row.usageCount),
    }));
  }
}

export const prismaKnowledgeSearchRepository =
  new PrismaKnowledgeSearchRepository();
