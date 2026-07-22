export const STORAGE_READINESS_COMPONENTS = [
  'app_gdrive_chat',
  'app_gdrive_pdf',
  'app_gdrive_evidence',
  'app_gdrive_report',
  'backup_local',
  'backup_sakura_primary',
  'backup_gdrive_secondary',
  'restore_evidence',
] as const;

export type StorageReadinessComponentName =
  (typeof STORAGE_READINESS_COMPONENTS)[number];
export type StorageReadinessStatus =
  'pass' | 'warn' | 'fail' | 'unknown' | 'not_configured';
export type StorageReadinessMetric = boolean | number | string | null;

export type StorageReadinessComponent = {
  component: StorageReadinessComponentName;
  metrics: Record<string, StorageReadinessMetric>;
  reasons: string[];
  status: StorageReadinessStatus;
};

export type StorageReadinessReport = {
  components: StorageReadinessComponent[];
  event: 'erp4.storage_readiness';
  generatedAt: string;
  mode: 'read' | 'write_probe';
  overall: {
    exitCode: 0 | 1 | 2 | 3;
    reasons: string[];
    status: StorageReadinessStatus;
  };
  schemaVersion: 'erp4.storage.readiness.v1';
};

export type DriveReadinessObservation = {
  configured: boolean;
  errorCode?:
    | 'auth_expired'
    | 'forbidden'
    | 'not_found'
    | 'quota'
    | 'retryable'
    | 'permanent'
    | 'timeout'
    | 'configuration_invalid';
  folderAccessible?: boolean;
  permissionEntries?: number;
  quota?: { state: 'available'; usagePercent: number } | { state: 'unknown' };
  writeProbe?: 'not_requested' | 'trashed';
};

export const BACKUP_RETENTION_CLASSES = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
] as const;
export type BackupRetentionClass = (typeof BACKUP_RETENTION_CLASSES)[number];

export type BackupReadinessObservation = {
  anomalyCounts: Partial<
    Record<
      | 'checksum_mismatch'
      | 'duplicate_object'
      | 'generation_incomplete'
      | 'invalid_manifest'
      | 'orphan_pair'
      | 'zero_size',
      number
    >
  >;
  classCounts: Partial<Record<BackupRetentionClass, number>>;
  classTimestamps: Partial<
    Record<
      BackupRetentionClass,
      { latestGeneratedAt: string | null; oldestGeneratedAt: string | null }
    >
  >;
  configured: boolean;
  errorCode?:
    | 'auth_expired'
    | 'forbidden'
    | 'not_found'
    | 'quota'
    | 'retryable'
    | 'permanent'
    | 'timeout'
    | 'configuration_invalid'
    | 'inventory_unavailable';
  latestGeneratedAt: string | null;
  retentionCandidates: number;
};

export type BackupReadinessPolicy = {
  freshnessClass: Extract<BackupRetentionClass, 'hourly' | 'daily'>;
  maxAgeMs: number;
  minimums: Partial<Record<BackupRetentionClass, number>>;
};

export type RestoreEvidenceObservation = {
  backupIdMatches?: boolean;
  completedAt?: string;
  configured: boolean;
  environmentMatches?: boolean;
  errorCode?:
    'configuration_invalid' | 'evidence_invalid' | 'evidence_unreadable';
  result?: 'pass' | 'fail' | 'blocked';
};

const TRANSIENT_ERROR_CODES = new Set(['quota', 'retryable', 'timeout']);

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort();
}

function errorStatus(code: string): StorageReadinessStatus {
  return TRANSIENT_ERROR_CODES.has(code) ? 'unknown' : 'fail';
}

