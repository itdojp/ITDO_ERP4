import { Prisma, type PrismaClient } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import {
  KnowledgeProvenanceConflictError,
  knowledgeProvenanceLimits,
  type KnowledgeAccessRepository,
  type KnowledgeAnnotation,
  type KnowledgeAnnotationRepository,
  type KnowledgeAnnotationRevision,
  type KnowledgeConversation,
  type KnowledgeConversationRepository,
  type KnowledgeConversationTurn,
  type KnowledgeItemAccess,
  type KnowledgePageBoundary,
  type KnowledgeProvenanceTransaction,
  type KnowledgeProvenanceUnitOfWork,
  type KnowledgeSequenceBoundary,
  type KnowledgeSynthesis,
  type KnowledgeSynthesisDetail,
  type KnowledgeSynthesisRepository,
  type KnowledgeSynthesisSource,
  type KnowledgeSynthesisSourceInput,
  type KnowledgeSynthesisSourceKind,
  type KnowledgeSynthesisVersion,
} from '../../application/knowledge/knowledgeProvenancePorts.js';
import { prisma } from '../../services/db.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';
import { PrismaKnowledgeProvenanceAuditWriter } from './prismaKnowledgeProvenanceAuditAdapter.js';
import {
  consumeSynthesisAccessBudget,
  type KnowledgeSynthesisAccessContext,
} from '../../application/knowledge/knowledgeSynthesisAccessContext.js';

export { PrismaKnowledgeProvenanceAuditWriter } from './prismaKnowledgeProvenanceAuditAdapter.js';

type KnowledgeProvenanceDbClient = Pick<
  Prisma.TransactionClient,
  | 'auditLog'
  | 'knowledgeAnnotation'
  | 'knowledgeAnnotationRevision'
  | 'knowledgeConversation'
  | 'knowledgeConversationItem'
  | 'knowledgeConversationTurn'
  | 'knowledgeItem'
  | 'knowledgeSnapshot'
  | 'knowledgeSynthesis'
  | 'knowledgeSynthesisSource'
  | 'knowledgeSynthesisVersion'
>;

type KnowledgeProvenanceTransactionHost = {
  $transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

type AnnotationRow = Prisma.KnowledgeAnnotationGetPayload<{
  include: { revisions: true };
}>;
type ConversationRow = Prisma.KnowledgeConversationGetPayload<{
  include: { items: true };
}>;
type SynthesisRow = Prisma.KnowledgeSynthesisGetPayload<Record<string, never>>;
type SynthesisVersionRow = Prisma.KnowledgeSynthesisVersionGetPayload<{
  include: { sources: true };
}>;
type SynthesisSourceRow = Prisma.KnowledgeSynthesisSourceGetPayload<
  Record<string, never>
>;

const annotationInclude = {
  revisions: { orderBy: { revision: 'desc' as const }, take: 1 },
} as const;

const conversationInclude: Prisma.KnowledgeConversationInclude = {
  items: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
};

const synthesisVersionInclude: Prisma.KnowledgeSynthesisVersionInclude = {
  sources: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
};

function mapItemAccess(row: {
  id: string;
  ownerUserId: string;
  scope: 'personal' | 'organization';
  organizationId: string | null;
}): KnowledgeItemAccess {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    scope: row.scope,
    organizationId: row.organizationId,
  };
}

