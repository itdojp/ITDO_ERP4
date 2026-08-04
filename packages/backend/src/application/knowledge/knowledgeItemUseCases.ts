import {
  isKnowledgeDeletionReasonCode,
  knowledgeMutableFields,
  type KnowledgeActor,
  type KnowledgeAuditActor,
  type KnowledgeItem,
  type KnowledgeItemReadRepository,
  type KnowledgeItemScope,
  type KnowledgeItemStatus,
  type KnowledgeItemUpdateRecord,
  type KnowledgeListQuery,
  type KnowledgeMutableField,
  type KnowledgeSourceType,
  type KnowledgeUnitOfWork,
} from './knowledgeItemPorts.js';

export type KnowledgeApplicationFailure = {
  ok: false;
  statusCode: 400 | 404 | 409;
  code: 'invalid_request' | 'not_found' | 'version_conflict';
  message: string;
};

export type KnowledgeApplicationResult<T> =
  { ok: true; value: T } | KnowledgeApplicationFailure;

export type CreateKnowledgeItemInput = {
  scope: KnowledgeItemScope;
  organizationGroupIds?: string[];
  sourceType: KnowledgeSourceType;
  canonicalUrl?: string | null;
  title?: string | null;
  sourceAuthor?: string | null;
  publishedAt?: string | null;
  capturedAt?: string;
  saveReason?: string | null;
  shortNote?: string | null;
  unresolvedQuestion?: string | null;
  status?: KnowledgeItemStatus;
};

export type UpdateKnowledgeItemInput = {
  expectedVersion: number;
  sourceType?: KnowledgeSourceType;
  canonicalUrl?: string | null;
  title?: string | null;
  sourceAuthor?: string | null;
  publishedAt?: string | null;
  capturedAt?: string;
  saveReason?: string | null;
  shortNote?: string | null;
  unresolvedQuestion?: string | null;
  status?: KnowledgeItemStatus;
};

function ok<T>(value: T): KnowledgeApplicationResult<T> {
  return { ok: true, value };
}

function invalid(message: string): KnowledgeApplicationFailure {
  return { ok: false, statusCode: 400, code: 'invalid_request', message };
}

function notFound(): KnowledgeApplicationFailure {
  return {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  };
}

function conflict(): KnowledgeApplicationFailure {
  return {
    ok: false,
    statusCode: 409,
    code: 'version_conflict',
    message: 'Knowledge item version conflict',
  };
}

function normalizeOptional(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

const trackingQueryName = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const credentialQueryTokens = new Set([
  'auth',
  'authorization',
  'credential',
  'jwt',
  'key',
  'oauth',
  'passwd',
  'password',
  'secret',
  'session',
  'sig',
  'signature',
  'ticket',
  'token',
]);

function isCredentialQueryName(name: string): boolean {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some((token) => credentialQueryTokens.has(token))) return true;
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.startsWith('xamz') || compact.startsWith('xgoog')) return true;
  if (
    compact === 'googleaccessid' ||
    compact === 'awsaccesskeyid' ||
    compact === 'key' ||
    compact === 'keypairid' ||
    compact === 'resourcekey' ||
    compact === 'policy' ||
    compact === 'expires' ||
    compact === 'auth' ||
    compact === 'sig' ||
    compact === 'state' ||
    compact === 'code'
  ) {
    return true;
  }
  return [
    'accesstoken',
    'accesskey',
    'apikey',
    'authorization',
    'credential',
    'jwt',
    'oauth',
    'password',
    'passwd',
    'secret',
    'session',
    'signature',
    'signedheaders',
    'token',
    'ticket',
  ].some((marker) => compact.includes(marker));
}

function normalizeCanonicalUrl(
  value: string | null | undefined,
): { ok: true; value: string | null | undefined } | { ok: false } {
  const normalized = normalizeOptional(value);
  if (normalized === undefined || normalized === null) {
    return { ok: true, value: normalized };
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false };
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (isCredentialQueryName(name)) return { ok: false };
      if (trackingQueryName.test(name)) {
        url.searchParams.delete(name);
      }
    }
    url.searchParams.sort();
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false };
  }
}

function parseOptionalDate(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
}

function validateExpectedVersion(
  value: number,
): KnowledgeApplicationFailure | null {
  if (!Number.isInteger(value) || value < 1) {
    return invalid('expectedVersion must be a positive integer');
  }
  return null;
}

function hasPrincipal(actor: KnowledgeActor): boolean {
  return actor.userId.trim().length > 0;
}

