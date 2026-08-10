export const knowledgeShareStatuses = [
  'pending',
  'posted',
  'failed',
  'revoked',
] as const;

export type KnowledgeShareStatus = (typeof knowledgeShareStatuses)[number];

export const knowledgeShareFailureCodes = [
  'source_unavailable',
  'room_unavailable',
  'post_rejected',
] as const;

export type KnowledgeShareFailureCode =
  (typeof knowledgeShareFailureCodes)[number];

export const knowledgeShareSelectionCategories = [
  'title',
  'source_type',
  'canonical_url',
  'snapshot_provenance',
  'snapshot_excerpt',
  'label',
  'annotation',
  'conversation_turn',
  'synthesis',
  'sharer_note',
] as const;

export type KnowledgeShareSelectionCategory =
  (typeof knowledgeShareSelectionCategories)[number];

export const knowledgeShareSourceTypes = [
  'x',
  'threads',
  'news',
  'web',
  'pdf',
  'image',
  'manual',
  'other',
] as const;

export type KnowledgeShareSourceType =
  (typeof knowledgeShareSourceTypes)[number];

export const knowledgeShareAnnotationKinds = [
  'note',
  'question',
  'hypothesis',
  'quote',
  'todo',
] as const;

export type KnowledgeShareAnnotationKind =
  (typeof knowledgeShareAnnotationKinds)[number];

export const knowledgeShareProvenanceOrigins = [
  'user',
  'external',
  'ai',
  'system',
  'tool',
] as const;

export type KnowledgeShareProvenanceOrigin =
  (typeof knowledgeShareProvenanceOrigins)[number];

export const knowledgeShareConversationRoles = [
  'user',
  'assistant',
  'system',
  'tool',
] as const;

export type KnowledgeShareConversationRole =
  (typeof knowledgeShareConversationRoles)[number];

export type KnowledgeShareSelectionDraft = {
  includeTitle: boolean;
  includeSourceType: boolean;
  includeCanonicalUrl: boolean;
  snapshot: {
    snapshotId: string;
    includeProvenance: boolean;
    includeExcerpt: boolean;
  } | null;
  labelAssignmentIds: readonly string[];
  annotations: ReadonlyArray<{ annotationId: string; revision: number }>;
  conversationTurnIds: readonly string[];
  syntheses: ReadonlyArray<{ synthesisId: string; version: number }>;
  sharerNote: string | null;
};

export type KnowledgeShareSelectionRequest = {
  includeTitle: boolean;
  includeSourceType: boolean;
  includeCanonicalUrl: boolean;
  snapshot: {
    snapshotId: string;
    includeProvenance: boolean;
    includeExcerpt: boolean;
  } | null;
  labelAssignmentIds: string[];
  annotations: Array<{ annotationId: string; revision: number }>;
  conversationTurnIds: string[];
  syntheses: Array<{ synthesisId: string; version: number }>;
  sharerNote: string | null;
};

export type KnowledgeSharePreviewRequest = {
  destinationRoomId: string;
  selection: KnowledgeShareSelectionRequest;
};

export type KnowledgeShareSnapshot = {
  version?: number;
  sha256?: string;
  excerpt?: string;
};

export type KnowledgeShareCard = {
  schemaVersion: 1;
  title: string | null;
  sourceType: KnowledgeShareSourceType | null;
  canonicalUrl: string | null;
  snapshot: KnowledgeShareSnapshot | null;
  sharerNote: string | null;
  labels: Array<{ displayName: string }>;
  annotations: Array<{
    revision: number;
    kind: KnowledgeShareAnnotationKind;
    origin: KnowledgeShareProvenanceOrigin;
    content: string;
  }>;
  turns: Array<{
    role: KnowledgeShareConversationRole;
    origin: KnowledgeShareProvenanceOrigin;
    content: string;
    name: string | null;
    occurredAt: string | null;
  }>;
  syntheses: Array<{
    version: number;
    title: string;
    content: string;
    confidenceBasisPoints: number | null;
    unresolvedQuestions: string[];
  }>;
  selectedCategories: KnowledgeShareSelectionCategory[];
  omittedCategories: KnowledgeShareSelectionCategory[];
};

export type KnowledgeSharePreview = {
  card: KnowledgeShareCard;
  destinationRoom: { name: string; type: string };
  previewToken: string;
  expiresAt: string;
  requiresConfirmation: true;
};

export type KnowledgeShareStatusResponse = {
  shareId: string;
  status: KnowledgeShareStatus;
  version: number;
  chatMessageId: string | null;
  failureCode: KnowledgeShareFailureCode | null;
  createdAt: string;
  postedAt: string | null;
  failedAt: string | null;
  revokedAt: string | null;
};

