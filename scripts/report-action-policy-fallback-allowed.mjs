import { pathToFileURL } from 'node:url';

const DEFAULT_TAKE = 1000;

function parseArgValue(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
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

export function parseOptionsFromArgv(argv, now = new Date()) {
  const toRaw = parseArgValue(argv, 'to');
  const to = toRaw ? parseIsoDate('to', toRaw) : now;
  const fromRaw = parseArgValue(argv, 'from');
  const from = fromRaw
    ? parseIsoDate('from', fromRaw)
    : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (from.getTime() >= to.getTime()) {
    throw new Error('from must be earlier than to');
  }
  return {
    from,
    to,
    format: parseFormat(parseArgValue(argv, 'format')),
    take: parsePositiveInteger('take', parseArgValue(argv, 'take'), DEFAULT_TAKE),
  };
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function asString(value, fallback = 'unknown') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function resolveKeyParts(row) {
  const metadata = asRecord(row.metadata);
  const flowType = asString(metadata.flowType);
  const actionKey = asString(metadata.actionKey);
  const targetTable = asString(metadata.targetTable, asString(row.targetTable));
  return { flowType, actionKey, targetTable };
}

export function aggregateRows(rows) {
  const keys = new Map();
  for (const row of rows) {
    const { flowType, actionKey, targetTable } = resolveKeyParts(row);
    const key = `${flowType}:${actionKey}:${targetTable}`;
    const current = keys.get(key) || {
      flowType,
      actionKey,
      targetTable,
      count: 0,
      firstSeen: row.createdAt,
      lastSeen: row.createdAt,
      sampleTargetId: row.targetId || null,
    };
    current.count += 1;
    if (row.createdAt < current.firstSeen) current.firstSeen = row.createdAt;
    if (row.createdAt > current.lastSeen) current.lastSeen = row.createdAt;
    if (!current.sampleTargetId && row.targetId) {
      current.sampleTargetId = row.targetId;
    }
    keys.set(key, current);
  }

  const keyItems = Array.from(keys.values())
    .map((item) => ({
      ...item,
      firstSeen: item.firstSeen.toISOString(),
      lastSeen: item.lastSeen.toISOString(),
    }))
    .sort((left, right) => {
      if (left.flowType !== right.flowType) {
        return left.flowType.localeCompare(right.flowType);
      }
      if (left.actionKey !== right.actionKey) {
        return left.actionKey.localeCompare(right.actionKey);
      }
      return left.targetTable.localeCompare(right.targetTable);
    });

  return {
    totals: {
      events: rows.length,
      uniqueKeys: keyItems.length,
    },
    keys: keyItems,
  };
}

function cursorWhere(baseWhere, lastCreatedAt, lastId) {
  if (!lastCreatedAt || !lastId) return baseWhere;
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

async function loadRows(prisma, options) {
  const rows = [];
  const baseWhere = {
    action: 'action_policy_fallback_allowed',
    createdAt: {
      gte: options.from,
      lt: options.to,
    },
  };

  let lastCreatedAt;
  let lastId;
  for (;;) {
    const page = await prisma.auditLog.findMany({
      where: cursorWhere(baseWhere, lastCreatedAt, lastId),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: options.take,
      select: {
        id: true,
        createdAt: true,
        targetTable: true,
        targetId: true,
        metadata: true,
      },
    });

    if (!page.length) break;
    rows.push(...page);
    const last = page[page.length - 1];
    lastCreatedAt = last.createdAt;
    lastId = last.id;
    if (page.length < options.take) break;
  }

  return rows;
}

function renderText(result, options) {
  const lines = [];
  lines.push('action_policy_fallback_allowed report');
  lines.push(`from: ${options.from.toISOString()}`);
  lines.push(`to: ${options.to.toISOString()}`);
  lines.push(`events: ${result.totals.events}`);
  lines.push(`unique_keys: ${result.totals.uniqueKeys}`);
  lines.push('');
  lines.push('flowType,actionKey,targetTable,count,firstSeen,lastSeen,sampleTargetId');
  for (const row of result.keys) {
    lines.push(
      [
        row.flowType,
        row.actionKey,
        row.targetTable,
        row.count,
        row.firstSeen,
        row.lastSeen,
        row.sampleTargetId || '',
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function run() {
  const options = parseOptionsFromArgv(process.argv.slice(2));

  let prisma;
  try {
    ({ prisma } = await import('../packages/backend/dist/services/db.js'));
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined;
    console.error(
      '[report-action-policy-fallback-allowed] failed to import backend Prisma client',
    );
    if (code === 'ERR_MODULE_NOT_FOUND') {
      console.error('Run `npm run build --prefix packages/backend` before this script.');
    } else {
      console.error(
        'Ensure backend build artifacts and required environment variables (for example, DATABASE_URL) are available.',
      );
    }
    throw err;
  }

  try {
    const rows = await loadRows(prisma, options);
    const result = aggregateRows(rows);

    if (options.format === 'json') {
      process.stdout.write(
        `${JSON.stringify(
          {
            from: options.from.toISOString(),
            to: options.to.toISOString(),
            ...result,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderText(result, options));
  } finally {
    await prisma.$disconnect();
  }
}

const runAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  run().catch((err) => {
    console.error('[report-action-policy-fallback-allowed] failed', err);
    process.exit(1);
  });
}
