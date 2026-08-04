import {
  knowledgeLabelAssignmentSources,
  knowledgeLabelCapabilities,
  knowledgeLabelInputLimits,
  type KnowledgeItemLabelAssignment,
  type KnowledgeLabel,
  type KnowledgeLabelAlias,
  type KnowledgeLabelGrantInput,
  type KnowledgeLabelGroupGrant,
  type KnowledgeLabelListQuery,
  type KnowledgeLabelMutationFailure,
  type KnowledgeLabelReadRepository,
  type KnowledgeLabelTransaction,
  KnowledgeLabelTransactionConflictError,
  type KnowledgeLabelUnitOfWork,
  type KnowledgeLabelWriteRepository,
} from './knowledgeLabelPorts.js';
import {
  knowledgeItemScopes,
  type KnowledgeActor,
  type KnowledgeAuditActorContext,
  type KnowledgeItemScope,
} from './knowledgeItemPorts.js';

export type KnowledgeLabelApplicationFailure = {
  ok: false;
  statusCode: 400 | 404 | 409;
  code: 'invalid_request' | 'not_found' | 'version_conflict' | 'label_conflict';
  message: string;
};

export type KnowledgeLabelApplicationResult<T> =
  { ok: true; value: T } | KnowledgeLabelApplicationFailure;

export type CreateKnowledgeLabelInput = {
  scope: KnowledgeItemScope;
  displayName: string;
  slug: string;
  parentId?: string | null;
  groupGrants?: KnowledgeLabelGrantInput[];
};

export type UpdateKnowledgeLabelInput = {
  expectedVersion: number;
  displayName?: string;
  slug?: string;
  parentId?: string | null;
};

export type AttachKnowledgeLabelInput = {
  expectedVersion: number;
  labelId: string;
  assignmentSource?: (typeof knowledgeLabelAssignmentSources)[number];
  confidenceBasisPoints?: number | null;
};

function ok<T>(value: T): KnowledgeLabelApplicationResult<T> {
  return { ok: true, value };
}

function invalid(message: string): KnowledgeLabelApplicationFailure {
  return { ok: false, statusCode: 400, code: 'invalid_request', message };
}

function notFound(): KnowledgeLabelApplicationFailure {
  return {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  };
}

function versionConflict(): KnowledgeLabelApplicationFailure {
  return {
    ok: false,
    statusCode: 409,
    code: 'version_conflict',
    message: 'Version conflict',
  };
}

function labelConflict(): KnowledgeLabelApplicationFailure {
  return {
    ok: false,
    statusCode: 409,
    code: 'label_conflict',
    message: 'Label name is not available',
  };
}

function hasPrincipal(actor: KnowledgeActor) {
  return typeof actor.userId === 'string' && actor.userId.trim().length > 0;
}

function validId(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].length <= maximum
  );
}

function validExpectedVersion(value: unknown) {
  return (
    Number.isInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= knowledgeLabelInputLimits.expectedVersion
  );
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFKC');
  if (
    normalized.length === 0 ||
    [...normalized].length > knowledgeLabelInputLimits.displayName
  ) {
    return null;
  }
  return normalized;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSlug(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    [...normalized].length > knowledgeLabelInputLimits.slug ||
    !slugPattern.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeKnowledgeLabelName(value: string) {
  return value.trim().normalize('NFKC').toLowerCase();
}

function normalizeAlias(value: unknown) {
  if (typeof value !== 'string') return null;
  const alias = value.trim().normalize('NFKC');
  if (
    alias.length === 0 ||
    [...alias].length > knowledgeLabelInputLimits.alias
  ) {
    return null;
  }
  return { alias, normalizedAlias: normalizeKnowledgeLabelName(alias) };
}

function validateGrantInputs(
  value: unknown,
): { ok: true; grants: KnowledgeLabelGrantInput[] } | { ok: false } {
  if (value === undefined) return { ok: true, grants: [] };
  if (
    !Array.isArray(value) ||
    value.length > knowledgeLabelInputLimits.groupGrants
  ) {
    return { ok: false };
  }
  const seen = new Set<string>();
  const grants: KnowledgeLabelGrantInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false };
    }
    const record = raw as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (field) => field !== 'groupAccountId' && field !== 'capability',
      ) ||
      !validId(
        record.groupAccountId,
        knowledgeLabelInputLimits.groupAccountId,
      ) ||
      typeof record.capability !== 'string' ||
      !knowledgeLabelCapabilities.some(
        (capability) => capability === record.capability,
      )
    ) {
      return { ok: false };
    }
    const groupAccountId = record.groupAccountId.trim();
    if (seen.has(groupAccountId)) return { ok: false };
    seen.add(groupAccountId);
    grants.push({
      groupAccountId,
      capability: record.capability as KnowledgeLabelGrantInput['capability'],
    });
  }
  return { ok: true, grants };
}

