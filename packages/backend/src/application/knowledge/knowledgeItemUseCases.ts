import {
  isKnowledgeDeletionReasonCode,
  knowledgeItemInputLimits,
  knowledgeItemScopes,
  knowledgeItemStatuses,
  knowledgeMutableFields,
  knowledgeSourceTypes,
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

function parseNestedHttpUrl(value: string): URL | null {
  let candidate = value.trim();
  for (let decodeCount = 0; decodeCount <= 2; decodeCount += 1) {
    const lowerCandidate = candidate.toLowerCase();
    if (
      lowerCandidate.startsWith('http://') ||
      lowerCandidate.startsWith('https://') ||
      candidate.startsWith('//') ||
      candidate.startsWith('/') ||
      candidate.startsWith('?')
    ) {
      try {
        const parsed = new URL(candidate, 'https://nested.invalid');
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          return parsed;
        }
      } catch {
        // Try one more percent-decoding layer below.
      }
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  return null;
}

function hasCredentialFragment(url: URL): boolean {
  if (!url.hash) return false;
  const fragment = url.hash.slice(1);
  const fragmentParams = new URLSearchParams(fragment);
  return [...fragmentParams.keys()].some(isCredentialQueryName);
}

function hasCredentialBearingNestedUrl(url: URL, depth = 0): boolean {
  for (const [name, value] of url.searchParams.entries()) {
    if (isCredentialQueryName(name)) return true;
    const nestedUrl = parseNestedHttpUrl(value);
    if (!nestedUrl) continue;
    if (
      nestedUrl.username ||
      nestedUrl.password ||
      hasCredentialFragment(nestedUrl)
    ) {
      return true;
    }
    if (depth >= 3 || hasCredentialBearingNestedUrl(nestedUrl, depth + 1)) {
      return true;
    }
  }
  return false;
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
    if (hasCredentialBearingNestedUrl(url)) return { ok: false };
    for (const name of [...url.searchParams.keys()]) {
      if (trackingQueryName.test(name)) {
        url.searchParams.delete(name);
      }
    }
    url.searchParams.sort();
    const serialized = url.toString();
    if (
      exceedsCodePointLimit(serialized, knowledgeItemInputLimits.canonicalUrl)
    ) {
      return { ok: false };
    }
    return { ok: true, value: serialized };
  } catch {
    return { ok: false };
  }
}

const rfc3339DateTime =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseOptionalDate(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const match = rfc3339DateTime.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }
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
  return typeof actor?.userId === 'string' && actor.userId.trim().length > 0;
}

function isValidItemId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !exceedsCodePointLimit(value, knowledgeItemInputLimits.itemId)
  );
}

function isValidListQuery(value: unknown): value is KnowledgeListQuery {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).some(
      (key) => !['limit', 'offset', 'scope', 'status'].includes(key),
    )
  ) {
    return false;
  }
  return (
    Number.isInteger(value.limit) &&
    Number(value.limit) >= 1 &&
    Number(value.limit) <= knowledgeItemInputLimits.listLimit &&
    Number.isInteger(value.offset) &&
    Number(value.offset) >= 0 &&
    Number(value.offset) <= knowledgeItemInputLimits.listOffset &&
    (value.scope === undefined ||
      isAllowedString(knowledgeItemScopes, value.scope)) &&
    (value.status === undefined ||
      isAllowedString(knowledgeItemStatuses, value.status))
  );
}

const nullableStringMutableFields = [
  'canonicalUrl',
  'title',
  'sourceAuthor',
  'saveReason',
  'shortNote',
  'unresolvedQuestion',
] as const;

const mutableStringMaxLengths: Record<
  (typeof nullableStringMutableFields)[number],
  number
> = {
  canonicalUrl: knowledgeItemInputLimits.canonicalUrl,
  title: knowledgeItemInputLimits.title,
  sourceAuthor: knowledgeItemInputLimits.sourceAuthor,
  saveReason: knowledgeItemInputLimits.saveReason,
  shortNote: knowledgeItemInputLimits.shortNote,
  unresolvedQuestion: knowledgeItemInputLimits.unresolvedQuestion,
};

