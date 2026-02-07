let prisma;
try {
  ({ prisma } = await import('../packages/backend/dist/services/db.js'));
} catch (err) {
  console.error(
    '[report-chat-attachments-av-metrics] failed to import backend Prisma client',
  );
  console.error(
    'Run `npm run build --prefix packages/backend` before this script.',
  );
  throw err;
}

const ACTION_UPLOADED = 'chat_attachment_uploaded';
const ACTION_BLOCKED = 'chat_attachment_blocked';
const ACTION_SCAN_FAILED = 'chat_attachment_scan_failed';

const ALERT_SCAN_FAILED_COUNT = 5;
const ALERT_SCAN_FAILED_RATE = 0.01;

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

async function main() {
  const options = parseOptions();
  const windowMs = options.windowMinutes * 60 * 1000;
  const rows = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: options.from, lt: options.to },
      action: {
        in: [ACTION_UPLOADED, ACTION_BLOCKED, ACTION_SCAN_FAILED],
      },
    },
    select: { action: true, createdAt: true, metadata: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const providerStats = new Map();
  const errorCounts = new Map();
  const durationSamples = [];
  const windows = new Map();

  let uploaded = 0;
  let blocked = 0;
  let scanFailed = 0;

  for (const row of rows) {
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
      uploaded += 1;
      providerEntry.uploaded += 1;
      windowEntry.uploaded += 1;
    } else if (row.action === ACTION_BLOCKED) {
      blocked += 1;
      providerEntry.blocked += 1;
      windowEntry.blocked += 1;
    } else if (row.action === ACTION_SCAN_FAILED) {
      scanFailed += 1;
      providerEntry.scanFailed += 1;
      windowEntry.scanFailed += 1;
      const error = asString(metadata.error) || 'unknown';
      errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
    }

    const scanDurationMs = resolveDurationMs(metadata);
    if (scanDurationMs !== null) {
      durationSamples.push(scanDurationMs);
    }

    providerStats.set(provider, providerEntry);
    windows.set(bucketStart, windowEntry);
  }

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
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const violatedByCount = windowSummary.filter(
    (window) => window.scanFailed >= ALERT_SCAN_FAILED_COUNT,
  );
  const violatedByRate = windowSummary.filter(
    (window) => window.scanFailedRatePct / 100 > ALERT_SCAN_FAILED_RATE,
  );

  const latestWindowStart =
    Math.floor((options.to.getTime() - 1) / windowMs) * windowMs;
  const latestWindowKey = new Date(latestWindowStart).toISOString();
  const latestWindow =
    windowSummary.find((window) => window.start === latestWindowKey) || null;

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
      thresholds: {
        scanFailedCount: ALERT_SCAN_FAILED_COUNT,
        scanFailedRatePct: ALERT_SCAN_FAILED_RATE * 100,
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
    `threshold violations: scanFailed>=${ALERT_SCAN_FAILED_COUNT} => ${violatedByCount.length}, scanFailedRate>${ALERT_SCAN_FAILED_RATE * 100}% => ${violatedByRate.length}`,
  );
  if (latestWindow) {
    console.log(
      `latestWindow: ${latestWindow.start} attempts=${latestWindow.attempts} scanFailed=${latestWindow.scanFailed} scanFailedRate=${formatFixed(latestWindow.scanFailedRatePct)}%`,
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
