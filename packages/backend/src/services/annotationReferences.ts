type AnnotationRecord = {
  id?: string;
  targetKind?: string;
  targetId?: string;
  notes?: string | null;
  externalUrls?: unknown;
  internalRefs?: unknown;
  createdAt?: Date | null;
  createdBy?: string | null;
  updatedAt?: Date | null;
  updatedBy?: string | null;
} | null;

type ReferenceLinkRecord = {
  linkKind: string;
  refKind?: string | null;
  value: string;
  label?: string | null;
  updatedAt?: Date | null;
  updatedBy?: string | null;
};

export type AnnotationInternalRef = {
  kind: string;
  id: string;
  label?: string;
};

export type ResolvedAnnotationReferenceState = {
  notes: string | null;
  externalUrls: string[];
  internalRefs: AnnotationInternalRef[];
  updatedAt: Date | null;
  updatedBy: string | null;
};

export type ReferenceLinkBackfillOptions = {
  dryRun?: boolean;
  batchSize?: number;
  limitTargets?: number;
  targetKind?: string;
  targetId?: string;
};

export type ReferenceLinkBackfillSummary = {
  dryRun: boolean;
  batchSize: number;
  limitTargets: number | null;
  scannedTargets: number;
  candidateTargets: number;
  candidateLinks: number;
  createdTargets: number;
  createdLinks: number;
  skippedExistingTargets: number;
  skippedEmptyTargets: number;
  processedBatches: number;
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeInternalRefKind(kind: string) {
  return kind === 'project_chat' ? 'room_chat' : kind;
}

export function normalizeStoredExternalUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const url = normalizeString(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function normalizeStoredInternalRefs(
  value: unknown,
): AnnotationInternalRef[] {
  if (!Array.isArray(value)) return [];
  const refs: AnnotationInternalRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const rawKind = normalizeString(record.kind);
    const kind = normalizeInternalRefKind(rawKind);
    const id = normalizeString(record.id);
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = normalizeString(record.label);
    refs.push(label ? { kind, id, label } : { kind, id });
  }
  return refs;
}

function mergeReferenceLinks(
  baseExternalUrls: string[],
  baseInternalRefs: AnnotationInternalRef[],
  referenceLinks: ReferenceLinkRecord[],
) {
  const externalUrls = [...baseExternalUrls];
  const seenUrls = new Set(externalUrls);
  const internalRefs = [...baseInternalRefs];
  const seenRefs = new Set(internalRefs.map((ref) => `${ref.kind}:${ref.id}`));

  for (const link of referenceLinks) {
    const linkKind = normalizeString(link.linkKind);
    if (linkKind === 'external_url') {
      const url = normalizeString(link.value);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      externalUrls.push(url);
      continue;
    }
    if (linkKind !== 'internal_ref') continue;
    const kind = normalizeInternalRefKind(normalizeString(link.refKind));
    const id = normalizeString(link.value);
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    const label = normalizeString(link.label);
    if (seenRefs.has(key)) {
      if (!label) continue;
      const existingIndex = internalRefs.findIndex(
        (ref) => ref.kind === kind && ref.id === id,
      );
      if (existingIndex === -1) continue;
      internalRefs[existingIndex] = { ...internalRefs[existingIndex], label };
      continue;
    }
    seenRefs.add(key);
    internalRefs.push(label ? { kind, id, label } : { kind, id });
  }

  return { externalUrls, internalRefs };
}

function isReferenceLinkTableMissing(error: unknown) {
  const code =
    error && typeof error === 'object' ? (error as { code?: string }).code : '';
  if (code === 'P2021' || code === 'P2010') return true;
  const message =
    error && typeof error === 'object'
      ? String((error as { message?: unknown }).message ?? '')
      : '';
  return (
    message.includes('does not exist') || message.includes('no such table')
  );
}

function normalizeBatchSize(value?: number) {
  if (!Number.isFinite(value)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(Number(value))));
}

function normalizeLimitTargets(value?: number) {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(Number(value));
  return normalized > 0 ? normalized : null;
}