function mapAnnotationRevision(
  row: Prisma.KnowledgeAnnotationRevisionGetPayload<Record<string, never>>,
): KnowledgeAnnotationRevision {
  return {
    id: row.id,
    annotationId: row.annotationId,
    revision: row.revision,
    kind: row.kind,
    origin: row.origin,
    content: row.content,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function mapAnnotation(row: AnnotationRow): KnowledgeAnnotation {
  const revision = row.revisions[0];
  if (!revision || revision.revision !== row.currentRevision) {
    throw new Error('knowledge_annotation_revision_missing');
  }
  return {
    id: row.id,
    knowledgeItemId: row.knowledgeItemId,
    ownerUserId: row.ownerUserId,
    authorUserId: row.authorUserId,
    scope: row.scope,
    organizationId: row.organizationId,
    kind: row.kind,
    origin: row.origin,
    currentRevision: row.currentRevision,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    revision: mapAnnotationRevision(revision),
  };
}

function mapConversationItem(
  row: Prisma.KnowledgeConversationItemGetPayload<Record<string, never>>,
) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    knowledgeItemId: row.knowledgeItemId,
    relationType: row.relationType,
    ordinal: row.ordinal,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function mapConversation(row: ConversationRow): KnowledgeConversation {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    title: row.title,
    sourceType: row.sourceType,
    provider: row.provider,
    model: row.model,
    capturedAt: row.capturedAt,
    importedAt: row.importedAt,
    contentHash: row.contentHash,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    items: row.items.map(mapConversationItem),
  };
}

function mapTurn(
  row: Prisma.KnowledgeConversationTurnGetPayload<Record<string, never>>,
): KnowledgeConversationTurn {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    role: row.role,
    origin: row.origin,
    content: row.content,
    name: row.name,
    occurredAt: row.occurredAt,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function mapSynthesis(row: SynthesisRow): KnowledgeSynthesis {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    scope: row.scope,
    organizationId: row.organizationId,
    title: row.title,
    currentVersion: row.currentVersion,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function sourceIdentity(row: SynthesisSourceRow): {
  kind: KnowledgeSynthesisSourceKind;
  sourceId: string;
} {
  const values = [
    ['item', row.sourceKnowledgeItemId],
    ['snapshot', row.sourceSnapshotId],
    ['annotation', row.sourceAnnotationId],
    ['annotation_revision', row.sourceAnnotationRevisionId],
    ['conversation', row.sourceConversationId],
    ['conversation_turn', row.sourceConversationTurnId],
    ['synthesis_version', row.sourceSynthesisVersionId],
  ] as const;
  const defined = values.filter((entry) => entry[1] !== null);
  if (defined.length !== 1 || defined[0]?.[1] === null) {
    throw new Error('knowledge_synthesis_source_integrity_invalid');
  }
  return { kind: defined[0][0], sourceId: defined[0][1] };
}

function mapSynthesisSource(
  row: SynthesisSourceRow,
  accessible: boolean,
): KnowledgeSynthesisSource {
  const source = sourceIdentity(row);
  return {
    id: accessible ? row.id : null,
    synthesisVersionId: row.synthesisVersionId,
    kind: source.kind,
    sourceId: accessible ? source.sourceId : null,
    relationType: row.relationType,
    ordinal: row.ordinal,
    accessible,
    createdAt: accessible ? row.createdAt : null,
    createdBy: accessible ? row.createdBy : null,
  };
}

function mapQuestions(value: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('knowledge_synthesis_questions_invalid');
  }
  return value.map((entry) => entry as string);
}

function beforePageBoundary(
  boundary: KnowledgePageBoundary | undefined,
): Prisma.Enumerable<Prisma.KnowledgeAnnotationWhereInput> | undefined {
  if (!boundary) return undefined;
  return [
    {
      OR: [
        { updatedAt: { lt: boundary.updatedAt } },
        { updatedAt: boundary.updatedAt, id: { lt: boundary.id } },
      ],
    },
  ];
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
        AND: {
          items: {
            every: { knowledgeItem: { is: itemVisibility } },
          },
        },
      },
    ],
  };
}

function annotationHistoryVisibilityWhere(
  actor: KnowledgeActor,
  itemId: string,
): Prisma.KnowledgeAnnotationWhereInput {
  return {
    knowledgeItemId: itemId,
    OR: [
      {
        ownerUserId: actor.userId,
        knowledgeItem: {
          is: { ownerUserId: actor.userId, deletedAt: null },
        },
      },
      {
        deletedAt: null,
        knowledgeItem: { is: buildKnowledgeVisibilityWhere(actor) },
      },
    ],
  };
}

function synthesisBaseVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeSynthesisWhereInput {
  const organizationId = actor.organizationId?.trim();
  return {
    deletedAt: null,
    OR: [
      { ownerUserId: actor.userId },
      ...(organizationId
        ? [{ scope: 'organization' as const, organizationId }]
        : []),
    ],
  };
}

function sourceData(source: KnowledgeSynthesisSourceInput, ordinal: number) {
  const base = {
    relationType: source.relationType,
    ordinal,
  };
  switch (source.kind) {
    case 'item':
      return { ...base, sourceKnowledgeItemId: source.sourceId };
    case 'snapshot':
      return { ...base, sourceSnapshotId: source.sourceId };
    case 'annotation':
      return { ...base, sourceAnnotationId: source.sourceId };
    case 'annotation_revision':
      return { ...base, sourceAnnotationRevisionId: source.sourceId };
    case 'conversation':
      return { ...base, sourceConversationId: source.sourceId };
    case 'conversation_turn':
      return { ...base, sourceConversationTurnId: source.sourceId };
    case 'synthesis_version':
      return { ...base, sourceSynthesisVersionId: source.sourceId };
  }
}

export class PrismaKnowledgeAccessRepository implements KnowledgeAccessRepository {
  constructor(private readonly client: KnowledgeProvenanceDbClient = prisma) {}

  async findVisibleItem(actor: KnowledgeActor, itemId: string) {
    const row = await this.client.knowledgeItem.findFirst({
      where: { AND: [{ id: itemId }, buildKnowledgeVisibilityWhere(actor)] },
      select: {
        id: true,
        ownerUserId: true,
        scope: true,
        organizationId: true,
      },
    });
    return row ? mapItemAccess(row) : null;
  }

  async findOwnedItem(actor: KnowledgeActor, itemId: string) {
    const row = await this.client.knowledgeItem.findFirst({
      where: { id: itemId, ownerUserId: actor.userId, deletedAt: null },
      select: {
        id: true,
        ownerUserId: true,
        scope: true,
        organizationId: true,
      },
    });
    return row ? mapItemAccess(row) : null;
  }
}

