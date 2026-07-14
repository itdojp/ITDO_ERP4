import { Buffer } from 'node:buffer';

import { normalizeCsvCell, parseCsvBoolean, parseCsvRaw } from './csv.js';

export { parseCsvBoolean };

export type ImportError = {
  scope: string;
  legacyId?: string;
  message: string;
};

export type CsvRecord = Record<string, string | null>;

export type PoMigrationInputEncoding = 'utf8';

export function decodePoMigrationBytes(
  input: Uint8Array | string,
  encoding: PoMigrationInputEncoding = 'utf8',
): string {
  if (encoding !== 'utf8') {
    throw new Error(`unsupported PO migration input encoding: ${encoding}`);
  }
  if (typeof input === 'string') return input;
  return Buffer.from(input).toString('utf8');
}

export function parsePoJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export function parsePoCsvRecords(
  raw: string,
  scope: string,
  sourceName: string,
  errors: ImportError[],
): CsvRecord[] {
  if (!raw.trim()) return [];
  const rows = parseCsvRaw(raw) as string[][];
  if (!rows.length) return [];
  if (rows.length === 1) return [];

  const header = rows[0].map((cell) => (cell ?? '').trim());
  if (!header.length || header.every((v) => !v)) {
    errors.push({ scope, message: `invalid CSV header: ${sourceName}` });
    return [];
  }

  const records: CsvRecord[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const record: CsvRecord = {};
    for (let colIndex = 0; colIndex < header.length; colIndex += 1) {
      const key = header[colIndex];
      if (!key) continue;
      record[key] = normalizeCsvCell(row[colIndex]);
    }
    records.push(record);
  }
  return records;
}

export function parseCsvJsonArray(
  scope: string,
  legacyId: string | undefined,
  value: string | null,
  errors: ImportError[],
): unknown[] | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      errors.push({
        scope,
        legacyId,
        message: 'CSV lines must be a JSON array',
      });
      return null;
    }
    return parsed;
  } catch (err) {
    errors.push({
      scope,
      legacyId,
      message: `failed to parse CSV JSON field: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}

export function parseCsvItems<T extends { legacyId: string }>(
  scope: string,
  records: CsvRecord[],
  required: string[],
  errors: ImportError[],
  postProcess?: (item: Record<string, unknown>, record: CsvRecord) => void,
): T[] {
  const items: T[] = [];
  for (const record of records) {
    const legacyId = record.legacyId ?? undefined;
    let ok = true;
    for (const key of required) {
      if (!record[key]) {
        errors.push({
          scope,
          legacyId,
          message: `missing required field: ${key}`,
        });
        ok = false;
      }
    }
    if (!ok) continue;
    const item: Record<string, unknown> = { ...record };
    postProcess?.(item, record);
    items.push(item as T);
  }
  return items;
}

export function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return (allowed as readonly string[]).includes(trimmed)
    ? (trimmed as T)
    : fallback;
}

export function normalizeString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ensureNoDuplicates(
  items: Array<{ legacyId: string; code?: string | null }>,
  scope: string,
  errors: ImportError[],
): void {
  const legacySeen = new Set<string>();
  const codeSeen = new Set<string>();
  for (const item of items) {
    if (legacySeen.has(item.legacyId)) {
      errors.push({
        scope,
        legacyId: item.legacyId,
        message: 'duplicate legacyId',
      });
    }
    legacySeen.add(item.legacyId);
    if (item.code) {
      if (codeSeen.has(item.code)) {
        errors.push({
          scope,
          legacyId: item.legacyId,
          message: `duplicate code: ${item.code}`,
        });
      }
      codeSeen.add(item.code);
    }
  }
}

export function normalizeLines<T>(lines: T[] | null | undefined): T[] {
  if (!lines) return [];
  return lines.filter((line) => line != null);
}
