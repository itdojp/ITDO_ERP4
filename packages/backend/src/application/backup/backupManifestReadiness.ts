import {
  BACKUP_RETENTION_CLASSES,
  type BackupReadinessObservation,
  type BackupReadinessPolicy,
  type BackupRetentionClass,
} from './storageReadiness.js';

const MANIFEST_SCHEMA = 'erp4.backup.manifest.v1';
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_TYPES = ['database', 'globals', 'metadata'] as const;
const ARTIFACT_TYPES = [...REQUIRED_TYPES, 'assets'] as const;
const MAX_INVENTORY_ENTRIES = 20_000;

export type BackupObjectEntry = {
  key: string;
  sizeBytes: number;
};

export type BackupObjectSource = {
  list(): Promise<BackupObjectEntry[]>;
  readManifest(key: string): Promise<unknown>;
  statArtifact(key: string): Promise<{
    sha256: string | null;
    sizeBytes: number;
  }>;
};

type ParsedManifest = {
  artifact: {
    name: string;
    sha256: string;
    sizeBytes: number;
    type: (typeof ARTIFACT_TYPES)[number];
  };
  backupId: string;
  environment: string;
  generatedAt: string;
  retentionClass: BackupRetentionClass;
};

type Generation = {
  generatedAt: string;
  retentionClass: BackupRetentionClass;
  types: Set<string>;
  valid: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function timestampFromBackupId(backupId: string) {
  const match =
    /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[A-Fa-f0-9]{7,64}$/.exec(
      backupId,
    );
  if (!match) return null;
  const value = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );
  const expected = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  return !Number.isNaN(value.getTime()) && value.toISOString() === expected
    ? expected
    : null;
}

function hasExpectedSakuraKeyLayout(
  key: string,
  manifest: Pick<
    ParsedManifest,
    'artifact' | 'backupId' | 'generatedAt' | 'retentionClass'
  >,
) {
  if (!key.includes('/')) return true;
  const segments = key.split('/');
  const [year, month, day] = manifest.generatedAt.slice(0, 10).split('-');
  const dateSegments =
    manifest.retentionClass === 'hourly'
      ? [year, month, day]
      : manifest.retentionClass === 'daily'
        ? [year, month]
        : [year];
  return (
    segments.join('/') ===
    [
      manifest.retentionClass,
      ...dateSegments,
      manifest.backupId,
      manifest.artifact.type,
      manifest.artifact.name,
    ].join('/')
  );
}

function parseManifest(
  value: unknown,
  artifactKey: string,
  expectedEnvironment: string,
  requireOpenPgp: boolean,
): ParsedManifest | null {
  const root = asRecord(value);
  const artifact = asRecord(root?.artifact);
  const encryption = asRecord(root?.encryption);
  const application = asRecord(root?.application);
  const keySegments = artifactKey.split('/');
  const artifactName = keySegments[keySegments.length - 1] ?? '';
  if (
    root?.schemaVersion !== MANIFEST_SCHEMA ||
    typeof root.backupId !== 'string' ||
    !SAFE_TOKEN.test(root.backupId) ||
    root.backupId.includes('..') ||
    !isCanonicalUtc(root.generatedAt) ||
    root.environment !== expectedEnvironment ||
    !isOneOf(root.retentionClass, BACKUP_RETENTION_CLASSES) ||
    !isOneOf(artifact?.type, ARTIFACT_TYPES) ||
    artifact.name !== artifactName ||
    (requireOpenPgp && !artifact.name.endsWith('.gpg')) ||
    typeof artifact.sourceName !== 'string' ||
    !SAFE_FILENAME.test(artifact.sourceName) ||
    !Number.isSafeInteger(artifact.sourceSizeBytes) ||
    Number(artifact.sourceSizeBytes) < 0 ||
    !Number.isSafeInteger(artifact.sizeBytes) ||
    Number(artifact.sizeBytes) <= 0 ||
    typeof artifact.sha256 !== 'string' ||
    !SHA256.test(artifact.sha256) ||
    (requireOpenPgp && encryption?.algorithm !== 'openpgp') ||
    (!requireOpenPgp &&
      !['none', 'openpgp'].includes(String(encryption?.algorithm))) ||
    typeof application?.commitSha !== 'string' ||
    !SAFE_TOKEN.test(application.commitSha) ||
    root.backupId.slice(root.backupId.lastIndexOf('-') + 1).toLowerCase() !==
      application.commitSha.toLowerCase() ||
    timestampFromBackupId(root.backupId) !== root.generatedAt
  ) {
    return null;
  }
  const parsed: ParsedManifest = {
    artifact: {
      name: artifact.name,
      sha256: artifact.sha256,
      sizeBytes: Number(artifact.sizeBytes),
      type: artifact.type,
    },
    backupId: root.backupId,
    environment: root.environment,
    generatedAt: root.generatedAt,
    retentionClass: root.retentionClass,
  };
  return hasExpectedSakuraKeyLayout(artifactKey, parsed) ? parsed : null;
}

function increment(
  target: BackupReadinessObservation['anomalyCounts'],
  key: keyof BackupReadinessObservation['anomalyCounts'],
) {
  target[key] = (target[key] ?? 0) + 1;
}

const WINDOWS_MS: Record<BackupRetentionClass, number> = {
  hourly: 48 * 60 * 60 * 1000,
  daily: 30 * 24 * 60 * 60 * 1000,
  weekly: 12 * 7 * 24 * 60 * 60 * 1000,
  monthly: 13 * 31 * 24 * 60 * 60 * 1000,
};