export type KnowledgeShareCommit = KnowledgeShareStatusResponse & {
  created: boolean;
  reused: boolean;
  resultUnknown: boolean;
};

export type RoomKnowledgeShareSummary = {
  messageId: string;
  shareId: string;
  status: 'posted' | 'revoked';
  version: number;
  schemaVersion: 1;
};

export type KnowledgeShareRoomCard = {
  shareId: string;
  status: 'posted' | 'revoked';
  version: number;
  schemaVersion: 1;
  card: KnowledgeShareCard | null;
  canOpenSource: boolean;
};

export type KnowledgeShareSourceOpen = {
  knowledgeItemId: string;
};

export type KnowledgeThreadPromotionDraft = {
  selectedReplyMessageIds: readonly string[];
  includeSharedCard: boolean;
  destination:
    | { scope: 'personal'; organizationGroupAccountIds: readonly [] }
    | {
        scope: 'organization';
        organizationGroupAccountIds: readonly string[];
      };
  synthesis: {
    title: string;
    content: string;
    confidenceBasisPoints: number | null;
    unresolvedQuestions: readonly string[];
  };
};

export type KnowledgeThreadPromotionRequest = {
  selectedReplyMessageIds: string[];
  includeSharedCard: boolean;
  destination:
    | { scope: 'personal'; organizationGroupAccountIds: [] }
    | { scope: 'organization'; organizationGroupAccountIds: string[] };
  synthesis: {
    title: string;
    content: string;
    confidenceBasisPoints: number | null;
    unresolvedQuestions: string[];
  };
};

export type KnowledgeThreadPromotionSharedCard = KnowledgeShareCard & {
  shareVersion: number;
};

export type KnowledgeThreadPromotionPreview = {
  sourceThread: { roomName: string; roomType: string; replyCount: number };
  selectedMessages: Array<{
    ordinal: number;
    content: string;
    createdAt: string;
    authorCategory: 'user';
  }>;
  selectedMessageCount: number;
  omittedMessageCount: number;
  sharedCard: KnowledgeThreadPromotionSharedCard | null;
  destination: {
    scope: 'personal' | 'organization';
    organizationGroupCount: number;
  };
  synthesis: KnowledgeThreadPromotionRequest['synthesis'];
  previewToken: string;
  expiresAt: string;
  requiresConfirmation: true;
  requiresOrganizationAudienceConfirmation: boolean;
};

export type KnowledgeThreadPromotionCommit = {
  promotionId: string;
  synthesisId: string;
  synthesisVersionId: string;
  synthesisVersion: 1;
  scope: 'personal' | 'organization';
  selectedMessageCount: number;
  includesSharedCard: boolean;
  createdAt: string;
  created: boolean;
  reused: boolean;
};

export type KnowledgeShareLabelAssignmentOption = {
  assignmentId: string;
  displayName: string;
  scope: 'personal' | 'organization';
  labelVersion: number;
};

type JsonRecord = Record<string, unknown>;

const limits = {
  idCodePoints: 200,
  idBytes: 800,
  labels: 20,
  annotations: 20,
  turns: 50,
  syntheses: 10,
  sharerNoteBytes: 4096,
  excerptBytes: 4096,
  titleCodePoints: 500,
  urlBytes: 4096,
  labelNameCodePoints: 200,
  annotationBytes: 65_536,
  turnBytes: 65_536,
  synthesisBytes: 262_144,
  unresolvedQuestions: 50,
  unresolvedQuestionBytes: 4096,
  previewTokenBytes: 4096,
  selectedReplies: 100,
  organizationGroupAccountIds: 20,
  promotionQuestionCodePoints: 4000,
} as const;