export class PrismaKnowledgeAnnotationRepository implements KnowledgeAnnotationRepository {
  constructor(private readonly client: KnowledgeProvenanceDbClient = prisma) {}

  async withConsistentSnapshot<T>(
    read: (repository: KnowledgeAnnotationRepository) => Promise<T>,
  ): Promise<T> {
    const host = this.client as KnowledgeProvenanceDbClient &
      Partial<KnowledgeProvenanceTransactionHost>;
    if (typeof host.$transaction !== 'function') return read(this);
    return host.$transaction(
      async (client) => read(new PrismaKnowledgeAnnotationRepository(client)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async listVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    limit: number;
    boundary?: KnowledgePageBoundary;
  }) {
    const item = await new PrismaKnowledgeAccessRepository(
      this.client,
    ).findVisibleItem(input.actor, input.itemId);
    if (!item) return null;
    const rows = await this.client.knowledgeAnnotation.findMany({
      where: {
        knowledgeItemId: item.id,
        deletedAt: null,
        knowledgeItem: { is: buildKnowledgeVisibilityWhere(input.actor) },
        AND: beforePageBoundary(input.boundary),
      },
      include: annotationInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const selected = rows.slice(0, input.limit);
    const last = selected[selected.length - 1];
    return {
      items: selected.map(mapAnnotation),
      nextBoundary:
        hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  async findVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    annotationId: string;
    includeDeleted?: boolean;
  }) {
    const item = await new PrismaKnowledgeAccessRepository(
      this.client,
    ).findVisibleItem(input.actor, input.itemId);
    if (!item) return null;
    const row = await this.client.knowledgeAnnotation.findFirst({
      where: {
        id: input.annotationId,
        knowledgeItemId: item.id,
        knowledgeItem: { is: buildKnowledgeVisibilityWhere(input.actor) },
        ...(!input.includeDeleted ? { deletedAt: null } : {}),
      },
      include: annotationInclude,
    });
    return row ? mapAnnotation(row) : null;
  }

  async listRevisionsVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    annotationId: string;
    limit: number;
    beforeRevision?: number;
  }) {
    const annotation = await this.client.knowledgeAnnotation.findFirst({
      where: {
        id: input.annotationId,
        ...annotationHistoryVisibilityWhere(input.actor, input.itemId),
      },
      select: { id: true },
    });
    if (!annotation) return null;
    const rows = await this.client.knowledgeAnnotationRevision.findMany({
      where: {
        annotationId: annotation.id,
        annotation: {
          is: annotationHistoryVisibilityWhere(input.actor, input.itemId),
        },
        ...(input.beforeRevision
          ? { revision: { lt: input.beforeRevision } }
          : {}),
      },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const selected = rows.slice(0, input.limit);
    const last = selected[selected.length - 1];
    return {
      items: selected.map(mapAnnotationRevision),
      nextBoundary:
        hasMore && last ? { sequence: last.revision, id: last.id } : null,
    };
  }

  async create(input: {
    item: KnowledgeItemAccess;
    actor: KnowledgeActor;
    kind: KnowledgeAnnotation['kind'];
    origin: KnowledgeAnnotation['origin'];
    content: string;
  }) {
    const row = await this.client.knowledgeAnnotation.create({
      data: {
        knowledgeItemId: input.item.id,
        ownerUserId: input.item.ownerUserId,
        authorUserId: input.actor.userId,
        scope: input.item.scope,
        organizationId: input.item.organizationId,
        kind: input.kind,
        origin: input.origin,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
        revisions: {
          create: {
            revision: 1,
            kind: input.kind,
            origin: input.origin,
            content: input.content,
            createdBy: input.actor.userId,
          },
        },
      },
      include: annotationInclude,
    });
    return mapAnnotation(row);
  }

  async findOwned(input: {
    actor: KnowledgeActor;
    itemId: string;
    annotationId: string;
    deleted: boolean;
  }) {
    const row = await this.client.knowledgeAnnotation.findFirst({
      where: {
        id: input.annotationId,
        knowledgeItemId: input.itemId,
        ownerUserId: input.actor.userId,
        knowledgeItem: {
          is: { ownerUserId: input.actor.userId, deletedAt: null },
        },
        deletedAt: input.deleted ? { not: null } : null,
      },
      include: annotationInclude,
    });
    return row ? mapAnnotation(row) : null;
  }

  async revise(input: {
    actor: KnowledgeActor;
    annotationId: string;
    expectedRevision: number;
    kind: KnowledgeAnnotation['kind'];
    origin: KnowledgeAnnotation['origin'];
    content: string;
  }) {
    const updated = await this.client.knowledgeAnnotation.updateMany({
      where: {
        id: input.annotationId,
        ownerUserId: input.actor.userId,
        currentRevision: input.expectedRevision,
        deletedAt: null,
        knowledgeItem: {
          is: { ownerUserId: input.actor.userId, deletedAt: null },
        },
      },
      data: {
        currentRevision: { increment: 1 },
        kind: input.kind,
        origin: input.origin,
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) return null;
    await this.client.knowledgeAnnotationRevision.create({
      data: {
        annotationId: input.annotationId,
        revision: input.expectedRevision + 1,
        kind: input.kind,
        origin: input.origin,
        content: input.content,
        createdBy: input.actor.userId,
      },
    });
    const row = await this.client.knowledgeAnnotation.findUniqueOrThrow({
      where: { id: input.annotationId },
      include: annotationInclude,
    });
    return mapAnnotation(row);
  }

  async logicallyDelete(input: {
    actor: KnowledgeActor;
    annotationId: string;
    expectedRevision: number;
    deletedAt: Date;
  }) {
    const updated = await this.client.knowledgeAnnotation.updateMany({
      where: {
        id: input.annotationId,
        ownerUserId: input.actor.userId,
        currentRevision: input.expectedRevision,
        deletedAt: null,
        knowledgeItem: {
          is: { ownerUserId: input.actor.userId, deletedAt: null },
        },
      },
      data: {
        deletedAt: input.deletedAt,
        deletedBy: input.actor.userId,
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.client.knowledgeAnnotation.findUniqueOrThrow({
      where: { id: input.annotationId },
      include: annotationInclude,
    });
    return mapAnnotation(row);
  }
}

export class PrismaKnowledgeConversationRepository implements KnowledgeConversationRepository {
  constructor(private readonly client: KnowledgeProvenanceDbClient = prisma) {}

  async withConsistentSnapshot<T>(
    read: (repository: KnowledgeConversationRepository) => Promise<T>,
  ): Promise<T> {
    const host = this.client as KnowledgeProvenanceDbClient &
      Partial<KnowledgeProvenanceTransactionHost>;
    if (typeof host.$transaction !== 'function') return read(this);
    return host.$transaction(
      async (client) => read(new PrismaKnowledgeConversationRepository(client)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async listVisible(input: {
    actor: KnowledgeActor;
    limit: number;
    boundary?: KnowledgePageBoundary;
  }) {
    const rows = await this.client.knowledgeConversation.findMany({
      where: {
        AND: [
          conversationVisibilityWhere(input.actor),
          ...(input.boundary
            ? [
                {
                  OR: [
                    { updatedAt: { lt: input.boundary.updatedAt } },
                    {
                      updatedAt: input.boundary.updatedAt,
                      id: { lt: input.boundary.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      include: conversationInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const selected = rows.slice(0, input.limit);
    const last = selected[selected.length - 1];
    return {
      items: selected.map(mapConversation),
      nextBoundary:
        hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  async findVisible(input: { actor: KnowledgeActor; conversationId: string }) {
    const row = await this.client.knowledgeConversation.findFirst({
      where: {
        AND: [
          { id: input.conversationId },
          conversationVisibilityWhere(input.actor),
        ],
      },
      include: conversationInclude,
    });
    return row ? mapConversation(row) : null;
  }

  async create(input: {
    actor: KnowledgeActor;
    title: string;
    sourceType: KnowledgeConversation['sourceType'];
    provider: string | null;
    model: string | null;
    capturedAt: Date;
    contentHash: string;
  }) {
    const row = await this.client.knowledgeConversation.create({
      data: {
        ownerUserId: input.actor.userId,
        title: input.title,
        sourceType: input.sourceType,
        provider: input.provider,
        model: input.model,
        capturedAt: input.capturedAt,
        contentHash: input.contentHash,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
      },
      include: conversationInclude,
    });
    return mapConversation(row);
  }

  async findOwned(input: { actor: KnowledgeActor; conversationId: string }) {
    const row = await this.client.knowledgeConversation.findFirst({
      where: {
        AND: [
          { id: input.conversationId, ownerUserId: input.actor.userId },
          conversationVisibilityWhere(input.actor),
        ],
      },
      include: conversationInclude,
    });
    return row ? mapConversation(row) : null;
  }

  async addItem(input: {
    actor: KnowledgeActor;
    conversationId: string;
    itemId: string;
    relationType: KnowledgeConversation['items'][number]['relationType'];
    ordinal: number;
    expectedVersion: number;
  }) {
    const updated = await this.client.knowledgeConversation.updateMany({
      where: {
        id: input.conversationId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: { version: { increment: 1 }, updatedBy: input.actor.userId },
    });
    if (updated.count !== 1) return null;
    await this.client.knowledgeConversationItem.create({
      data: {
        conversationId: input.conversationId,
        knowledgeItemId: input.itemId,
        ownerUserId: input.actor.userId,
        relationType: input.relationType,
        ordinal: input.ordinal,
        createdBy: input.actor.userId,
      },
    });
    const row = await this.client.knowledgeConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: conversationInclude,
    });
    return mapConversation(row);
  }

  async removeItem(input: {
    actor: KnowledgeActor;
    conversationId: string;
    itemId: string;
    expectedVersion: number;
  }) {
    const updated = await this.client.knowledgeConversation.updateMany({
      where: {
        id: input.conversationId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: { version: { increment: 1 }, updatedBy: input.actor.userId },
    });
    if (updated.count !== 1) return null;
    const removed = await this.client.knowledgeConversationItem.deleteMany({
      where: {
        conversationId: input.conversationId,
        knowledgeItemId: input.itemId,
      },
    });
    if (removed.count !== 1) throw new KnowledgeProvenanceConflictError();
    const row = await this.client.knowledgeConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: conversationInclude,
    });
    return mapConversation(row);
  }

  async listTurnsVisible(input: {
    actor: KnowledgeActor;
    conversationId: string;
    limit: number;
    boundary?: KnowledgeSequenceBoundary;
  }) {
    const conversation = await this.findVisible(input);
    if (!conversation) return null;
    const rows = await this.client.knowledgeConversationTurn.findMany({
      where: {
        conversationId: input.conversationId,
        conversation: { is: conversationVisibilityWhere(input.actor) },
        ...(input.boundary
          ? {
              OR: [
                { sequence: { gt: input.boundary.sequence } },
                {
                  sequence: input.boundary.sequence,
                  id: { gt: input.boundary.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const selected = rows.slice(0, input.limit);
    const last = selected[selected.length - 1];
    return {
      items: selected.map(mapTurn),
      nextBoundary:
        hasMore && last ? { sequence: last.sequence, id: last.id } : null,
    };
  }

  async nextTurnSequence(conversationId: string) {
    const latest = await this.client.knowledgeConversationTurn.findFirst({
      where: { conversationId },
      orderBy: [{ sequence: 'desc' }, { id: 'desc' }],
      select: { sequence: true },
    });
    return (latest?.sequence ?? 0) + 1;
  }

  async appendTurn(input: {
    actor: KnowledgeActor;
    conversationId: string;
    expectedVersion: number;
    sequence: number;
    role: KnowledgeConversationTurn['role'];
    origin: KnowledgeConversationTurn['origin'];
    content: string;
    name: string | null;
    occurredAt: Date | null;
    contentHash: string;
    aggregateContentHash: string;
  }) {
    const updated = await this.client.knowledgeConversation.updateMany({
      where: {
        id: input.conversationId,
        ownerUserId: input.actor.userId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        version: { increment: 1 },
        contentHash: input.aggregateContentHash,
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) return null;
    const turn = await this.client.knowledgeConversationTurn.create({
      data: {
        conversationId: input.conversationId,
        sequence: input.sequence,
        role: input.role,
        origin: input.origin,
        content: input.content,
        name: input.name,
        occurredAt: input.occurredAt,
        contentHash: input.contentHash,
        createdBy: input.actor.userId,
      },
    });
    const conversation =
      await this.client.knowledgeConversation.findUniqueOrThrow({
        where: { id: input.conversationId },
        include: conversationInclude,
      });
    return { conversation: mapConversation(conversation), turn: mapTurn(turn) };
  }
}

export class PrismaKnowledgeSynthesisRepository implements KnowledgeSynthesisRepository {
  constructor(private readonly client: KnowledgeProvenanceDbClient = prisma) {}

  async withConsistentSnapshot<T>(
    read: (repository: KnowledgeSynthesisRepository) => Promise<T>,
  ): Promise<T> {
    const host = this.client as KnowledgeProvenanceDbClient &
      Partial<KnowledgeProvenanceTransactionHost>;
    if (typeof host.$transaction !== 'function') return read(this);
    return host.$transaction(
      async (client) => read(new PrismaKnowledgeSynthesisRepository(client)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async sourceAccessible(
    actor: KnowledgeActor,
    source: SynthesisSourceRow,
    context: KnowledgeSynthesisAccessContext,
    path: Set<string>,
    depth: number,
  ): Promise<boolean> {
    const identity = sourceIdentity(source);
    consumeSynthesisAccessBudget(context, 'edge');
    if (identity.kind === 'synthesis_version') {
      const nextDepth = depth + 1;
      if (nextDepth > knowledgeProvenanceLimits.synthesisProvenanceDepth) {
        return false;
      }
      return this.synthesisVersionAccessible(
        actor,
        identity.sourceId,
        context,
        path,
        nextDepth,
      );
    }
    const memoKey = `${identity.kind}:${identity.sourceId}`;
    const memoized = context.sourceMemo.get(memoKey);
    if (memoized !== undefined) return memoized;
    consumeSynthesisAccessBudget(context, 'query');
    let accessible: boolean;
    switch (identity.kind) {
      case 'item':
        accessible = Boolean(
          await this.client.knowledgeItem.findFirst({
            where: {
              AND: [
                { id: identity.sourceId },
                buildKnowledgeVisibilityWhere(actor),
              ],
            },
            select: { id: true },
          }),
        );
        break;
      case 'snapshot':
        accessible = Boolean(
          await this.client.knowledgeSnapshot.findFirst({
            where: {
              id: identity.sourceId,
              knowledgeItem: { is: buildKnowledgeVisibilityWhere(actor) },
            },
            select: { id: true },
          }),
        );
        break;
      case 'annotation':
        accessible = Boolean(
          await this.client.knowledgeAnnotation.findFirst({
            where: {
              id: identity.sourceId,
              deletedAt: null,
              knowledgeItem: { is: buildKnowledgeVisibilityWhere(actor) },
            },
            select: { id: true },
          }),
        );
        break;
      case 'annotation_revision':
        accessible = Boolean(
          await this.client.knowledgeAnnotationRevision.findFirst({
            where: {
              id: identity.sourceId,
              annotation: {
                is: {
                  deletedAt: null,
                  knowledgeItem: {
                    is: buildKnowledgeVisibilityWhere(actor),
                  },
                },
              },
            },
            select: { id: true },
          }),
        );
        break;
      case 'conversation':
        accessible = Boolean(
          await this.client.knowledgeConversation.findFirst({
            where: {
              AND: [
                { id: identity.sourceId },
                conversationVisibilityWhere(actor),
              ],
            },
            select: { id: true },
          }),
        );
        break;
      case 'conversation_turn':
        accessible = Boolean(
          await this.client.knowledgeConversationTurn.findFirst({
            where: {
              id: identity.sourceId,
              conversation: { is: conversationVisibilityWhere(actor) },
            },
            select: { id: true },
          }),
        );
        break;
    }
    context.sourceMemo.set(memoKey, accessible);
    return accessible;
  }

  private async synthesisVersionAccessible(
    actor: KnowledgeActor,
    versionId: string,
    context: KnowledgeSynthesisAccessContext,
    path: Set<string>,
    depth: number,
  ): Promise<boolean> {
    if (path.has(versionId)) {
      return false;
    }
    const memoKey = `${versionId}:${depth}`;
    const memoized = context.versionMemo.get(memoKey);
    if (memoized !== undefined) return memoized;
    consumeSynthesisAccessBudget(context, 'node');
    consumeSynthesisAccessBudget(context, 'query');
    path.add(versionId);
    const version = await this.client.knowledgeSynthesisVersion.findFirst({
      where: {
        id: versionId,
        synthesis: { is: synthesisBaseVisibilityWhere(actor) },
      },
      include: {
        synthesis: { select: { ownerUserId: true } },
        sources: true,
      },
    });
    let accessible = false;
    if (version) {
      if (version.synthesis.ownerUserId === actor.userId) {
        accessible = true;
      } else if (version.sources.length > 0) {
        accessible = true;
        for (const source of version.sources) {
          if (
            !(await this.sourceAccessible(actor, source, context, path, depth))
          ) {
            accessible = false;
            break;
          }
        }
      }
    }
    path.delete(versionId);
    context.versionMemo.set(memoKey, accessible);
    return accessible;
  }

  private async versionSourcesAccessible(
    actor: KnowledgeActor,
    version: SynthesisVersionRow,
    context: KnowledgeSynthesisAccessContext,
  ): Promise<boolean> {
    if (version.sources.length === 0) return false;
    for (const source of version.sources) {
      if (
        !(await this.sourceAccessible(actor, source, context, new Set(), 0))
      ) {
        return false;
      }
    }
    return true;
  }

  private async versionWithAccess(
    actor: KnowledgeActor,
    row: SynthesisVersionRow,
    context: KnowledgeSynthesisAccessContext,
  ): Promise<KnowledgeSynthesisVersion> {
    const sources: KnowledgeSynthesisSource[] = [];
    for (const source of row.sources) {
      sources.push(
        mapSynthesisSource(
          source,
          await this.sourceAccessible(actor, source, context, new Set(), 0),
        ),
      );
    }
    return {
      id: row.id,
      synthesisId: row.synthesisId,
      version: row.version,
      content: row.content,
      unresolvedQuestions: mapQuestions(row.unresolvedQuestions),
      confidenceBasisPoints: row.confidenceBasisPoints,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      sources,
    };
  }

  private async findBaseVisible(
    actor: KnowledgeActor,
    synthesisId: string,
    context: KnowledgeSynthesisAccessContext,
  ) {
    consumeSynthesisAccessBudget(context, 'query');
    const synthesis = await this.client.knowledgeSynthesis.findFirst({
      where: {
        id: synthesisId,
        ...synthesisBaseVisibilityWhere(actor),
      },
    });
    if (!synthesis) return null;
    consumeSynthesisAccessBudget(context, 'query');
    const version = await this.client.knowledgeSynthesisVersion.findUnique({
      where: {
        synthesisId_version: {
          synthesisId: synthesis.id,
          version: synthesis.currentVersion,
        },
      },
      include: synthesisVersionInclude,
    });
    if (!version)
      throw new Error('knowledge_synthesis_current_version_missing');
    if (
      synthesis.ownerUserId !== actor.userId &&
      !(await this.versionSourcesAccessible(actor, version, context))
    ) {
      return null;
    }
    return { synthesis, version };
  }

  async listVisible(input: {
    actor: KnowledgeActor;
    limit: number;
    boundary?: KnowledgePageBoundary;
    accessContext: KnowledgeSynthesisAccessContext;
  }) {
    const context = input.accessContext;
    const visible: SynthesisRow[] = [];
    let boundary = input.boundary;
    let exhausted = false;
    let candidateBudgetReached = false;
    let scanned = 0;
    while (visible.length <= input.limit && !exhausted) {
      const remaining =
        knowledgeProvenanceLimits.synthesisListCandidates - scanned;
      if (remaining <= 0) {
        exhausted = true;
        break;
      }
      const take = Math.min(input.limit + 1, remaining);
      consumeSynthesisAccessBudget(context, 'query');
      const rows = await this.client.knowledgeSynthesis.findMany({
        where: {
          AND: [
            synthesisBaseVisibilityWhere(input.actor),
            ...(boundary
              ? [
                  {
                    OR: [
                      { updatedAt: { lt: boundary.updatedAt } },
                      {
                        updatedAt: boundary.updatedAt,
                        id: { lt: boundary.id },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        scanned += 1;
        if (await this.findBaseVisible(input.actor, row.id, context))
          visible.push(row);
        if (visible.length > input.limit) break;
      }
      candidateBudgetReached =
        scanned >= knowledgeProvenanceLimits.synthesisListCandidates;
      const lastScanned = rows[rows.length - 1];
      if (!lastScanned || rows.length < take) exhausted = true;
      else boundary = { updatedAt: lastScanned.updatedAt, id: lastScanned.id };
      if (candidateBudgetReached) exhausted = true;
    }
    const hasMore = visible.length > input.limit;
    const selected = visible.slice(0, input.limit);
    const last = selected[selected.length - 1];
    return {
      items: selected.map(mapSynthesis),
      nextBoundary:
        hasMore && last && !candidateBudgetReached
          ? { updatedAt: last.updatedAt, id: last.id }
          : null,
    };
  }

  async findVisible(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    accessContext: KnowledgeSynthesisAccessContext;
  }) {
    const context = input.accessContext;
    const result = await this.findBaseVisible(
      input.actor,
      input.synthesisId,
      context,
    );
    if (!result) return null;
    return {
      synthesis: mapSynthesis(result.synthesis),
      currentVersion: await this.versionWithAccess(
        input.actor,
        result.version,
        context,
      ),
    };
  }

  async listVersionsVisible(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    limit: number;
    beforeVersion?: number;
    accessContext: KnowledgeSynthesisAccessContext;
  }) {
    const context = input.accessContext;
    const visible = await this.findBaseVisible(
      input.actor,
      input.synthesisId,
      context,
    );
    if (!visible) return null;
    consumeSynthesisAccessBudget(context, 'query');
    const rows = await this.client.knowledgeSynthesisVersion.findMany({
      where: {
        synthesisId: input.synthesisId,
        ...(input.beforeVersion
          ? { version: { lt: input.beforeVersion } }
          : {}),
      },
      include: synthesisVersionInclude,
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const selected = rows.slice(0, input.limit);
    if (visible.synthesis.ownerUserId !== input.actor.userId) {
      for (const row of rows) {
        if (!(await this.versionSourcesAccessible(input.actor, row, context))) {
          return null;
        }
      }
    }
    const mapped: KnowledgeSynthesisVersion[] = [];
    for (const row of selected)
      mapped.push(await this.versionWithAccess(input.actor, row, context));
    const last = selected[selected.length - 1];
    return {
      items: mapped,
      nextBoundary:
        hasMore && last ? { sequence: last.version, id: last.id } : null,
    };
  }

  async validateSources(input: {
    actor: KnowledgeActor;
    sources: KnowledgeSynthesisSourceInput[];
    accessContext: KnowledgeSynthesisAccessContext;
    excludedSynthesisId?: string;
  }) {
    const context = input.accessContext;
    for (const source of input.sources) {
      if (source.kind === 'synthesis_version' && input.excludedSynthesisId) {
        consumeSynthesisAccessBudget(context, 'query');
        const sameAggregate =
          await this.client.knowledgeSynthesisVersion.findFirst({
            where: {
              id: source.sourceId,
              synthesisId: input.excludedSynthesisId,
            },
            select: { id: true },
          });
        if (sameAggregate) return false;
      }
      const synthetic = {
        id: '__validation__',
        synthesisVersionId: '__validation__',
        relationType: source.relationType,
        ordinal: 0,
        sourceKnowledgeItemId: source.kind === 'item' ? source.sourceId : null,
        sourceSnapshotId: source.kind === 'snapshot' ? source.sourceId : null,
        sourceAnnotationId:
          source.kind === 'annotation' ? source.sourceId : null,
        sourceAnnotationRevisionId:
          source.kind === 'annotation_revision' ? source.sourceId : null,
        sourceConversationId:
          source.kind === 'conversation' ? source.sourceId : null,
        sourceConversationTurnId:
          source.kind === 'conversation_turn' ? source.sourceId : null,
        sourceSynthesisVersionId:
          source.kind === 'synthesis_version' ? source.sourceId : null,
        createdAt: new Date(0),
        createdBy: input.actor.userId,
      } satisfies SynthesisSourceRow;
      if (
        !(await this.sourceAccessible(
          input.actor,
          synthetic,
          context,
          new Set(),
          0,
        ))
      ) {
        return false;
      }
    }
    return true;
  }

  async create(input: {
    actor: KnowledgeActor;
    scope: KnowledgeSynthesis['scope'];
    organizationId: string | null;
    title: string;
    content: string;
    unresolvedQuestions: string[];
    confidenceBasisPoints: number | null;
    sources: KnowledgeSynthesisSourceInput[];
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<KnowledgeSynthesisDetail> {
    const synthesis = await this.client.knowledgeSynthesis.create({
      data: {
        ownerUserId: input.actor.userId,
        scope: input.scope,
        organizationId: input.organizationId,
        title: input.title,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
        versions: {
          create: {
            version: 1,
            content: input.content,
            unresolvedQuestions: input.unresolvedQuestions,
            confidenceBasisPoints: input.confidenceBasisPoints,
            createdBy: input.actor.userId,
            sources: {
              create: input.sources.map((source, ordinal) => ({
                ...sourceData(source, ordinal),
                createdBy: input.actor.userId,
              })),
            },
          },
        },
      },
    });
    const detail = await this.findVisible({
      actor: input.actor,
      synthesisId: synthesis.id,
      accessContext: input.accessContext,
    });
    if (!detail)
      throw new Error('knowledge_synthesis_create_visibility_failed');
    return detail;
  }

  async findOwned(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    accessContext: KnowledgeSynthesisAccessContext;
  }) {
    const synthesis = await this.client.knowledgeSynthesis.findFirst({
      where: {
        id: input.synthesisId,
        ownerUserId: input.actor.userId,
        deletedAt: null,
      },
    });
    if (!synthesis) return null;
    const version =
      await this.client.knowledgeSynthesisVersion.findUniqueOrThrow({
        where: {
          synthesisId_version: {
            synthesisId: synthesis.id,
            version: synthesis.currentVersion,
          },
        },
        include: synthesisVersionInclude,
      });
    return {
      synthesis: mapSynthesis(synthesis),
      currentVersion: await this.versionWithAccess(
        input.actor,
        version,
        input.accessContext,
      ),
    };
  }

  async appendVersion(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    expectedVersion: number;
    content: string;
    unresolvedQuestions: string[];
    confidenceBasisPoints: number | null;
    sources: KnowledgeSynthesisSourceInput[];
    accessContext: KnowledgeSynthesisAccessContext;
  }) {
    const updated = await this.client.knowledgeSynthesis.updateMany({
      where: {
        id: input.synthesisId,
        ownerUserId: input.actor.userId,
        currentVersion: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        currentVersion: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (updated.count !== 1) return null;
    await this.client.knowledgeSynthesisVersion.create({
      data: {
        synthesisId: input.synthesisId,
        version: input.expectedVersion + 1,
        content: input.content,
        unresolvedQuestions: input.unresolvedQuestions,
        confidenceBasisPoints: input.confidenceBasisPoints,
        createdBy: input.actor.userId,
        sources: {
          create: input.sources.map((source, ordinal) => ({
            ...sourceData(source, ordinal),
            createdBy: input.actor.userId,
          })),
        },
      },
    });
    return this.findOwned(input);
  }
}

export class PrismaKnowledgeProvenanceUnitOfWork implements KnowledgeProvenanceUnitOfWork {
  constructor(
    private readonly host: KnowledgeProvenanceTransactionHost = prisma as PrismaClient,
  ) {}

  async run<T>(
    work: (transaction: KnowledgeProvenanceTransaction) => Promise<T>,
  ) {
    try {
      return await this.host.$transaction(
        async (client) =>
          work({
            access: new PrismaKnowledgeAccessRepository(client),
            annotations: new PrismaKnowledgeAnnotationRepository(client),
            conversations: new PrismaKnowledgeConversationRepository(client),
            syntheses: new PrismaKnowledgeSynthesisRepository(client),
            audit: new PrismaKnowledgeProvenanceAuditWriter(client),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      if (
        error instanceof KnowledgeProvenanceConflictError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034'))
      ) {
        throw new KnowledgeProvenanceConflictError();
      }
      throw error;
    }
  }
}

export const prismaKnowledgeAnnotationRepository =
  new PrismaKnowledgeAnnotationRepository(prisma);
export const prismaKnowledgeConversationRepository =
  new PrismaKnowledgeConversationRepository(prisma);
export const prismaKnowledgeSynthesisRepository =
  new PrismaKnowledgeSynthesisRepository(prisma);
export const prismaKnowledgeProvenanceUnitOfWork =
  new PrismaKnowledgeProvenanceUnitOfWork(prisma);