export function assessDriveReadiness(
  component: Extract<StorageReadinessComponentName, `app_gdrive_${string}`>,
  observation: DriveReadinessObservation,
  thresholds: { criticalPercent: number; warningPercent: number },
): StorageReadinessComponent {
  if (!observation.configured) {
    return {
      component,
      metrics: {},
      reasons: ['provider_not_configured'],
      status: 'not_configured',
    };
  }
  if (observation.errorCode) {
    return {
      component,
      metrics: {},
      reasons: [`drive_${observation.errorCode}`],
      status: errorStatus(observation.errorCode),
    };
  }

  const metrics: Record<string, StorageReadinessMetric> = {
    folderAccessible: observation.folderAccessible === true,
    permissionEntries: observation.permissionEntries ?? 0,
    writeProbe: observation.writeProbe ?? 'not_requested',
  };
  if (observation.folderAccessible !== true) {
    return {
      component,
      metrics,
      reasons: ['drive_folder_unavailable'],
      status: 'fail',
    };
  }
  if (observation.quota?.state !== 'available') {
    return {
      component,
      metrics: { ...metrics, quota: 'unknown' },
      reasons: ['drive_quota_unknown'],
      status: 'unknown',
    };
  }

  metrics.quota = 'available';
  metrics.usagePercent = observation.quota.usagePercent;
  if (observation.quota.usagePercent >= thresholds.criticalPercent) {
    return {
      component,
      metrics,
      reasons: ['drive_quota_critical'],
      status: 'fail',
    };
  }
  if (observation.quota.usagePercent >= thresholds.warningPercent) {
    return {
      component,
      metrics,
      reasons: ['drive_quota_warning'],
      status: 'warn',
    };
  }
  return { component, metrics, reasons: [], status: 'pass' };
}

function canonicalUtc(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? parsed
    : null;
}

export function assessBackupReadiness(
  component: Extract<StorageReadinessComponentName, `backup_${string}`>,
  observation: BackupReadinessObservation,
  policy: BackupReadinessPolicy,
  now: Date,
): StorageReadinessComponent {
  if (!observation.configured) {
    return {
      component,
      metrics: {},
      reasons: ['provider_not_configured'],
      status: 'not_configured',
    };
  }
  if (observation.errorCode) {
    return {
      component,
      metrics: {},
      reasons: [`backup_${observation.errorCode}`],
      status: errorStatus(observation.errorCode),
    };
  }

  const reasons: string[] = [];
  const latest = observation.latestGeneratedAt
    ? canonicalUtc(observation.latestGeneratedAt)
    : null;
  if (!latest) reasons.push('backup_latest_missing_or_invalid');
  else if (latest.getTime() > now.getTime()) reasons.push('backup_time_future');
  else if (now.getTime() - latest.getTime() > policy.maxAgeMs) {
    reasons.push('backup_freshness_exceeded');
  }

  for (const [name, count] of Object.entries(observation.anomalyCounts)) {
    if ((count ?? 0) > 0) reasons.push(`backup_${name}`);
  }
  for (const retentionClass of BACKUP_RETENTION_CLASSES) {
    const minimum = policy.minimums[retentionClass];
    if (
      minimum !== undefined &&
      (observation.classCounts[retentionClass] ?? 0) < minimum
    ) {
      reasons.push(`retention_${retentionClass}_insufficient`);
    }
    const timestamps = observation.classTimestamps[retentionClass];
    const oldest = timestamps?.oldestGeneratedAt
      ? canonicalUtc(timestamps.oldestGeneratedAt)
      : null;
    const newest = timestamps?.latestGeneratedAt
      ? canonicalUtc(timestamps.latestGeneratedAt)
      : null;
    if (
      (timestamps?.oldestGeneratedAt && !oldest) ||
      (timestamps?.latestGeneratedAt && !newest)
    ) {
      reasons.push('backup_latest_missing_or_invalid');
    }
    if (
      (oldest && oldest.getTime() > now.getTime()) ||
      (newest && newest.getTime() > now.getTime())
    ) {
      reasons.push('backup_time_future');
    }
  }

  const metrics: Record<string, StorageReadinessMetric> = {
    latestGeneratedAt: latest?.toISOString() ?? null,
    retentionCandidates: observation.retentionCandidates,
  };
  for (const retentionClass of BACKUP_RETENTION_CLASSES) {
    const minimum = policy.minimums[retentionClass];
    if (minimum === undefined) continue;
    metrics[`${retentionClass}Generations`] =
      observation.classCounts[retentionClass] ?? 0;
    metrics[`${retentionClass}Minimum`] = minimum;
    const timestamps = observation.classTimestamps[retentionClass];
    metrics[`${retentionClass}OldestGeneratedAt`] =
      timestamps?.oldestGeneratedAt ?? null;
    metrics[`${retentionClass}LatestGeneratedAt`] =
      timestamps?.latestGeneratedAt ?? null;
  }
  return {
    component,
    metrics,
    reasons: sortedUnique(reasons),
    status: reasons.length > 0 ? 'fail' : 'pass',
  };
}

