let prisma;
try {
  ({ prisma } = await import('../packages/backend/dist/services/db.js'));
} catch (err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  console.error(
    '[report-chat-attachments-av-metrics] failed to import backend Prisma client',
  );
  if (code === 'ERR_MODULE_NOT_FOUND') {
    console.error(
      'Run `npm run build --prefix packages/backend` before this script.',
    );
  } else {
    console.error(
      'Ensure backend build artifacts and required environment variables (for example, DATABASE_URL) are available.',
    );
  }
  throw err;
}

const ACTION_UPLOADED = 'chat_attachment_uploaded';
const ACTION_BLOCKED = 'chat_attachment_blocked';
const ACTION_SCAN_FAILED = 'chat_attachment_scan_failed';

const DEFAULT_THRESHOLD_SCAN_FAILED_COUNT = 5;
const DEFAULT_THRESHOLD_SCAN_FAILED_RATE_PCT = 1;
const DEFAULT_THRESHOLD_SCAN_P95_MS = 5000;

function parseArgValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function parseIsoDate(name, value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be a valid ISO-8601 date-time`);
  }
  return parsed;
}

function parseWindowMinutes(raw) {
  if (!raw) return 10;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('window-minutes must be a positive number');
  }
  return Math.max(1, Math.floor(parsed));
}

function parseFormat(raw) {
  if (!raw) return 'text';
  if (raw === 'text' || raw === 'json') return raw;
  throw new Error('format must be text or json');
}

function parsePositiveInteger(name, raw, fallback) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(name, raw, fallback) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function parsePercentage(name, raw, fallback) {
  const value = parseNonNegativeNumber(name, raw, fallback);
  if (value > 100) {
    throw new Error(`${name} must be between 0 and 100`);
  }
  return value;
}

function parseOptions() {
  const now = new Date();
  const toRaw = parseArgValue('to');
  const to = toRaw ? parseIsoDate('to', toRaw) : now;
  const fromRaw = parseArgValue('from');
  const from = fromRaw
    ? parseIsoDate('from', fromRaw)
    : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (from.getTime() >= to.getTime()) {
    throw new Error('from must be earlier than to');
  }
  return {
    from,
    to,
    windowMinutes: parseWindowMinutes(parseArgValue('window-minutes')),
    format: parseFormat(parseArgValue('format')),
    thresholds: {
      scanFailedCount: parsePositiveInteger(
        'threshold-scan-failed-count',
        parseArgValue('threshold-scan-failed-count'),
        DEFAULT_THRESHOLD_SCAN_FAILED_COUNT,
      ),
      scanFailedRatePct: parsePercentage(
        'threshold-scan-failed-rate-pct',
        parseArgValue('threshold-scan-failed-rate-pct'),
        DEFAULT_THRESHOLD_SCAN_FAILED_RATE_PCT,
      ),
      scanP95Ms: parseNonNegativeNumber(
        'threshold-scan-p95-ms',
        parseArgValue('threshold-scan-p95-ms'),
        DEFAULT_THRESHOLD_SCAN_P95_MS,
      ),
    },
  };
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function asString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function resolveProvider(action, metadata) {
  if (action === ACTION_UPLOADED) {
    return asString(metadata.scanProvider) || 'unknown';
  }
  return asString(metadata.provider) || 'unknown';
}

function resolveDurationMs(metadata) {
  const duration = asNumber(metadata.scanDurationMs);
  if (duration === null || duration < 0) return null;
  return duration;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index] ?? null;
}

function toPercent(numerator, denominator) {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function formatFixed(value) {
  if (value === null) return '-';
  return Number(value).toFixed(2);
}

function toAuditLogCursorWhere(baseWhere, lastCreatedAt, lastId) {
  if (!lastCreatedAt || !lastId) {
    return baseWhere;
  }
  return {
    AND: [
      baseWhere,
      {
        OR: [
          { createdAt: { gt: lastCreatedAt } },
          { createdAt: lastCreatedAt, id: { gt: lastId } },
        ],
      },
    ],
  };
}

function collectDurationSamples(windowDurations) {
  const values = [];
  for (const samples of windowDurations.values()) {
    values.push(...samples);
  }
  return values;
}

function accumulateRow(row, context) {
  const {
    windowMs,
    providerStats,
    errorCounts,
    windows,
    windowDurations,
    counters,
  } = context;
  const metadata = asRecord(row.metadata);
  const provider = resolveProvider(row.action, metadata);
  const providerEntry = providerStats.get(provider) || {
    total: 0,
    uploaded: 0,
    blocked: 0,
    scanFailed: 0,
  };
  providerEntry.total += 1;

  const bucketStart = Math.floor(row.createdAt.getTime() / windowMs) * windowMs;
  const windowEntry = windows.get(bucketStart) || {
    attempts: 0,
    uploaded: 0,
    blocked: 0,
    scanFailed: 0,
  };
  windowEntry.attempts += 1;

  if (row.action === ACTION_UPLOADED) {
    counters.uploaded += 1;
    providerEntry.uploaded += 1;
    windowEntry.uploaded += 1;
  } else if (row.action === ACTION_BLOCKED) {
    counters.blocked += 1;
    providerEntry.blocked += 1;
    windowEntry.blocked += 1;
  } else if (row.action === ACTION_SCAN_FAILED) {
    counters.scanFailed += 1;
    providerEntry.scanFailed += 1;
    windowEntry.scanFailed += 1;
    const error = asString(metadata.error) || 'unknown';
    errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
  }

  const scanDurationMs = resolveDurationMs(metadata);
  if (scanDurationMs !== null) {
    const perWindowDurations = windowDurations.get(bucketStart) || [];
    perWindowDurations.push(scanDurationMs);
    windowDurations.set(bucketStart, perWindowDurations);
  }

  providerStats.set(provider, providerEntry);
  windows.set(bucketStart, windowEntry);
}

async function main() {
  const options = parseOptions();
  const windowMs = options.windowMinutes * 60 * 1000;

  const providerStats = new Map();
  const errorCounts = new Map();
  const windows = new Map();
  const windowDurations = new Map();

  const counters = {
    uploaded: 0,
    blocked: 0,
    scanFailed: 0,
  };

  const baseWhere = {
    createdAt: { gte: options.from, lt: options.to },
    action: {
      in: [ACTION_UPLOADED, ACTION_BLOCKED, ACTION_SCAN_FAILED],
    },
  };
  const BATCH_SIZE = 1000;
  let lastCreatedAt = null;
  let lastId = null;

  while (true) {
    const where = toAuditLogCursorWhere(baseWhere, lastCreatedAt, lastId);
    const rows = await prisma.auditLog.findMany({
      where,
      select: { id: true, action: true, createdAt: true, metadata: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
    });
    if (!rows.length) break;

    for (const row of rows) {
      accumulateRow(row, {
        windowMs,
        providerStats,
        errorCounts,
        windows,
        windowDurations,
        counters,
      });
    }

    const tail = rows[rows.length - 1];
    lastCreatedAt = tail.createdAt;
    lastId = tail.id;
  }

  const uploaded = counters.uploaded;
  const blocked = counters.blocked;
  const scanFailed = counters.scanFailed;
  const attempts = uploaded + blocked + scanFailed;
  const blockedRatePct = toPercent(blocked, attempts);
  const scanFailedRatePct = toPercent(scanFailed, attempts);

  const providerSummary = [...providerStats.entries()]
    .map(([provider, stat]) => ({
      provider,
      ...stat,
      scanFailedRatePct: toPercent(stat.scanFailed, stat.total),
    }))
    .sort((a, b) => b.total - a.total || a.provider.localeCompare(b.provider));

  const errorSummary = [...errorCounts.entries()]
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count || a.error.localeCompare(b.error));

  const windowSummary = [...windows.entries()]
    .map(([startMs, stat]) => ({
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + windowMs).toISOString(),
      ...stat,
      scanFailedRatePct: toPercent(stat.scanFailed, stat.attempts),
      p95Ms: percentile(windowDurations.get(startMs) || [], 0.95),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const violatedByCount = windowSummary.filter(
    (window) => window.scanFailed >= options.thresholds.scanFailedCount,
  );
  const violatedByRate = windowSummary.filter(
    (window) => window.scanFailedRatePct > options.thresholds.scanFailedRatePct,
  );
  const violatedByP95 = windowSummary.filter(
    (window) =>
      window.p95Ms !== null && window.p95Ms > options.thresholds.scanP95Ms,
  );

  const latestWindowStart =
    Math.floor((options.to.getTime() - 1) / windowMs) * windowMs;
  const latestWindowKey = new Date(latestWindowStart).toISOString();
  const latestWindow =
    windowSummary.find((window) => window.start === latestWindowKey) || null;
  const durationSamples = collectDurationSamples(windowDurations);

  const result = {
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    windowMinutes: options.windowMinutes,
    totals: {
      attempts,
      uploaded,
      blocked,
      scanFailed,
      blockedRatePct,
      scanFailedRatePct,
    },
    scanDurationMs: {
      sampleCount: durationSamples.length,
      p50: percentile(durationSamples, 0.5),
      p95: percentile(durationSamples, 0.95),
      max: durationSamples.length ? Math.max(...durationSamples) : null,
    },
    providers: providerSummary,
    scanFailedErrors: errorSummary,
    windows: {
      count: windowSummary.length,
      latest: latestWindow,
      violatedByScanFailedCount: violatedByCount,
      violatedByScanFailedRate: violatedByRate,
      violatedByScanDurationP95: violatedByP95,
      thresholds: {
        scanFailedCount: options.thresholds.scanFailedCount,
        scanFailedRatePct: options.thresholds.scanFailedRatePct,
        scanP95Ms: options.thresholds.scanP95Ms,
      },
    },
  };

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('# chat attachment av metrics');
  console.log(`window: ${options.from.toISOString()} .. ${options.to.toISOString()}`);
  console.log(`windowMinutes: ${options.windowMinutes}`);
  console.log(
    `totals: attempts=${attempts} uploaded=${uploaded} blocked=${blocked} scanFailed=${scanFailed}`,
  );
  console.log(
    `rates: blocked=${formatFixed(blockedRatePct)}% scanFailed=${formatFixed(scanFailedRatePct)}%`,
  );
  console.log(
    `scanDurationMs: samples=${durationSamples.length} p50=${formatFixed(result.scanDurationMs.p50)} p95=${formatFixed(result.scanDurationMs.p95)} max=${formatFixed(result.scanDurationMs.max)}`,
  );
  console.log('providers:');
  if (!providerSummary.length) {
    console.log('  - none');
  } else {
    for (const provider of providerSummary) {
      console.log(
        `  - ${provider.provider}: total=${provider.total} uploaded=${provider.uploaded} blocked=${provider.blocked} scanFailed=${provider.scanFailed} failedRate=${formatFixed(provider.scanFailedRatePct)}%`,
      );
    }
  }
  console.log('scanFailed errors:');
  if (!errorSummary.length) {
    console.log('  - none');
  } else {
    for (const error of errorSummary) {
      console.log(`  - ${error.error}: ${error.count}`);
    }
  }
  console.log(
    `threshold violations: scanFailed>=${options.thresholds.scanFailedCount} => ${violatedByCount.length}, scanFailedRate>${options.thresholds.scanFailedRatePct}% => ${violatedByRate.length}, scanP95>${options.thresholds.scanP95Ms}ms => ${violatedByP95.length}`,
  );
  if (latestWindow) {
    console.log(
      `latestWindow: ${latestWindow.start} attempts=${latestWindow.attempts} scanFailed=${latestWindow.scanFailed} scanFailedRate=${formatFixed(latestWindow.scanFailedRatePct)}% scanP95=${formatFixed(latestWindow.p95Ms)}ms`,
    );
  } else {
    console.log('latestWindow: none');
  }
}

main()
  .catch((err) => {
    console.error('[report-chat-attachments-av-metrics] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