function createPatch(input: UpdateKnowledgeItemInput): {
  patch: KnowledgeItemUpdateRecord;
  changedFields: KnowledgeMutableField[];
} {
  const patch: KnowledgeItemUpdateRecord = {};
  const changedFields = knowledgeMutableFields.filter(
    (field) => field in input,
  );
  if ('sourceType' in input && input.sourceType !== undefined) {
    patch.sourceType = input.sourceType;
  }
  const canonicalUrl = normalizeCanonicalUrl(input.canonicalUrl);
  if ('canonicalUrl' in input && canonicalUrl.ok) {
    patch.canonicalUrl = canonicalUrl.value;
  }
  if ('title' in input) patch.title = normalizeOptional(input.title);
  if ('sourceAuthor' in input) {
    patch.sourceAuthor = normalizeOptional(input.sourceAuthor);
  }
  if ('publishedAt' in input) {
    patch.publishedAt = parseOptionalDate(input.publishedAt);
  }
  if ('capturedAt' in input) {
    const capturedAt = parseOptionalDate(input.capturedAt);
    if (capturedAt instanceof Date) patch.capturedAt = capturedAt;
  }
  if ('saveReason' in input) {
    patch.saveReason = normalizeOptional(input.saveReason);
  }
  if ('shortNote' in input) {
    patch.shortNote = normalizeOptional(input.shortNote);
  }
  if ('unresolvedQuestion' in input) {
    patch.unresolvedQuestion = normalizeOptional(input.unresolvedQuestion);
  }
  if ('status' in input && input.status !== undefined) {
    patch.status = input.status;
  }
  return { patch, changedFields };
}

export type KnowledgeItemService = ReturnType<
  typeof createKnowledgeItemService
>;