function buildReferenceLinkData(annotation: NonNullable<AnnotationRecord>) {
  const targetKind = normalizeString(annotation.targetKind);
  const targetId = normalizeString(annotation.targetId);
  if (!targetKind || !targetId) return [];
  const createdAt = annotation.createdAt ?? annotation.updatedAt ?? new Date();
  const updatedAt = annotation.updatedAt ?? annotation.createdAt ?? createdAt;
  const createdBy = annotation.createdBy ?? annotation.updatedBy ?? null;
  const updatedBy = annotation.updatedBy ?? annotation.createdBy ?? null;
  const externalUrls = normalizeStoredExternalUrls(annotation.externalUrls);
  const internalRefs = normalizeStoredInternalRefs(annotation.internalRefs);
  return [
    ...externalUrls.map((url, index) => ({
      targetKind,
      targetId,
      linkKind: 'external_url',
      refKind: '',
      value: url,
      label: null,
      sortOrder: index,
      createdAt,
      createdBy,
      updatedAt,
      updatedBy,
    })),
    ...internalRefs.map((ref, index) => ({
      targetKind,
      targetId,
      linkKind: 'internal_ref',
      refKind: normalizeInternalRefKind(ref.kind),
      value: ref.id,
      label: ref.label ?? null,
      sortOrder: index,
      createdAt,
      createdBy,
      updatedAt,
      updatedBy,
    })),
  ];
}

function buildAnnotationBackfillWhere(
  options: Pick<ReferenceLinkBackfillOptions, 'targetKind' | 'targetId'>,
  cursor?: { id: string } | null,
) {
  const filters: Record<string, unknown>[] = [];
  const targetKind = normalizeString(options.targetKind);
  const targetId = normalizeString(options.targetId);
  if (targetKind) filters.push({ targetKind });
  if (targetId) filters.push({ targetId });
  if (cursor) filters.push({ id: { gt: cursor.id } });
  if (!filters.length) return undefined;
  if (filters.length === 1) return filters[0];
  return { AND: filters };
}

export async function replaceReferenceLinks(
  client: any,
  targetKind: string,
  targetId: string,
  externalUrls: string[],
  internalRefs: AnnotationInternalRef[],
  actorUserId: string | null,
) {
  if (typeof client.referenceLink?.deleteMany !== 'function') return false;

  try {
    await client.referenceLink.deleteMany({
      where: {
        targetKind,
        targetId,
        linkKind: { in: ['external_url', 'internal_ref'] },
      },
    });
    const data = [
      ...externalUrls.map((url, index) => ({
        targetKind,
        targetId,
        linkKind: 'external_url',
        refKind: '',
        value: url,
        label: null,
        sortOrder: index,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })),
      ...internalRefs.map((ref, index) => ({
        targetKind,
        targetId,
        linkKind: 'internal_ref',
        refKind: normalizeInternalRefKind(ref.kind),
        value: ref.id,
        label: ref.label ?? null,
        sortOrder: index,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })),
    ];
    if (data.length === 0) return true;
    if (typeof client.referenceLink.createMany === 'function') {
      await client.referenceLink.createMany({ data });
      return true;
    }
    if (typeof client.referenceLink.create !== 'function') return true;
    for (const row of data) {
      await client.referenceLink.create({ data: row });
    }
    return true;
  } catch (error) {
    if (!isReferenceLinkTableMissing(error)) throw error;
    return false;
  }
}

export async function isReferenceLinkTableAvailable(client: any) {
  if (typeof client.referenceLink?.findMany !== 'function') return false;
  try {
    await client.referenceLink.findMany({
      take: 1,
      select: { id: true },
    });
    return true;
  } catch (error) {
    if (!isReferenceLinkTableMissing(error)) throw error;
    return false;
  }
}