function sameDomain(
  label: Pick<KnowledgeLabel, 'scope' | 'ownerUserId' | 'organizationId'>,
  parent: Pick<KnowledgeLabel, 'scope' | 'ownerUserId' | 'organizationId'>,
) {
  if (label.scope !== parent.scope) return false;
  return label.scope === 'personal'
    ? label.ownerUserId === parent.ownerUserId
    : label.organizationId !== null &&
        label.organizationId === parent.organizationId;
}

function actorAudit(
  actor: KnowledgeActor,
  context: KnowledgeAuditActorContext,
) {
  return {
    userId: actor.userId,
    requestId: context.requestId,
    source: context.source,
  };
}

function mutationFailure(
  reason: KnowledgeLabelMutationFailure,
): KnowledgeLabelApplicationFailure {
  switch (reason) {
    case 'version_conflict':
      return versionConflict();
    case 'duplicate':
      return labelConflict();
    case 'cycle':
      return invalid('label hierarchy would contain a cycle');
    case 'hierarchy_too_deep':
      return invalid('label hierarchy exceeds the maximum depth');
    case 'broken_hierarchy':
      return invalid('label hierarchy is inconsistent');
    case 'has_active_children':
      return invalid('label with active children cannot be deleted');
  }
}

function validListQuery(query: KnowledgeLabelListQuery) {
  return (
    Number.isInteger(query.limit) &&
    query.limit >= 1 &&
    query.limit <= knowledgeLabelInputLimits.listLimit &&
    Number.isInteger(query.offset) &&
    query.offset >= 0 &&
    query.offset <= knowledgeLabelInputLimits.listOffset &&
    (query.scope === undefined || knowledgeItemScopes.includes(query.scope)) &&
    (query.parentId === undefined ||
      query.parentId === null ||
      validId(query.parentId, knowledgeLabelInputLimits.labelId))
  );
}

async function namesAvailable(
  repository: KnowledgeLabelWriteRepository,
  input: {
    actor: KnowledgeActor;
    label: Pick<KnowledgeLabel, 'scope' | 'organizationId'>;
    names: string[];
    excludeLabelId?: string;
  },
) {
  for (const normalizedName of new Set(input.names)) {
    const available = await repository.isNameAvailable({
      actor: input.actor,
      scope: input.label.scope,
      organizationId: input.label.organizationId,
      normalizedName,
      excludeLabelId: input.excludeLabelId,
    });
    if (!available) return false;
  }
  return true;
}

export type KnowledgeLabelService = ReturnType<
  typeof createKnowledgeLabelService
>;