const maximumDatabaseInteger = 2_147_483_647;
const directionalCodePoints = new Set([
  0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

const statusSet = new Set<string>(knowledgeShareStatuses);
const failureCodeSet = new Set<string>(knowledgeShareFailureCodes);
const categorySet = new Set<string>(knowledgeShareSelectionCategories);
const sourceTypeSet = new Set<string>(knowledgeShareSourceTypes);
const annotationKindSet = new Set<string>(knowledgeShareAnnotationKinds);
const originSet = new Set<string>(knowledgeShareProvenanceOrigins);
const conversationRoleSet = new Set<string>(knowledgeShareConversationRoles);

class InvalidBoundaryValue extends Error {}

function invalid(): never {
  throw new InvalidBoundaryValue();
}

function attempt<T>(normalizer: () => T): T | null {
  try {
    return normalizer();
  } catch (error) {
    if (error instanceof InvalidBoundaryValue) return null;
    throw error;
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as JsonRecord;
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function hasUnsafeIdentifierCodePoint(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      directionalCodePoints.has(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

function boundedIdentifier(
  value: unknown,
  maximumCodePoints: number = limits.idCodePoints,
  maximumBytes: number = limits.idBytes,
) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    [...value].length > maximumCodePoints ||
    utf8ByteLength(value) > maximumBytes ||
    hasUnsafeIdentifierCodePoint(value)
  ) {
    invalid();
  }
  return value;
}

function boundedString(
  value: unknown,
  options: {
    allowEmpty?: boolean;
    maximumBytes?: number;
    maximumCodePoints?: number;
    trimmed?: boolean;
  } = {},
) {
  if (typeof value !== 'string') invalid();
  if (!options.allowEmpty && value.length === 0) invalid();
  if (options.trimmed && value !== value.trim()) invalid();
  if (
    options.maximumCodePoints !== undefined &&
    [...value].length > options.maximumCodePoints
  ) {
    invalid();
  }
  if (
    options.maximumBytes !== undefined &&
    utf8ByteLength(value) > options.maximumBytes
  ) {
    invalid();
  }
  return value;
}

function nonNegativeInteger(value: unknown, maximum = maximumDatabaseInteger) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    invalid();
  }
  return Number(value);
}

function positiveInteger(value: unknown, maximum = maximumDatabaseInteger) {
  const normalized = nonNegativeInteger(value, maximum);
  if (normalized < 1) invalid();
  return normalized;
}

function boolean(value: unknown) {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>): T {
  if (typeof value !== 'string' || !allowed.has(value)) invalid();
  return value as T;
}

function dateTime(value: unknown) {
  if (
    typeof value !== 'string' ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    invalid();
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const daysInMonth =
    month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    invalid();
  }
  return value;
}

function nullableDateTime(value: unknown) {
  return value === null ? null : dateTime(value);
}

function nullableString(
  value: unknown,
  options?: Parameters<typeof boundedString>[1],
) {
  return value === null ? null : boundedString(value, options);
}

function uniqueIdentifiers(value: unknown, maximumItems: number) {
  if (!Array.isArray(value) || value.length > maximumItems) invalid();
  const normalized = value.map((entry) => boundedIdentifier(entry));
  if (new Set(normalized).size !== normalized.length) invalid();
  return normalized;
}

function normalizeCategoryArray(value: unknown) {
  if (!Array.isArray(value) || value.length > categorySet.size) invalid();
  const normalized = value.map((entry) =>
    enumValue<KnowledgeShareSelectionCategory>(entry, categorySet),
  );
  if (new Set(normalized).size !== normalized.length) invalid();
  return normalized;
}

function normalizeCanonicalUrl(value: unknown) {
  if (value === null) return null;
  const urlValue = boundedString(value, { maximumBytes: limits.urlBytes });
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    invalid();
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    hostname.endsWith('.') ||
    hostname === 'drive.google.com' ||
    hostname === 'docs.google.com' ||
    hostname === 'storage.cloud.google.com' ||
    hostname === 'storage.googleapis.com' ||
    hostname === 'www.googleapis.com' ||
    hostname.endsWith('.googleapis.com') ||
    hostname.endsWith('.googleusercontent.com')
  ) {
    invalid();
  }
  return urlValue;
}

function normalizeSnapshot(value: unknown): KnowledgeShareSnapshot | null {
  if (value === null) return null;
  const source = record(value);
  const version =
    source.version === undefined ? undefined : positiveInteger(source.version);
  const sha256 =
    source.sha256 === undefined
      ? undefined
      : boundedString(source.sha256, { maximumBytes: 64 });
  const excerpt =
    source.excerpt === undefined
      ? undefined
      : boundedString(source.excerpt, {
          maximumBytes: limits.excerptBytes,
        });
  if ((version === undefined) !== (sha256 === undefined)) invalid();
  if (sha256 !== undefined && !sha256Pattern.test(sha256)) invalid();
  if (version === undefined && excerpt === undefined) invalid();
  return {
    ...(version === undefined ? {} : { version }),
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(excerpt === undefined ? {} : { excerpt }),
  };
}

function normalizeStringList(
  value: unknown,
  maximumItems: number,
  options: Parameters<typeof boundedString>[1],
) {
  if (!Array.isArray(value) || value.length > maximumItems) invalid();
  return value.map((entry) => boundedString(entry, options));
}

function categoryTopologyIsValid(card: KnowledgeShareCard) {
  const selected = new Set(card.selectedCategories);
  const omitted = new Set(card.omittedCategories);
  if (
    knowledgeShareSelectionCategories.some(
      (category) => selected.has(category) === omitted.has(category),
    )
  ) {
    return false;
  }

  const snapshot = card.snapshot;
  const hasProvenance = snapshot?.version !== undefined;
  const hasExcerpt = snapshot?.excerpt !== undefined;
  if (
    selected.has('snapshot_provenance') !== hasProvenance ||
    selected.has('snapshot_excerpt') !== hasExcerpt ||
    (snapshot !== null && !hasProvenance && !hasExcerpt) ||
    (snapshot === null && (hasProvenance || hasExcerpt))
  ) {
    return false;
  }

  if (
    (!selected.has('title') && card.title !== null) ||
    (!selected.has('source_type') && card.sourceType !== null) ||
    (!selected.has('canonical_url') && card.canonicalUrl !== null) ||
    selected.has('label') !== card.labels.length > 0 ||
    selected.has('annotation') !== card.annotations.length > 0 ||
    selected.has('conversation_turn') !== card.turns.length > 0 ||
    selected.has('synthesis') !== card.syntheses.length > 0 ||
    selected.has('sharer_note') !== (card.sharerNote !== null)
  ) {
    return false;
  }
  return true;
}

export function normalizeKnowledgeShareCard(
  value: unknown,
): KnowledgeShareCard | null {
  return attempt(() => {
    const source = record(value);
    if (source.schemaVersion !== 1) invalid();
    const sourceType =
      source.sourceType === null
        ? null
        : enumValue<KnowledgeShareSourceType>(source.sourceType, sourceTypeSet);
    const labelsValue = source.labels;
    if (!Array.isArray(labelsValue) || labelsValue.length > limits.labels) {
      invalid();
    }
    const labels = labelsValue.map((entry) => {
      const label = record(entry);
      return {
        displayName: boundedString(label.displayName, {
          maximumCodePoints: limits.labelNameCodePoints,
        }),
      };
    });

    const annotationsValue = source.annotations;
    if (
      !Array.isArray(annotationsValue) ||
      annotationsValue.length > limits.annotations
    ) {
      invalid();
    }
    const annotations = annotationsValue.map((entry) => {
      const annotation = record(entry);
      return {
        revision: positiveInteger(annotation.revision),
        kind: enumValue<KnowledgeShareAnnotationKind>(
          annotation.kind,
          annotationKindSet,
        ),
        origin: enumValue<KnowledgeShareProvenanceOrigin>(
          annotation.origin,
          originSet,
        ),
        content: boundedString(annotation.content, {
          maximumBytes: limits.annotationBytes,
        }),
      };
    });

    const turnsValue = source.turns;
    if (!Array.isArray(turnsValue) || turnsValue.length > limits.turns) {
      invalid();
    }
    const turns = turnsValue.map((entry) => {
      const turn = record(entry);
      return {
        role: enumValue<KnowledgeShareConversationRole>(
          turn.role,
          conversationRoleSet,
        ),
        origin: enumValue<KnowledgeShareProvenanceOrigin>(
          turn.origin,
          originSet,
        ),
        content: boundedString(turn.content, {
          maximumBytes: limits.turnBytes,
        }),
        name: nullableString(turn.name, { allowEmpty: true }),
        occurredAt: nullableDateTime(turn.occurredAt),
      };
    });

    const synthesesValue = source.syntheses;
    if (
      !Array.isArray(synthesesValue) ||
      synthesesValue.length > limits.syntheses
    ) {
      invalid();
    }
    const syntheses = synthesesValue.map((entry) => {
      const synthesis = record(entry);
      const confidenceBasisPoints =
        synthesis.confidenceBasisPoints === null
          ? null
          : nonNegativeInteger(synthesis.confidenceBasisPoints, 10_000);
      return {
        version: positiveInteger(synthesis.version),
        title: boundedString(synthesis.title, {
          maximumCodePoints: limits.titleCodePoints,
        }),
        content: boundedString(synthesis.content, {
          maximumBytes: limits.synthesisBytes,
        }),
        confidenceBasisPoints,
        unresolvedQuestions: normalizeStringList(
          synthesis.unresolvedQuestions,
          limits.unresolvedQuestions,
          { maximumBytes: limits.unresolvedQuestionBytes },
        ),
      };
    });

    const card: KnowledgeShareCard = {
      schemaVersion: 1,
      title: nullableString(source.title, {
        allowEmpty: true,
        maximumCodePoints: limits.titleCodePoints,
      }),
      sourceType,
      canonicalUrl: normalizeCanonicalUrl(source.canonicalUrl),
      snapshot: normalizeSnapshot(source.snapshot),
      sharerNote: nullableString(source.sharerNote, {
        maximumBytes: limits.sharerNoteBytes,
      }),
      labels,
      annotations,
      turns,
      syntheses,
      selectedCategories: normalizeCategoryArray(source.selectedCategories),
      omittedCategories: normalizeCategoryArray(source.omittedCategories),
    };
    if (!categoryTopologyIsValid(card)) invalid();
    return card;
  });
}

function normalizeShareStatusValue(
  value: unknown,
): KnowledgeShareStatusResponse {
  const source = record(value);
  const status = enumValue<KnowledgeShareStatus>(source.status, statusSet);
  const chatMessageId =
    source.chatMessageId === null
      ? null
      : boundedIdentifier(source.chatMessageId);
  const failureCode =
    source.failureCode === null
      ? null
      : enumValue<KnowledgeShareFailureCode>(
          source.failureCode,
          failureCodeSet,
        );
  const createdAt = dateTime(source.createdAt);
  const postedAt = nullableDateTime(source.postedAt);
  const failedAt = nullableDateTime(source.failedAt);
  const revokedAt = nullableDateTime(source.revokedAt);

  const postedPairIsValid = (chatMessageId === null) === (postedAt === null);
  const topologyIsValid =
    postedPairIsValid &&
    ((status === 'pending' &&
      chatMessageId === null &&
      failureCode === null &&
      failedAt === null &&
      revokedAt === null) ||
      (status === 'posted' &&
        chatMessageId !== null &&
        failureCode === null &&
        failedAt === null &&
        revokedAt === null) ||
      (status === 'failed' &&
        chatMessageId === null &&
        failureCode !== null &&
        failedAt !== null &&
        revokedAt === null) ||
      (status === 'revoked' &&
        failureCode === null &&
        failedAt === null &&
        revokedAt !== null));
  if (!topologyIsValid) invalid();

  const createdTime = Date.parse(createdAt);
  if (
    [postedAt, failedAt, revokedAt].some(
      (entry) => entry !== null && Date.parse(entry) < createdTime,
    )
  ) {
    invalid();
  }

  return {
    shareId: boundedIdentifier(source.shareId),
    status,
    version: positiveInteger(source.version),
    chatMessageId,
    failureCode,
    createdAt,
    postedAt,
    failedAt,
    revokedAt,
  };
}

export function normalizeKnowledgeShareStatus(
  value: unknown,
): KnowledgeShareStatusResponse | null {
  return attempt(() => normalizeShareStatusValue(value));
}

export function normalizeKnowledgeShareCommit(
  value: unknown,
): KnowledgeShareCommit | null {
  return attempt(() => {
    const source = record(value);
    const status = normalizeShareStatusValue(source);
    const created = boolean(source.created);
    const reused = boolean(source.reused);
    const resultUnknown = boolean(source.resultUnknown);
    if (
      created === reused ||
      (resultUnknown && (!created || status.status !== 'pending'))
    ) {
      invalid();
    }
    return { ...status, created, reused, resultUnknown };
  });
}

export function normalizeKnowledgeSharePreview(
  value: unknown,
): KnowledgeSharePreview | null {
  return attempt(() => {
    const source = record(value);
    const card = normalizeKnowledgeShareCard(source.card);
    if (!card || source.requiresConfirmation !== true) invalid();
    const destinationRoom = record(source.destinationRoom);
    return {
      card,
      destinationRoom: {
        name: boundedString(destinationRoom.name),
        type: boundedString(destinationRoom.type),
      },
      previewToken: boundedString(source.previewToken, {
        maximumBytes: limits.previewTokenBytes,
      }),
      expiresAt: dateTime(source.expiresAt),
      requiresConfirmation: true,
    };
  });
}

function normalizeRoomSummaryValue(value: unknown): RoomKnowledgeShareSummary {
  const source = record(value);
  const status = source.status;
  if (status !== 'posted' && status !== 'revoked') invalid();
  if (source.schemaVersion !== 1) invalid();
  return {
    messageId: boundedIdentifier(source.messageId),
    shareId: boundedIdentifier(source.shareId),
    status,
    version: positiveInteger(source.version),
    schemaVersion: 1,
  };
}

export function normalizeRoomKnowledgeShareSummaries(
  value: unknown,
  requestedMessageIds?: ReadonlySet<string>,
): RoomKnowledgeShareSummary[] | null {
  return attempt(() => {
    const source = record(value);
    if (
      !Array.isArray(source.items) ||
      source.items.length > limits.selectedReplies
    ) {
      invalid();
    }
    const items = source.items.map(normalizeRoomSummaryValue);
    const messageIds = items.map((item) => item.messageId);
    if (
      new Set(messageIds).size !== messageIds.length ||
      (requestedMessageIds &&
        messageIds.some((messageId) => !requestedMessageIds.has(messageId)))
    ) {
      invalid();
    }
    return items;
  });
}

export function normalizeKnowledgeShareRoomCard(
  value: unknown,
): KnowledgeShareRoomCard | null {
  return attempt(() => {
    const source = record(value);
    const status = source.status;
    if (
      (status !== 'posted' && status !== 'revoked') ||
      source.schemaVersion !== 1
    ) {
      invalid();
    }
    const card =
      source.card === null ? null : normalizeKnowledgeShareCard(source.card);
    if (!card) {
      if (status === 'posted') invalid();
    } else if (status === 'revoked') {
      invalid();
    }
    const canOpenSource = boolean(source.canOpenSource);
    if (status === 'revoked' && canOpenSource) invalid();
    return {
      shareId: boundedIdentifier(source.shareId),
      status,
      version: positiveInteger(source.version),
      schemaVersion: 1,
      card,
      canOpenSource,
    };
  });
}

export function normalizeKnowledgeShareSourceOpen(
  value: unknown,
): KnowledgeShareSourceOpen | null {
  return attempt(() => ({
    knowledgeItemId: boundedIdentifier(record(value).knowledgeItemId),
  }));
}

export function normalizeKnowledgeShareLabelAssignmentOptions(
  value: unknown,
): KnowledgeShareLabelAssignmentOption[] | null {
  return attempt(() => {
    const source = record(value);
    if (!Array.isArray(source.items) || source.items.length > 100) invalid();
    const items = source.items.map((entry) => {
      const option = record(entry);
      const scope: KnowledgeShareLabelAssignmentOption['scope'] =
        option.scope === 'personal' || option.scope === 'organization'
          ? option.scope
          : invalid();
      return {
        assignmentId: boundedIdentifier(option.assignmentId, 100, 400),
        displayName: boundedString(option.displayName, {
          maximumCodePoints: limits.labelNameCodePoints,
        }),
        scope,
        labelVersion: positiveInteger(option.labelVersion),
      };
    });
    const assignmentIds = items.map((item) => item.assignmentId);
    if (new Set(assignmentIds).size !== assignmentIds.length) invalid();
    return items;
  });
}

function normalizePromotionSynthesis(
  value: unknown,
): KnowledgeThreadPromotionRequest['synthesis'] {
  const source = record(value);
  const confidenceBasisPoints =
    source.confidenceBasisPoints === null
      ? null
      : nonNegativeInteger(source.confidenceBasisPoints, 10_000);
  return {
    title: boundedString(source.title, {
      maximumCodePoints: limits.titleCodePoints,
      trimmed: true,
    }),
    content: boundedString(source.content, {
      maximumBytes: limits.synthesisBytes,
    }),
    confidenceBasisPoints,
    unresolvedQuestions: normalizeStringList(
      source.unresolvedQuestions,
      limits.unresolvedQuestions,
      {
        maximumCodePoints: limits.promotionQuestionCodePoints,
        trimmed: true,
      },
    ),
  };
}

function samePromotionSynthesis(
  left: KnowledgeThreadPromotionRequest['synthesis'],
  right: KnowledgeThreadPromotionRequest['synthesis'],
) {
  return (
    left.title === right.title &&
    left.content === right.content &&
    left.confidenceBasisPoints === right.confidenceBasisPoints &&
    left.unresolvedQuestions.length === right.unresolvedQuestions.length &&
    left.unresolvedQuestions.every(
      (question, index) => question === right.unresolvedQuestions[index],
    )
  );
}

export function normalizeKnowledgeThreadPromotionPreview(
  value: unknown,
): KnowledgeThreadPromotionPreview | null {
  return attempt(() => {
    const source = record(value);
    if (source.requiresConfirmation !== true) invalid();
    const sourceThreadValue = record(source.sourceThread);
    const sourceThread = {
      roomName: boundedString(sourceThreadValue.roomName),
      roomType: boundedString(sourceThreadValue.roomType),
      replyCount: nonNegativeInteger(sourceThreadValue.replyCount),
    };
    if (
      !Array.isArray(source.selectedMessages) ||
      source.selectedMessages.length < 1 ||
      source.selectedMessages.length > limits.selectedReplies
    ) {
      invalid();
    }
    const selectedMessages = source.selectedMessages.map((entry, index) => {
      const message = record(entry);
      const ordinal = nonNegativeInteger(
        message.ordinal,
        limits.selectedReplies - 1,
      );
      if (ordinal !== index || message.authorCategory !== 'user') invalid();
      return {
        ordinal,
        content: boundedString(message.content, {
          maximumBytes: limits.turnBytes,
        }),
        createdAt: dateTime(message.createdAt),
        authorCategory: 'user' as const,
      };
    });
    const selectedMessageCount = positiveInteger(
      source.selectedMessageCount,
      limits.selectedReplies,
    );
    const omittedMessageCount = nonNegativeInteger(source.omittedMessageCount);
    if (
      selectedMessageCount !== selectedMessages.length ||
      selectedMessageCount + omittedMessageCount !== sourceThread.replyCount
    ) {
      invalid();
    }
    const sharedCard =
      source.sharedCard === null
        ? null
        : (() => {
            const cardSource = record(source.sharedCard);
            const card = normalizeKnowledgeShareCard(cardSource);
            if (!card) invalid();
            return {
              ...card,
              shareVersion: positiveInteger(cardSource.shareVersion),
            };
          })();
    const destinationValue = record(source.destination);
    const destinationScope = destinationValue.scope;
    if (
      destinationScope !== 'personal' &&
      destinationScope !== 'organization'
    ) {
      invalid();
    }
    const organizationGroupCount = nonNegativeInteger(
      destinationValue.organizationGroupCount,
      limits.organizationGroupAccountIds,
    );
    if (
      (destinationScope === 'personal' && organizationGroupCount !== 0) ||
      (destinationScope === 'organization' && organizationGroupCount < 1)
    ) {
      invalid();
    }
    const requiresOrganizationAudienceConfirmation = boolean(
      source.requiresOrganizationAudienceConfirmation,
    );
    if (
      requiresOrganizationAudienceConfirmation !==
      (destinationScope === 'organization')
    ) {
      invalid();
    }
    return {
      sourceThread,
      selectedMessages,
      selectedMessageCount,
      omittedMessageCount,
      sharedCard,
      destination: {
        scope: destinationScope,
        organizationGroupCount,
      },
      synthesis: normalizePromotionSynthesis(source.synthesis),
      previewToken: boundedString(source.previewToken, {
        maximumBytes: limits.previewTokenBytes,
      }),
      expiresAt: dateTime(source.expiresAt),
      requiresConfirmation: true,
      requiresOrganizationAudienceConfirmation,
    };
  });
}

export function normalizeKnowledgeThreadPromotionCommit(
  value: unknown,
): KnowledgeThreadPromotionCommit | null {
  return attempt(() => {
    const source = record(value);
    const scope = source.scope;
    if (scope !== 'personal' && scope !== 'organization') invalid();
    if (source.synthesisVersion !== 1) invalid();
    const created = boolean(source.created);
    const reused = boolean(source.reused);
    if (created === reused) invalid();
    return {
      promotionId: boundedIdentifier(source.promotionId),
      synthesisId: boundedIdentifier(source.synthesisId),
      synthesisVersionId: boundedIdentifier(source.synthesisVersionId),
      synthesisVersion: 1,
      scope,
      selectedMessageCount: positiveInteger(
        source.selectedMessageCount,
        limits.selectedReplies,
      ),
      includesSharedCard: boolean(source.includesSharedCard),
      createdAt: dateTime(source.createdAt),
      created,
      reused,
    };
  });
}

export function buildKnowledgeShareSelectionRequest(
  value: unknown,
): KnowledgeShareSelectionRequest | null {
  return attempt(() => {
    const source = record(value);
    const includeTitle = boolean(source.includeTitle);
    const includeSourceType = boolean(source.includeSourceType);
    const includeCanonicalUrl = boolean(source.includeCanonicalUrl);
    const snapshot =
      source.snapshot === null
        ? null
        : (() => {
            const snapshotValue = record(source.snapshot);
            const includeProvenance = boolean(snapshotValue.includeProvenance);
            const includeExcerpt = boolean(snapshotValue.includeExcerpt);
            if (!includeProvenance && !includeExcerpt) invalid();
            return {
              snapshotId: boundedIdentifier(snapshotValue.snapshotId),
              includeProvenance,
              includeExcerpt,
            };
          })();
    const labelAssignmentIds = uniqueIdentifiers(
      source.labelAssignmentIds,
      limits.labels,
    );
    const conversationTurnIds = uniqueIdentifiers(
      source.conversationTurnIds,
      limits.turns,
    );
    if (
      !Array.isArray(source.annotations) ||
      source.annotations.length > limits.annotations
    ) {
      invalid();
    }
    const annotations = source.annotations.map((entry) => {
      const annotation = record(entry);
      return {
        annotationId: boundedIdentifier(annotation.annotationId),
        revision: positiveInteger(annotation.revision),
      };
    });
    if (
      new Set(
        annotations.map(
          (annotation) => `${annotation.annotationId}\0${annotation.revision}`,
        ),
      ).size !== annotations.length
    ) {
      invalid();
    }
    if (
      !Array.isArray(source.syntheses) ||
      source.syntheses.length > limits.syntheses
    ) {
      invalid();
    }
    const syntheses = source.syntheses.map((entry) => {
      const synthesis = record(entry);
      return {
        synthesisId: boundedIdentifier(synthesis.synthesisId),
        version: positiveInteger(synthesis.version),
      };
    });
    if (
      new Set(
        syntheses.map(
          (synthesis) => `${synthesis.synthesisId}\0${synthesis.version}`,
        ),
      ).size !== syntheses.length
    ) {
      invalid();
    }
    const sharerNote =
      source.sharerNote === null
        ? null
        : boundedString(source.sharerNote, {
            maximumBytes: limits.sharerNoteBytes,
            trimmed: true,
          });
    if (sharerNote !== null && hasUnsafeIdentifierCodePoint(sharerNote)) {
      invalid();
    }
    if (
      !includeTitle &&
      !includeSourceType &&
      !includeCanonicalUrl &&
      snapshot === null &&
      labelAssignmentIds.length === 0 &&
      annotations.length === 0 &&
      conversationTurnIds.length === 0 &&
      syntheses.length === 0 &&
      sharerNote === null
    ) {
      invalid();
    }
    return {
      includeTitle,
      includeSourceType,
      includeCanonicalUrl,
      snapshot,
      labelAssignmentIds,
      annotations,
      conversationTurnIds,
      syntheses,
      sharerNote,
    };
  });
}

export function buildKnowledgeThreadPromotionRequest(
  value: unknown,
): KnowledgeThreadPromotionRequest | null {
  return attempt(() => {
    const source = record(value);
    const selectedReplyMessageIds = uniqueIdentifiers(
      source.selectedReplyMessageIds,
      limits.selectedReplies,
    );
    if (selectedReplyMessageIds.length === 0) invalid();
    const destinationValue = record(source.destination);
    const organizationGroupAccountIds = uniqueIdentifiers(
      destinationValue.organizationGroupAccountIds,
      limits.organizationGroupAccountIds,
    ).sort();
    let destination: KnowledgeThreadPromotionRequest['destination'];
    if (destinationValue.scope === 'personal') {
      if (organizationGroupAccountIds.length !== 0) invalid();
      destination = { scope: 'personal', organizationGroupAccountIds: [] };
    } else if (destinationValue.scope === 'organization') {
      if (organizationGroupAccountIds.length === 0) invalid();
      destination = {
        scope: 'organization',
        organizationGroupAccountIds,
      };
    } else {
      invalid();
    }
    return {
      selectedReplyMessageIds,
      includeSharedCard: boolean(source.includeSharedCard),
      destination,
      synthesis: normalizePromotionSynthesis(source.synthesis),
    };
  });
}

export function normalizeKnowledgeShareMessageIds(
  value: readonly string[],
): string[] | null {
  return attempt(() => {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > limits.selectedReplies
    ) {
      invalid();
    }
    const normalized = value.map((entry) => boundedIdentifier(entry));
    return [...new Set(normalized)];
  });
}

