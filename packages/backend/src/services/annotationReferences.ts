type AnnotationRecord = {
  notes?: string | null;
  externalUrls?: unknown;
  internalRefs?: unknown;
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
): Promise<ResolvedAnnotationReferenceState> {
  const annotation = (await client.annotation?.findUnique?.({
    where: { targetKind_targetId: { targetKind, targetId } },
    select: {
      notes: true,
      externalUrls: true,
      internalRefs: true,
      updatedAt: true,
      updatedBy: true,
    },
  })) as AnnotationRecord;

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