export function createKnowledgeLabelService(dependencies: {
  reader: KnowledgeLabelReadRepository;
  unitOfWork: KnowledgeLabelUnitOfWork;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  async function runMutation<T>(
    work: (
      transaction: KnowledgeLabelTransaction,
    ) => Promise<KnowledgeLabelApplicationResult<T>>,
    duplicateFailure: () => KnowledgeLabelApplicationFailure = labelConflict,
  ): Promise<KnowledgeLabelApplicationResult<T>> {
    try {
      return await dependencies.unitOfWork.run(work);
    } catch (error) {
      if (error instanceof KnowledgeLabelTransactionConflictError) {
        return error.conflict === 'duplicate'
          ? duplicateFailure()
          : versionConflict();
      }
      throw error;
    }
  }

  return {
    async list(input: {
      actor: KnowledgeActor;
      query: KnowledgeLabelListQuery;
    }) {
      if (!hasPrincipal(input.actor) || !validListQuery(input.query)) return [];
      return dependencies.reader.listVisible(input.actor, input.query);
    },

    async detail(input: { actor: KnowledgeActor; labelId: string }) {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      const label = await dependencies.reader.findVisibleById(
        input.actor,
        input.labelId,
      );
      return label ? ok(label) : notFound();
    },

    async aliases(input: { actor: KnowledgeActor; labelId: string }) {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      const aliases = await dependencies.reader.listVisibleAliases(
        input.actor,
        input.labelId,
      );
      return aliases ? ok(aliases) : notFound();
    },

    async grants(input: { actor: KnowledgeActor; labelId: string }) {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      const grants = await dependencies.reader.listManageableGrants(
        input.actor,
        input.labelId,
      );
      return grants ? ok(grants) : notFound();
    },

    async create(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      body: CreateKnowledgeLabelInput;
    }): Promise<KnowledgeLabelApplicationResult<KnowledgeLabel>> {
      if (!hasPrincipal(input.actor)) return invalid('actor is required');
      if (!input.body || typeof input.body !== 'object') {
        return invalid('body is required');
      }
      const allowed = new Set([
        'scope',
        'displayName',
        'slug',
        'parentId',
        'groupGrants',
      ]);
      if (Object.keys(input.body).some((field) => !allowed.has(field))) {
        return invalid('body contains an unsupported field');
      }
      if (!knowledgeItemScopes.includes(input.body.scope)) {
        return invalid('scope is invalid');
      }
      const displayName = normalizeDisplayName(input.body.displayName);
      const slug = normalizeSlug(input.body.slug);
      if (!displayName || !slug) {
        return invalid('displayName or slug is invalid');
      }
      const grants = validateGrantInputs(input.body.groupGrants);
      if (!grants.ok) return invalid('group grants are invalid');
      const parentId = input.body.parentId ?? null;
      if (
        parentId !== null &&
        !validId(parentId, knowledgeLabelInputLimits.labelId)
      ) {
        return invalid('parentId is invalid');
      }
      const organizationId =
        input.body.scope === 'organization'
          ? input.actor.organizationId?.trim() || null
          : null;
      if (input.body.scope === 'organization') {
        if (!organizationId || grants.grants.length === 0) {
          return invalid(
            'organization scope requires organization context and a group grant',
          );
        }
      } else if (grants.grants.length > 0) {
        return invalid('personal scope cannot include group grants');
      }

      return runMutation(async (transaction) => {
        if (grants.grants.length > 0) {
          const activeCount = await transaction.labels.countActiveGroups(
            grants.grants.map((grant) => grant.groupAccountId),
          );
          if (activeCount !== grants.grants.length) {
            return invalid('group grant is not active');
          }
        }
        const domain = {
          ownerUserId: input.actor.userId,
          scope: input.body.scope,
          organizationId,
        };
        if (parentId) {
          const parent = await transaction.labels.findManageableById(
            input.actor,
            parentId,
          );
          if (!parent || !sameDomain(domain, parent)) return notFound();
        }
        const available = await namesAvailable(transaction.labels, {
          actor: input.actor,
          label: domain,
          names: [
            normalizeKnowledgeLabelName(displayName),
            normalizeKnowledgeLabelName(slug),
          ],
        });
        if (!available) return labelConflict();
        const created = await transaction.labels.create({
          ownerUserId: input.actor.userId,
          scope: input.body.scope,
          organizationId,
          displayName,
          slug,
          parentId,
          groupGrants: grants.grants,
          createdBy: input.actor.userId,
          updatedBy: input.actor.userId,
        });
        if (!created.ok) return mutationFailure(created.reason);
        await transaction.audit.write({
          action: 'knowledge_label_created',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'label_master',
            scope: created.value.scope,
            version: created.value.version,
          },
        });
        return ok(created.value);
      });
    },

    async update(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      labelId: string;
      body: UpdateKnowledgeLabelInput;
    }): Promise<KnowledgeLabelApplicationResult<KnowledgeLabel>> {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      if (!input.body || typeof input.body !== 'object') {
        return invalid('body is required');
      }
      const allowed = new Set([
        'expectedVersion',
        'displayName',
        'slug',
        'parentId',
      ]);
      if (Object.keys(input.body).some((field) => !allowed.has(field))) {
        return invalid('body contains an unsupported field');
      }
      if (!validExpectedVersion(input.body.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      const patch: {
        displayName?: string;
        slug?: string;
        parentId?: string | null;
      } = {};
      if ('displayName' in input.body) {
        const displayName = normalizeDisplayName(input.body.displayName);
        if (!displayName) return invalid('displayName is invalid');
        patch.displayName = displayName;
      }
      if ('slug' in input.body) {
        const slug = normalizeSlug(input.body.slug);
        if (!slug) return invalid('slug is invalid');
        patch.slug = slug;
      }
      if ('parentId' in input.body) {
        if (
          input.body.parentId !== null &&
          !validId(input.body.parentId, knowledgeLabelInputLimits.labelId)
        ) {
          return invalid('parentId is invalid');
        }
        patch.parentId = input.body.parentId;
      }
      if (Object.keys(patch).length === 0) {
        return invalid('at least one mutable field is required');
      }

      return runMutation(async (transaction) => {
        const current = await transaction.labels.findManageableById(
          input.actor,
          input.labelId,
        );
        if (!current) return notFound();
        if (current.version !== input.body.expectedVersion) {
          return versionConflict();
        }
        const actual = {
          ...(patch.displayName !== undefined &&
          patch.displayName !== current.displayName
            ? { displayName: patch.displayName }
            : {}),
          ...(patch.slug !== undefined && patch.slug !== current.slug
            ? { slug: patch.slug }
            : {}),
          ...('parentId' in patch && patch.parentId !== current.parentId
            ? { parentId: patch.parentId }
            : {}),
        };
        if (Object.keys(actual).length === 0) {
          return invalid('at least one mutable field must change');
        }
        if ('parentId' in actual && actual.parentId) {
          if (actual.parentId === current.id) {
            return invalid('label hierarchy would contain a cycle');
          }
          const parent = await transaction.labels.findManageableById(
            input.actor,
            actual.parentId,
          );
          if (!parent || !sameDomain(current, parent)) return notFound();
        }
        const changedNames = [actual.displayName, actual.slug]
          .filter((value): value is string => value !== undefined)
          .map(normalizeKnowledgeLabelName);
        if (
          changedNames.length > 0 &&
          !(await namesAvailable(transaction.labels, {
            actor: input.actor,
            label: current,
            names: changedNames,
            excludeLabelId: current.id,
          }))
        ) {
          return labelConflict();
        }
        const updated = await transaction.labels.updateVersioned({
          actor: input.actor,
          labelId: current.id,
          expectedVersion: input.body.expectedVersion,
          patch: actual,
        });
        if (!updated.ok) return mutationFailure(updated.reason);
        await transaction.audit.write({
          action: 'knowledge_label_updated',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'label_master',
            scope: updated.value.scope,
            version: updated.value.version,
          },
        });
        return ok(updated.value);
      });
    },

    async remove(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      labelId: string;
      expectedVersion: number;
    }): Promise<KnowledgeLabelApplicationResult<KnowledgeLabel>> {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      if (!validExpectedVersion(input.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      return runMutation(async (transaction) => {
        const current = await transaction.labels.findManageableById(
          input.actor,
          input.labelId,
        );
        if (!current) return notFound();
        if (current.version !== input.expectedVersion) return versionConflict();
        const removed = await transaction.labels.deleteVersioned({
          actor: input.actor,
          labelId: current.id,
          expectedVersion: input.expectedVersion,
          deletedAt: now(),
        });
        if (!removed.ok) return mutationFailure(removed.reason);
        await transaction.audit.write({
          action: 'knowledge_label_deleted',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'label_master',
            scope: removed.value.scope,
            version: removed.value.version,
          },
        });
        return ok(removed.value);
      });
    },

    async addAlias(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      labelId: string;
      expectedVersion: number;
      alias: string;
    }): Promise<
      KnowledgeLabelApplicationResult<{
        alias: KnowledgeLabelAlias;
        labelVersion: number;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      if (!validExpectedVersion(input.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      const alias = normalizeAlias(input.alias);
      if (!alias) return invalid('alias is invalid');
      return runMutation(async (transaction) => {
        const current = await transaction.labels.findManageableById(
          input.actor,
          input.labelId,
        );
        if (!current) return notFound();
        if (current.version !== input.expectedVersion) return versionConflict();
        if (
          alias.normalizedAlias ===
            normalizeKnowledgeLabelName(current.displayName) ||
          alias.normalizedAlias === normalizeKnowledgeLabelName(current.slug)
        ) {
          return invalid('alias must differ from the canonical label name');
        }
        if (
          !(await namesAvailable(transaction.labels, {
            actor: input.actor,
            label: current,
            names: [alias.normalizedAlias],
            excludeLabelId: current.id,
          }))
        ) {
          return labelConflict();
        }
        const created = await transaction.labels.addAliasVersioned({
          actor: input.actor,
          labelId: current.id,
          expectedVersion: input.expectedVersion,
          ...alias,
        });
        if (!created.ok) return mutationFailure(created.reason);
        await transaction.audit.write({
          action: 'knowledge_label_alias_added',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'label_master',
            scope: current.scope,
            version: created.value.labelVersion,
          },
        });
        return ok(created.value);
      });
    },

    async removeAlias(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      labelId: string;
      aliasId: string;
      expectedVersion: number;
    }): Promise<
      KnowledgeLabelApplicationResult<{
        alias: KnowledgeLabelAlias;
        labelVersion: number;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId) ||
        !validId(input.aliasId, knowledgeLabelInputLimits.aliasId)
      ) {
        return notFound();
      }
      if (!validExpectedVersion(input.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      return runMutation(async (transaction) => {
        const current = await transaction.labels.findManageableById(
          input.actor,
          input.labelId,
        );
        if (!current) return notFound();
        if (current.version !== input.expectedVersion) return versionConflict();
        const removed = await transaction.labels.removeAliasVersioned({
          actor: input.actor,
          labelId: current.id,
          aliasId: input.aliasId,
          expectedVersion: input.expectedVersion,
        });
        if (!removed) return notFound();
        if (!removed.ok) return mutationFailure(removed.reason);
        await transaction.audit.write({
          action: 'knowledge_label_alias_removed',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'label_master',
            scope: current.scope,
            version: removed.value.labelVersion,
          },
        });
        return ok(removed.value);
      });
    },

    async replaceGrants(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      labelId: string;
      expectedVersion: number;
      groupGrants: KnowledgeLabelGrantInput[];
    }): Promise<
      KnowledgeLabelApplicationResult<{
        grants: KnowledgeLabelGroupGrant[];
        labelVersion: number;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      if (!validExpectedVersion(input.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      const grants = validateGrantInputs(input.groupGrants);
      if (!grants.ok) return invalid('group grants are invalid');
      return runMutation(async (transaction) => {
        const current = await transaction.labels.findManageableById(
          input.actor,
          input.labelId,
        );
        if (!current) return notFound();
        if (current.version !== input.expectedVersion) return versionConflict();
        if (current.scope !== 'organization') {
          return invalid('personal labels cannot have group grants');
        }
        if (grants.grants.length > 0) {
          const activeCount = await transaction.labels.countActiveGroups(
            grants.grants.map((grant) => grant.groupAccountId),
          );
          if (activeCount !== grants.grants.length) {
            return invalid('group grant is not active');
          }
        }
        const replaced = await transaction.labels.replaceGrantsVersioned({
          actor: input.actor,
          labelId: current.id,
          expectedVersion: input.expectedVersion,
          grants: grants.grants,
        });
        if (!replaced.ok) return mutationFailure(replaced.reason);
        await transaction.audit.write({
          action: 'knowledge_label_grants_replaced',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'label_master',
            scope: current.scope,
            version: replaced.value.labelVersion,
          },
        });
        return ok(replaced.value);
      });
    },

    async attach(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      body: AttachKnowledgeLabelInput;
    }): Promise<
      KnowledgeLabelApplicationResult<{
        assignment: KnowledgeItemLabelAssignment;
        itemVersion: number;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.itemId, knowledgeLabelInputLimits.itemId) ||
        !validId(input.body?.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      const allowed = new Set([
        'expectedVersion',
        'labelId',
        'assignmentSource',
        'confidenceBasisPoints',
      ]);
      if (Object.keys(input.body).some((field) => !allowed.has(field))) {
        return invalid('body contains an unsupported field');
      }
      if (!validExpectedVersion(input.body.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      const assignmentSource = input.body.assignmentSource ?? 'manual';
      if (!knowledgeLabelAssignmentSources.includes(assignmentSource)) {
        return invalid('assignmentSource is invalid');
      }
      const confidenceBasisPoints = input.body.confidenceBasisPoints ?? null;
      if (
        confidenceBasisPoints !== null &&
        (!Number.isInteger(confidenceBasisPoints) ||
          confidenceBasisPoints < 0 ||
          confidenceBasisPoints >
            knowledgeLabelInputLimits.confidenceBasisPoints)
      ) {
        return invalid('confidenceBasisPoints is invalid');
      }
      if (
        assignmentSource !== 'ai_suggestion' &&
        confidenceBasisPoints !== null
      ) {
        return invalid(
          'confidenceBasisPoints is only valid for AI suggestions',
        );
      }
      return runMutation(
        async (transaction) => {
          const item = await transaction.itemLabels.findOwnedItemForMutation({
            actor: input.actor,
            itemId: input.itemId,
          });
          if (!item) return notFound();
          if (item.version !== input.body.expectedVersion) {
            return versionConflict();
          }
          const label = await transaction.labels.findUsableById(
            input.actor,
            input.body.labelId,
          );
          if (!label || !sameDomain(item, label)) return notFound();
          const attached = await transaction.itemLabels.attachVersioned({
            actor: input.actor,
            itemId: item.id,
            labelId: label.id,
            expectedVersion: input.body.expectedVersion,
            assignmentSource,
            confidenceBasisPoints,
          });
          if (!attached.ok) {
            return attached.reason === 'duplicate'
              ? invalid('label is already attached')
              : mutationFailure(attached.reason);
          }
          if (!attached.value.assignment)
            return invalid('label was not attached');
          await transaction.audit.write({
            action: 'knowledge_item_label_attached',
            actor: actorAudit(input.actor, input.auditActor),
            target: {
              kind: 'knowledge_item',
              itemId: item.id,
              scope: item.scope,
              status: item.status,
              version: attached.value.itemVersion,
              assignmentSource,
            },
          });
          return ok({
            assignment: attached.value.assignment,
            itemVersion: attached.value.itemVersion,
          });
        },
        () => invalid('label is already attached'),
      );
    },

    async detach(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      labelId: string;
      expectedVersion: number;
    }): Promise<
      KnowledgeLabelApplicationResult<{
        assignment: KnowledgeItemLabelAssignment;
        itemVersion: number;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !validId(input.itemId, knowledgeLabelInputLimits.itemId) ||
        !validId(input.labelId, knowledgeLabelInputLimits.labelId)
      ) {
        return notFound();
      }
      if (!validExpectedVersion(input.expectedVersion)) {
        return invalid('expectedVersion is invalid');
      }
      return runMutation(async (transaction) => {
        const item = await transaction.itemLabels.findOwnedItemForMutation({
          actor: input.actor,
          itemId: input.itemId,
        });
        if (!item) return notFound();
        if (item.version !== input.expectedVersion) return versionConflict();
        const label = await transaction.labels.findUsableById(
          input.actor,
          input.labelId,
        );
        if (!label || !sameDomain(item, label)) return notFound();
        const detached = await transaction.itemLabels.detachVersioned({
          actor: input.actor,
          itemId: item.id,
          labelId: label.id,
          expectedVersion: input.expectedVersion,
        });
        if (!detached.ok) return mutationFailure(detached.reason);
        if (!detached.value.assignment) return notFound();
        await transaction.audit.write({
          action: 'knowledge_item_label_detached',
          actor: actorAudit(input.actor, input.auditActor),
          target: {
            kind: 'knowledge_item',
            itemId: item.id,
            scope: item.scope,
            status: item.status,
            version: detached.value.itemVersion,
          },
        });
        return ok({
          assignment: detached.value.assignment,
          itemVersion: detached.value.itemVersion,
        });
      });
    },
  };
}