export function isBoundedKnowledgeShareId(value: unknown): value is string {
  return attempt(() => boundedIdentifier(value)) !== null;
}

export function promotionPreviewMatchesRequest(
  preview: KnowledgeThreadPromotionPreview,
  request: KnowledgeThreadPromotionRequest,
) {
  return (
    preview.selectedMessageCount === request.selectedReplyMessageIds.length &&
    preview.destination.scope === request.destination.scope &&
    preview.destination.organizationGroupCount ===
      request.destination.organizationGroupAccountIds.length &&
    (preview.sharedCard !== null) === request.includeSharedCard &&
    samePromotionSynthesis(preview.synthesis, request.synthesis)
  );
}

export function promotionCommitMatchesRequest(
  commit: KnowledgeThreadPromotionCommit,
  request: KnowledgeThreadPromotionRequest,
) {
  return (
    commit.scope === request.destination.scope &&
    commit.selectedMessageCount === request.selectedReplyMessageIds.length &&
    commit.includesSharedCard === request.includeSharedCard
  );
}

export function sharePreviewMatchesSelection(
  preview: KnowledgeSharePreview,
  selection: KnowledgeShareSelectionRequest,
) {
  const expected = new Set<KnowledgeShareSelectionCategory>();
  if (selection.includeTitle) expected.add('title');
  if (selection.includeSourceType) expected.add('source_type');
  if (selection.includeCanonicalUrl) expected.add('canonical_url');
  if (selection.snapshot?.includeProvenance)
    expected.add('snapshot_provenance');
  if (selection.snapshot?.includeExcerpt) expected.add('snapshot_excerpt');
  if (selection.labelAssignmentIds.length) expected.add('label');
  if (selection.annotations.length) expected.add('annotation');
  if (selection.conversationTurnIds.length) expected.add('conversation_turn');
  if (selection.syntheses.length) expected.add('synthesis');
  if (selection.sharerNote !== null) expected.add('sharer_note');
  return (
    preview.card.selectedCategories.length === expected.size &&
    preview.card.selectedCategories.every((category) => expected.has(category))
  );
}