function countRetentionCandidates(
  generations: Generation[],
  policy: BackupReadinessPolicy,
  now: Date,
) {
  let count = 0;
  for (const retentionClass of BACKUP_RETENTION_CLASSES) {
    const minimum = policy.minimums[retentionClass];
    if (minimum === undefined) continue;
    const candidates = generations
      .filter(
        (generation) =>
          generation.valid && generation.retentionClass === retentionClass,
      )
      .sort(
        (left, right) =>
          new Date(right.generatedAt).getTime() -
          new Date(left.generatedAt).getTime(),
      )
      .slice(minimum)
      .filter(
        (generation) =>
          now.getTime() - new Date(generation.generatedAt).getTime() >
          WINDOWS_MS[retentionClass],
      );
    count += candidates.length;
  }
  return count;
}

export async function inspectBackupObjectSource(options: {
  configured: boolean;
  expectedEnvironment: string;
  now: Date;
  policy: BackupReadinessPolicy;
  requireOpenPgp: boolean;
  source: BackupObjectSource;
}): Promise<BackupReadinessObservation> {
  if (!options.configured) {
    return {
      anomalyCounts: {},
      classCounts: {},
      classTimestamps: {},
      configured: false,
      latestGeneratedAt: null,
      retentionCandidates: 0,
    };
  }

  const anomalyCounts: BackupReadinessObservation['anomalyCounts'] = {};
  const entries = await options.source.list();
  if (entries.length > MAX_INVENTORY_ENTRIES) {
    throw new Error('backup_inventory_too_large');
  }
  const byKey = new Map<string, BackupObjectEntry>();
  for (const entry of entries) {
    if (
      byKey.has(entry.key) ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes <= 0
    ) {
      increment(
        anomalyCounts,
        entry.sizeBytes <= 0 ? 'zero_size' : 'duplicate_object',
      );
    }
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
  }

  const manifests = entries.filter((entry) =>
    entry.key.endsWith('.manifest.json'),
  );
  const artifacts = entries.filter(
    (entry) => !entry.key.endsWith('.manifest.json'),
  );
  const artifactKeys = new Set(artifacts.map((entry) => entry.key));
  const pairedArtifacts = new Set<string>();
  const generations = new Map<string, Generation>();

  for (const manifestEntry of manifests) {
    const artifactKey = manifestEntry.key.slice(0, -'.manifest.json'.length);
    const artifactEntry = byKey.get(artifactKey);
    if (!artifactEntry) {
      increment(anomalyCounts, 'orphan_pair');
      continue;
    }
    pairedArtifacts.add(artifactKey);
    const segments = artifactKey.split('/');
    const artifactName = segments[segments.length - 1] ?? '';
    if (!SAFE_FILENAME.test(artifactName)) {
      increment(anomalyCounts, 'invalid_manifest');
      continue;
    }
    let raw: unknown;
    try {
      raw = await options.source.readManifest(manifestEntry.key);
    } catch {
      increment(anomalyCounts, 'invalid_manifest');
      continue;
    }
    const manifest = parseManifest(
      raw,
      artifactKey,
      options.expectedEnvironment,
      options.requireOpenPgp,
    );
    if (!manifest) {
      increment(anomalyCounts, 'invalid_manifest');
      continue;
    }
    let stat: Awaited<ReturnType<BackupObjectSource['statArtifact']>>;
    try {
      stat = await options.source.statArtifact(artifactKey);
    } catch {
      increment(anomalyCounts, 'checksum_mismatch');
      continue;
    }
    if (
      artifactEntry.sizeBytes !== manifest.artifact.sizeBytes ||
      stat.sizeBytes !== manifest.artifact.sizeBytes ||
      stat.sha256 !== manifest.artifact.sha256
    ) {
      increment(anomalyCounts, 'checksum_mismatch');
      continue;
    }

    const generation = generations.get(manifest.backupId) ?? {
      generatedAt: manifest.generatedAt,
      retentionClass: manifest.retentionClass,
      types: new Set<string>(),
      valid: true,
    };
    if (
      generation.generatedAt !== manifest.generatedAt ||
      generation.retentionClass !== manifest.retentionClass ||
      generation.types.has(manifest.artifact.type)
    ) {
      generation.valid = false;
      increment(anomalyCounts, 'duplicate_object');
    }
    generation.types.add(manifest.artifact.type);
    generations.set(manifest.backupId, generation);
  }

  for (const artifactKey of artifactKeys) {
    if (!pairedArtifacts.has(artifactKey))
      increment(anomalyCounts, 'orphan_pair');
  }

  for (const generation of generations.values()) {
    if (REQUIRED_TYPES.some((type) => !generation.types.has(type))) {
      generation.valid = false;
      increment(anomalyCounts, 'generation_incomplete');
    }
  }

  const valid = [...generations.values()].filter(
    (generation) => generation.valid,
  );
  const classCounts: BackupReadinessObservation['classCounts'] = {};
  const classTimestamps: BackupReadinessObservation['classTimestamps'] = {};
  for (const retentionClass of BACKUP_RETENTION_CLASSES) {
    const timestamps = valid
      .filter((generation) => generation.retentionClass === retentionClass)
      .map((generation) => generation.generatedAt)
      .sort();
    classCounts[retentionClass] = timestamps.length;
    classTimestamps[retentionClass] = {
      latestGeneratedAt: timestamps[timestamps.length - 1] ?? null,
      oldestGeneratedAt: timestamps[0] ?? null,
    };
  }
  const latestGeneratedAt =
    classTimestamps[options.policy.freshnessClass]?.latestGeneratedAt ?? null;

  return {
    anomalyCounts,
    classCounts,
    classTimestamps,
    configured: true,
    latestGeneratedAt,
    retentionCandidates: countRetentionCandidates(
      valid,
      options.policy,
      options.now,
    ),
  };
}