export function assessRestoreEvidence(
  observation: RestoreEvidenceObservation,
  maxAgeMs: number,
  now: Date,
): StorageReadinessComponent {
  const component = 'restore_evidence' as const;
  if (!observation.configured) {
    return {
      component,
      metrics: {},
      reasons: ['restore_evidence_not_configured'],
      status: 'not_configured',
    };
  }
  if (observation.errorCode) {
    return {
      component,
      metrics: {},
      reasons: [`restore_${observation.errorCode}`],
      status: 'fail',
    };
  }

  const reasons: string[] = [];
  const completed = observation.completedAt
    ? canonicalUtc(observation.completedAt)
    : null;
  if (!completed) reasons.push('restore_time_invalid');
  else if (completed.getTime() > now.getTime())
    reasons.push('restore_time_future');
  else if (now.getTime() - completed.getTime() > maxAgeMs) {
    reasons.push('restore_freshness_exceeded');
  }
  if (observation.result !== 'pass') reasons.push('restore_result_not_pass');
  if (observation.environmentMatches !== true) {
    reasons.push('restore_environment_mismatch');
  }
  if (observation.backupIdMatches !== true) {
    reasons.push('restore_backup_id_mismatch');
  }
  return {
    component,
    metrics: { completedAt: completed?.toISOString() ?? null },
    reasons: sortedUnique(reasons),
    status: reasons.length > 0 ? 'fail' : 'pass',
  };
}

function overallStatus(components: StorageReadinessComponent[]) {
  if (components.some((item) => item.status === 'fail')) return 'fail' as const;
  if (components.some((item) => item.status === 'unknown')) {
    return 'unknown' as const;
  }
  if (components.some((item) => item.status === 'not_configured')) {
    return components.every((item) => item.status === 'not_configured')
      ? ('not_configured' as const)
      : ('unknown' as const);
  }
  if (components.some((item) => item.status === 'warn')) return 'warn' as const;
  return 'pass' as const;
}

function exitCode(status: StorageReadinessStatus): 0 | 1 | 2 | 3 {
  if (status === 'pass') return 0;
  if (status === 'warn') return 1;
  if (status === 'fail') return 2;
  return 3;
}

export function buildStorageReadinessReport(options: {
  components: StorageReadinessComponent[];
  generatedAt: Date;
  mode: StorageReadinessReport['mode'];
}): StorageReadinessReport {
  const byName = new Map(
    options.components.map((component) => [component.component, component]),
  );
  if (options.components.length !== STORAGE_READINESS_COMPONENTS.length) {
    throw new Error('storage_readiness_component_duplicate_or_unknown');
  }
  const components = STORAGE_READINESS_COMPONENTS.map((component) => {
    const result = byName.get(component);
    if (!result) throw new Error('storage_readiness_component_missing');
    return result;
  });
  if (byName.size !== STORAGE_READINESS_COMPONENTS.length) {
    throw new Error('storage_readiness_component_duplicate_or_unknown');
  }
  const status = overallStatus(components);
  const primary = components.find(
    (item) => item.component === 'backup_sakura_primary',
  );
  const secondary = components.find(
    (item) => item.component === 'backup_gdrive_secondary',
  );
  const reasons =
    primary &&
    secondary &&
    (primary.status === 'pass') !== (secondary.status === 'pass')
      ? ['backup_partial_failure']
      : [];
  return {
    schemaVersion: 'erp4.storage.readiness.v1',
    event: 'erp4.storage_readiness',
    generatedAt: options.generatedAt.toISOString(),
    mode: options.mode,
    overall: { status, exitCode: exitCode(status), reasons },
    components,
  };
}

function markdownValue(value: StorageReadinessMetric) {
  return String(value).replace(/[`|\r\n]/g, '_');
}

export function renderStorageReadinessMarkdown(report: StorageReadinessReport) {
  const lines = [
    '# ERP4 storage readiness',
    '',
    `- Schema: \`${report.schemaVersion}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Mode: \`${report.mode}\``,
    `- Overall: \`${report.overall.status}\``,
    `- Exit code: \`${report.overall.exitCode}\``,
    `- Overall reasons: ${report.overall.reasons.map((reason) => `\`${reason}\``).join(', ') || '-'}`,
    '',
    '| Component | Status | Reasons | Metrics |',
    '| --- | --- | --- | --- |',
  ];
  for (const component of report.components) {
    const metrics = Object.entries(component.metrics)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${markdownValue(value)}`)
      .join(', ');
    lines.push(
      `| ${component.component} | ${component.status} | ${component.reasons.join(', ') || '-'} | ${metrics || '-'} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
