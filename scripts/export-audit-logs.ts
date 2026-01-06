import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../packages/backend/src/services/db.js';
import { toCsv } from '../packages/backend/src/utils/csv.js';

type ExportOptions = {
  date: string;
  outputDir: string;
  prevHash?: string;
};

function parseArgValue(key: string): string | undefined {
  const prefix = `--${key}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function requireDate(input?: string): string {
  if (!input) {
    const now = new Date();
    const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const yesterday = new Date(utc - 24 * 60 * 60 * 1000);
    return yesterday.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  return input;
}

function resolveRange(date: string): { from: Date; to: Date } {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const from = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const to = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { from, to };
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resolvePrevHash(
  outputDir: string,
  date: string,
  explicit?: string,
): string | null {
  if (explicit) return explicit;
  const current = new Date(`${date}T00:00:00.000Z`);
  const prev = new Date(current.getTime() - 24 * 60 * 60 * 1000);
  const prevDate = prev.toISOString().slice(0, 10);
  const prevPath = path.join(outputDir, `audit-logs-${prevDate}.sha256.json`);
  if (!fs.existsSync(prevPath)) return null;
  try {
    const raw = fs.readFileSync(prevPath, 'utf8');
    const parsed = JSON.parse(raw) as { chainHash?: string };
    return parsed.chainHash ?? null;
  } catch {
    return null;
  }
}

async function runExport(options: ExportOptions) {
  const { from, to } = resolveRange(options.date);
  const items = (await prisma.auditLog.findMany({
    where: { createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'asc' },
  })) as Array<Record<string, any>>;
  const rows = items.map((item) => [
    item.id,
    item.action,
    item.userId || '',
    item.actorRole || '',
    item.actorGroupId || '',
    item.requestId || '',
    item.ipAddress || '',
    item.userAgent || '',
    item.source || '',
    item.reasonCode || '',
    item.reasonText || '',
    item.targetTable || '',
    item.targetId || '',
    item.createdAt.toISOString(),
    item.metadata ? JSON.stringify(item.metadata) : '',
  ]);
  const headers = [
    'id',
    'action',
    'userId',
    'actorRole',
    'actorGroupId',
    'requestId',
    'ipAddress',
    'userAgent',
    'source',
    'reasonCode',
    'reasonText',
    'targetTable',
    'targetId',
    'createdAt',
    'metadata',
  ];
  const csvContent = toCsv(headers, rows);
  const outputDir = options.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const csvName = `audit-logs-${options.date}.csv`;
  const jsonName = `audit-logs-${options.date}.json`;
  const hashName = `audit-logs-${options.date}.sha256.json`;
  const csvPath = path.join(outputDir, csvName);
  const jsonPath = path.join(outputDir, jsonName);
  const hashPath = path.join(outputDir, hashName);
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  const payload = {
    date: options.date,
    generatedAt: new Date().toISOString(),
    items,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  const fileHash = sha256(csvContent);
  const prevHash = resolvePrevHash(outputDir, options.date, options.prevHash);
  const chainHash = prevHash ? sha256(`${prevHash}:${fileHash}`) : sha256(fileHash);
  const hashPayload = {
    date: options.date,
    csv: csvName,
    fileHash,
    prevHash,
    chainHash,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(hashPath, JSON.stringify(hashPayload, null, 2), 'utf8');
  return { csvPath, jsonPath, hashPath, count: items.length, chainHash };
}

async function main() {
  const date = requireDate(parseArgValue('date'));
  const outputDir =
    parseArgValue('output-dir') || path.join('data', 'audit-exports');
  const prevHash = parseArgValue('prev-hash');
  const result = await runExport({ date, outputDir, prevHash });
  console.log('[audit-export]', {
    date,
    outputDir,
    count: result.count,
    chainHash: result.chainHash,
  });
}

main()
  .catch((err) => {
    console.error('[audit-export] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