export async function backfillReferenceLinksFromAnnotations(
  client: any,
  options: ReferenceLinkBackfillOptions = {},
): Promise<ReferenceLinkBackfillSummary> {
  if (typeof client.annotation?.findMany !== 'function') {
    throw new Error('annotation_findMany_not_available');
  }
  if (typeof client.referenceLink?.findMany !== 'function') {
    throw new Error('referenceLink_findMany_not_available');
  }
  const dryRun = options.dryRun !== false;
  if (!dryRun && typeof client.referenceLink?.createMany !== 'function') {
    throw new Error('referenceLink_createMany_not_available');
  }

  const batchSize = normalizeBatchSize(options.batchSize);
  const limitTargets = normalizeLimitTargets(options.limitTargets);
  const summary: ReferenceLinkBackfillSummary = {
    dryRun,
    batchSize,
    limitTargets,
    scannedTargets: 0,
    candidateTargets: 0,
    candidateLinks: 0,
    createdTargets: 0,
    createdLinks: 0,
    skippedExistingTargets: 0,
    skippedEmptyTargets: 0,
    processedBatches: 0,
  };

  let cursor: { id: string } | null = null;

  while (true) {
    const remaining =
      limitTargets === null
        ? batchSize
        : Math.min(batchSize, limitTargets - summary.scannedTargets);
    if (remaining <= 0) break;

    const annotations = (await client.annotation.findMany({
      where: buildAnnotationBackfillWhere(options, cursor),
      orderBy: { id: 'asc' },
      take: remaining,
      select: {
        id: true,
        targetKind: true,
        targetId: true,
        externalUrls: true,
        internalRefs: true,
        createdAt: true,
        createdBy: true,
        updatedAt: true,
        updatedBy: true,
      },
    })) as NonNullable<AnnotationRecord>[];

    if (!annotations.length) break;
    summary.processedBatches += 1;
    summary.scannedTargets += annotations.length;

    const targetPairs = annotations.map((annotation) => ({
      targetKind: normalizeString(annotation.targetKind),
      targetId: normalizeString(annotation.targetId),
    }));
    let existingLinks: Array<{
      targetKind: string;
      targetId: string;
    }> = [];
    try {
      existingLinks = await client.referenceLink.findMany({
        where: {
          OR: targetPairs,
          linkKind: { in: ['external_url', 'internal_ref'] },
        },
        select: {
          targetKind: true,
          targetId: true,
        },
      });
    } catch (error) {
      if (!isReferenceLinkTableMissing(error)) throw error;
      throw new Error('referenceLink_table_missing');
    }
    const existingKeys = new Set(
      existingLinks.map((item) => `${item.targetKind}:${item.targetId}`),
    );

    const rowsToCreate: Array<Record<string, unknown>> = [];
    let createdTargetsInBatch = 0;
    for (const annotation of annotations) {
      const key = `${normalizeString(annotation.targetKind)}:${normalizeString(annotation.targetId)}`;
      const rows = buildReferenceLinkData(annotation);
      if (rows.length === 0) {
        summary.skippedEmptyTargets += 1;
        continue;
      }
      if (existingKeys.has(key)) {
        summary.skippedExistingTargets += 1;
        continue;
      }
      summary.candidateTargets += 1;
      summary.candidateLinks += rows.length;
      rowsToCreate.push(...rows);
      createdTargetsInBatch += 1;
    }

    if (!dryRun && rowsToCreate.length > 0) {
      const result = await client.referenceLink.createMany({
        data: rowsToCreate,
        skipDuplicates: true,
      });
      summary.createdTargets += createdTargetsInBatch;
      summary.createdLinks += result.count ?? rowsToCreate.length;
    }

    const last = annotations[annotations.length - 1];
    cursor = {
      id: normalizeString(last.id),
    };
  }

  return summary;
}

function resolveUpdatedMeta(
  annotation: AnnotationRecord,
  referenceLinks: ReferenceLinkRecord[],
) {
  let updatedAt = annotation?.updatedAt ?? null;
  let updatedBy = annotation?.updatedBy ?? null;
  for (const link of referenceLinks) {
    const candidate = link.updatedAt ?? null;
    if (!candidate) continue;
    if (!updatedAt || candidate > updatedAt) {
      updatedAt = candidate;
      updatedBy = link.updatedBy ?? null;
    }
  }
  return { updatedAt, updatedBy };
}

export async function loadResolvedAnnotationReferenceState(
  client: any,
  targetKind: string,
  targetId: string,
  annotationOverride?: AnnotationRecord,
): Promise<ResolvedAnnotationReferenceState> {
  const annotation =
    annotationOverride ??
    ((await client.annotation?.findUnique?.({
      where: { targetKind_targetId: { targetKind, targetId } },
      select: {
        notes: true,
        externalUrls: true,
        internalRefs: true,
        updatedAt: true,
        updatedBy: true,
      },
    })) as AnnotationRecord);

  let referenceLinks: ReferenceLinkRecord[] = [];
  if (typeof client.referenceLink?.findMany === 'function') {
    try {
      referenceLinks = (await client.referenceLink.findMany({
        where: { targetKind, targetId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          linkKind: true,
          refKind: true,
          value: true,
          label: true,
          updatedAt: true,
          updatedBy: true,
        },
      })) as ReferenceLinkRecord[];
    } catch (error) {
      if (!isReferenceLinkTableMissing(error)) throw error;
    }
  }

  const baseExternalUrls = normalizeStoredExternalUrls(
    annotation?.externalUrls,
  );
  const baseInternalRefs = normalizeStoredInternalRefs(
    annotation?.internalRefs,
  );
  const merged = mergeReferenceLinks(
    baseExternalUrls,
    baseInternalRefs,
    referenceLinks,
  );
  const meta = resolveUpdatedMeta(annotation, referenceLinks);
  return {
    notes: annotation?.notes ?? null,
    externalUrls: merged.externalUrls,
    internalRefs: merged.internalRefs,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
  };
}