export function createKnowledgeItemService(dependencies: {
  reader: KnowledgeItemReadRepository;
  unitOfWork: KnowledgeUnitOfWork;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async list(input: {
      actor: KnowledgeActor;
      query: KnowledgeListQuery;
    }): Promise<KnowledgeItem[]> {
      if (!hasPrincipal(input.actor)) return [];
      return dependencies.reader.listVisible(input.actor, input.query);
    },

    async count(input: {
      actor: KnowledgeActor;
      scope?: KnowledgeItemScope;
      status?: KnowledgeItemStatus;
    }): Promise<number> {
      if (!hasPrincipal(input.actor)) return 0;
      return dependencies.reader.countVisible(input.actor, {
        scope: input.scope,
        status: input.status,
      });
    },

    async detail(input: {
      actor: KnowledgeActor;
      itemId: string;
    }): Promise<KnowledgeApplicationResult<KnowledgeItem>> {
      if (!hasPrincipal(input.actor)) return notFound();
      const item = await dependencies.reader.findVisibleById(
        input.actor,
        input.itemId,
      );
      return item ? ok(item) : notFound();
    },

    async create(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActor;
      body: CreateKnowledgeItemInput;
    }): Promise<KnowledgeApplicationResult<KnowledgeItem>> {
      if (!hasPrincipal(input.actor)) return invalid('actor is required');
      const groupAccountIds = uniqueStrings(input.body.organizationGroupIds);
      let organizationId: string | null = null;
      if (input.body.scope === 'organization') {
        organizationId = input.actor.organizationId?.trim() || null;
        if (!organizationId || groupAccountIds.length === 0) {
          return invalid(
            'organization scope requires organization context and at least one group grant',
          );
        }
        const actorGroups = new Set(input.actor.groupAccountIds);
        if (groupAccountIds.some((groupId) => !actorGroups.has(groupId))) {
          return invalid('organization group grants must belong to the actor');
        }
      } else if (groupAccountIds.length > 0) {
        return invalid(
          'personal scope cannot include organization group grants',
        );
      }

      const publishedAt = parseOptionalDate(input.body.publishedAt);
      if ('publishedAt' in input.body && publishedAt === undefined) {
        return invalid('publishedAt must be a valid date-time');
      }
      const capturedAt =
        'capturedAt' in input.body
          ? parseOptionalDate(input.body.capturedAt)
          : now();
      if (!(capturedAt instanceof Date)) {
        return invalid('capturedAt must be a valid date-time');
      }
      const canonicalUrl = normalizeCanonicalUrl(input.body.canonicalUrl);
      if (!canonicalUrl.ok) {
        return invalid('canonicalUrl must be an HTTP(S) URL');
      }

      return dependencies.unitOfWork.run(async (transaction) => {
        if (groupAccountIds.length > 0) {
          const activeCount =
            await transaction.items.countActiveGroups(groupAccountIds);
          if (activeCount !== groupAccountIds.length) {
            return invalid('organization group grant is not active');
          }
        }
        const item = await transaction.items.create({
          ownerUserId: input.actor.userId,
          scope: input.body.scope,
          organizationId,
          groupAccountIds,
          sourceType: input.body.sourceType,
          canonicalUrl: canonicalUrl.value ?? null,
          title: normalizeOptional(input.body.title) ?? null,
          sourceAuthor: normalizeOptional(input.body.sourceAuthor) ?? null,
          publishedAt: publishedAt ?? null,
          capturedAt,
          saveReason: normalizeOptional(input.body.saveReason) ?? null,
          shortNote: normalizeOptional(input.body.shortNote) ?? null,
          unresolvedQuestion:
            normalizeOptional(input.body.unresolvedQuestion) ?? null,
          status: input.body.status ?? 'inbox',
          createdBy: input.actor.userId,
          updatedBy: input.actor.userId,
        });
        await transaction.audit.write({
          action: 'knowledge_item_created',
          actor: input.auditActor,
          targetId: item.id,
          metadata: {
            scope: item.scope,
            status: item.status,
            version: item.version,
          },
        });
        return ok(item);
      });
    },

    async update(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActor;
      itemId: string;
      body: UpdateKnowledgeItemInput;
    }): Promise<KnowledgeApplicationResult<KnowledgeItem>> {
      if (!hasPrincipal(input.actor)) return notFound();
      const versionError = validateExpectedVersion(input.body.expectedVersion);
      if (versionError) return versionError;
      if (
        'publishedAt' in input.body &&
        parseOptionalDate(input.body.publishedAt) === undefined
      ) {
        return invalid('publishedAt must be a valid date-time');
      }
      if (
        'capturedAt' in input.body &&
        !(parseOptionalDate(input.body.capturedAt) instanceof Date)
      ) {
        return invalid('capturedAt must be a valid date-time');
      }
      if ('canonicalUrl' in input.body) {
        const canonicalUrl = normalizeCanonicalUrl(input.body.canonicalUrl);
        if (!canonicalUrl.ok) {
          return invalid('canonicalUrl must be an HTTP(S) URL');
        }
      }
      const { patch, changedFields } = createPatch(input.body);
      if (changedFields.length === 0) {
        return invalid('at least one mutable field is required');
      }

      return dependencies.unitOfWork.run(async (transaction) => {
        const current = await transaction.items.findOwnedForMutation({
          actor: input.actor,
          itemId: input.itemId,
          deleted: false,
        });
        if (!current) return notFound();
        if (current.version !== input.body.expectedVersion) return conflict();
        const item = await transaction.items.updateOwnedVersioned({
          actor: input.actor,
          itemId: input.itemId,
          expectedVersion: input.body.expectedVersion,
          patch,
        });
        if (!item) return conflict();
        await transaction.audit.write({
          action: 'knowledge_item_updated',
          actor: input.auditActor,
          targetId: item.id,
          metadata: {
            scope: item.scope,
            status: item.status,
            version: item.version,
            changedFields,
          },
        });
        return ok(item);
      });
    },

    async remove(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActor;
      itemId: string;
      expectedVersion: number;
      reasonCode: string;
    }): Promise<KnowledgeApplicationResult<KnowledgeItem>> {
      if (!hasPrincipal(input.actor)) return notFound();
      const versionError = validateExpectedVersion(input.expectedVersion);
      if (versionError) return versionError;
      const reasonCode = input.reasonCode.trim();
      if (!isKnowledgeDeletionReasonCode(reasonCode)) {
        return invalid('reasonCode must be a defined deletion reason code');
      }
      return dependencies.unitOfWork.run(async (transaction) => {
        const current = await transaction.items.findOwnedForMutation({
          actor: input.actor,
          itemId: input.itemId,
          deleted: false,
        });
        if (!current) return notFound();
        if (current.version !== input.expectedVersion) return conflict();
        const item = await transaction.items.deleteOwnedVersioned({
          actor: input.actor,
          itemId: input.itemId,
          expectedVersion: input.expectedVersion,
          deletedAt: now(),
          reasonCode,
        });
        if (!item) return conflict();
        await transaction.audit.write({
          action: 'knowledge_item_deleted',
          actor: input.auditActor,
          targetId: item.id,
          reasonCode,
          metadata: {
            scope: item.scope,
            status: item.status,
            version: item.version,
          },
        });
        return ok(item);
      });
    },

    async restore(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActor;
      itemId: string;
      expectedVersion: number;
    }): Promise<KnowledgeApplicationResult<KnowledgeItem>> {
      if (!hasPrincipal(input.actor)) return notFound();
      const versionError = validateExpectedVersion(input.expectedVersion);
      if (versionError) return versionError;
      return dependencies.unitOfWork.run(async (transaction) => {
        const current = await transaction.items.findOwnedForMutation({
          actor: input.actor,
          itemId: input.itemId,
          deleted: true,
        });
        if (!current) return notFound();
        if (current.version !== input.expectedVersion) return conflict();
        const item = await transaction.items.restoreOwnedVersioned({
          actor: input.actor,
          itemId: input.itemId,
          expectedVersion: input.expectedVersion,
        });
        if (!item) return conflict();
        await transaction.audit.write({
          action: 'knowledge_item_restored',
          actor: input.auditActor,
          targetId: item.id,
          metadata: {
            scope: item.scope,
            status: item.status,
            version: item.version,
          },
        });
        return ok(item);
      });
    },
  };
}