function exceedsCodePointLimit(value: string, maximum: number): boolean {
  const codePoints = value[Symbol.iterator]();
  for (let length = 0; length <= maximum; length += 1) {
    if (codePoints.next().done) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedString<T extends readonly string[]>(
  allowed: T,
  value: unknown,
): value is T[number] {
  return (
    typeof value === 'string' &&
    allowed.some((candidate) => candidate === value)
  );
}

function validateMutableRuntimeInput(
  value: unknown,
): KnowledgeApplicationFailure | null {
  if (!isRecord(value)) return invalid('body must be an object');

  for (const field of knowledgeMutableFields) {
    if (field in value && value[field] === undefined) {
      return invalid(`${field} must not be undefined`);
    }
  }
  for (const field of nullableStringMutableFields) {
    const fieldValue = value[field];
    if (
      field in value &&
      fieldValue !== null &&
      typeof fieldValue !== 'string'
    ) {
      return invalid(`${field} must be a string or null`);
    }
    if (
      typeof fieldValue === 'string' &&
      exceedsCodePointLimit(fieldValue, mutableStringMaxLengths[field])
    ) {
      return invalid(
        `${field} must be at most ${mutableStringMaxLengths[field]} characters`,
      );
    }
  }
  if (
    'publishedAt' in value &&
    value.publishedAt !== null &&
    typeof value.publishedAt !== 'string'
  ) {
    return invalid('publishedAt must be a string or null');
  }
  if ('capturedAt' in value && typeof value.capturedAt !== 'string') {
    return invalid('capturedAt must be a string');
  }
  if (
    'sourceType' in value &&
    !isAllowedString(knowledgeSourceTypes, value.sourceType)
  ) {
    return invalid('sourceType must be a defined source type');
  }
  if (
    'status' in value &&
    !isAllowedString(knowledgeItemStatuses, value.status)
  ) {
    return invalid('status must be a defined knowledge status');
  }
  return null;
}

function validateCreateRuntimeInput(
  value: unknown,
): KnowledgeApplicationFailure | null {
  const mutableError = validateMutableRuntimeInput(value);
  if (mutableError) return mutableError;
  if (!isRecord(value)) return invalid('body must be an object');
  if (!isAllowedString(knowledgeItemScopes, value.scope)) {
    return invalid('scope must be a defined knowledge scope');
  }
  if (!isAllowedString(knowledgeSourceTypes, value.sourceType)) {
    return invalid('sourceType must be a defined source type');
  }
  if (
    'organizationGroupIds' in value &&
    (!Array.isArray(value.organizationGroupIds) ||
      value.organizationGroupIds.length >
        knowledgeItemInputLimits.organizationGroupIds ||
      value.organizationGroupIds.some(
        (groupId) =>
          typeof groupId !== 'string' ||
          groupId.trim().length === 0 ||
          exceedsCodePointLimit(
            groupId,
            knowledgeItemInputLimits.organizationGroupId,
          ),
      ) ||
      new Set(value.organizationGroupIds.map((groupId) => groupId.trim()))
        .size !== value.organizationGroupIds.length)
  ) {
    return invalid(
      `organizationGroupIds must contain at most ${knowledgeItemInputLimits.organizationGroupIds} unique, non-empty strings of at most ${knowledgeItemInputLimits.organizationGroupId} characters`,
    );
  }
  return null;
}

function createPatch(input: UpdateKnowledgeItemInput): {
  patch: KnowledgeItemUpdateRecord;
  changedFields: KnowledgeMutableField[];
} {
  const patch: KnowledgeItemUpdateRecord = {};
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
  const changedFields = knowledgeMutableFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(patch, field),
  );
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
      if (!hasPrincipal(input.actor) || !isValidListQuery(input.query)) {
        return [];
      }
      return dependencies.reader.listVisible(input.actor, input.query);
    },

    async count(input: {
      actor: KnowledgeActor;
      scope?: KnowledgeItemScope;
      status?: KnowledgeItemStatus;
    }): Promise<number> {
      if (!hasPrincipal(input.actor)) return 0;
      if (
        (input.scope !== undefined &&
          !isAllowedString(knowledgeItemScopes, input.scope)) ||
        (input.status !== undefined &&
          !isAllowedString(knowledgeItemStatuses, input.status))
      ) {
        return 0;
      }
      return dependencies.reader.countVisible(input.actor, {
        scope: input.scope,
        status: input.status,
      });
    },

    async detail(input: {
      actor: KnowledgeActor;
      itemId: string;
    }): Promise<KnowledgeApplicationResult<KnowledgeItem>> {
      if (!hasPrincipal(input.actor) || !isValidItemId(input.itemId)) {
        return notFound();
      }
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
      const bodyError = validateCreateRuntimeInput(input.body);
      if (bodyError) return bodyError;
      const groupAccountIds = uniqueStrings(input.body.organizationGroupIds);
      let organizationId: string | null = null;
      if (input.body.scope === 'organization') {
        organizationId =
          typeof input.actor.organizationId === 'string'
            ? input.actor.organizationId.trim() || null
            : null;
        if (!organizationId || groupAccountIds.length === 0) {
          return invalid(
            'organization scope requires organization context and at least one group grant',
          );
        }
        const actorGroups = new Set(
          Array.isArray(input.actor.groupAccountIds)
            ? input.actor.groupAccountIds.filter(
                (groupId): groupId is string => typeof groupId === 'string',
              )
            : [],
        );
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
      if (!hasPrincipal(input.actor) || !isValidItemId(input.itemId)) {
        return notFound();
      }
      const bodyError = validateMutableRuntimeInput(input.body);
      if (bodyError) return bodyError;
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
      if (!hasPrincipal(input.actor) || !isValidItemId(input.itemId)) {
        return notFound();
      }
      const versionError = validateExpectedVersion(input.expectedVersion);
      if (versionError) return versionError;
      if (typeof input.reasonCode !== 'string') {
        return invalid('reasonCode must be a defined deletion reason code');
      }
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
      if (!hasPrincipal(input.actor) || !isValidItemId(input.itemId)) {
        return notFound();
      }
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
