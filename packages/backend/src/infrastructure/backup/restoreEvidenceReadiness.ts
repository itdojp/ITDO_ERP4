import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

import type { RestoreEvidenceObservation } from '../../application/backup/storageReadiness.js';

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_EVIDENCE_BYTES = 64 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOnlyKeys(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
) {
  if (!value) return false;
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function sameEvidenceState(
  left: Awaited<ReturnType<FileHandle['stat']>>,
  right: Awaited<ReturnType<FileHandle['stat']>>,
) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function canonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export async function inspectRestoreEvidence(options: {
  evidenceFile?: string;
  expectedBackupId?: string;
  expectedEnvironment?: string;
}): Promise<RestoreEvidenceObservation> {
  if (!options.evidenceFile?.trim()) return { configured: false };
  if (
    !options.expectedBackupId ||
    !SAFE_TOKEN.test(options.expectedBackupId) ||
    !options.expectedEnvironment ||
    !SAFE_TOKEN.test(options.expectedEnvironment)
  ) {
    return { configured: true, errorCode: 'configuration_invalid' };
  }

  let handle;
  try {
    handle = await open(
      options.evidenceFile,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      info.size <= 0 ||
      info.size > MAX_EVIDENCE_BYTES
    ) {
      return { configured: true, errorCode: 'evidence_unreadable' };
    }
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== info.size || !sameEvidenceState(info, after)) {
      return { configured: true, errorCode: 'evidence_unreadable' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.subarray(0, offset).toString('utf8'));
    } catch {
      return { configured: true, errorCode: 'evidence_invalid' };
    }
    const root = asRecord(parsed);
    const checks = asRecord(root?.checks);
    const result = root?.result;
    if (
      root?.schemaVersion !== 'erp4.restore.evidence.v1' ||
      !hasOnlyKeys(root, [
        'schemaVersion',
        'environment',
        'backupId',
        'completedAt',
        'result',
        'checks',
      ]) ||
      !hasOnlyKeys(checks, ['counts', 'amounts', 'references', 'files']) ||
      typeof root.environment !== 'string' ||
      !SAFE_TOKEN.test(root.environment) ||
      typeof root.backupId !== 'string' ||
      !SAFE_TOKEN.test(root.backupId) ||
      !canonicalUtc(root.completedAt) ||
      !['pass', 'fail', 'blocked'].includes(String(result)) ||
      typeof checks !== 'object' ||
      !['counts', 'amounts', 'references', 'files'].every(
        (name) => typeof checks?.[name] === 'boolean',
      )
    ) {
      return { configured: true, errorCode: 'evidence_invalid' };
    }
    const checksPass = ['counts', 'amounts', 'references', 'files'].every(
      (name) => checks?.[name] === true,
    );
    return {
      configured: true,
      backupIdMatches: root.backupId === options.expectedBackupId,
      completedAt: root.completedAt,
      environmentMatches: root.environment === options.expectedEnvironment,
      result: checksPass ? (result as 'pass' | 'fail' | 'blocked') : 'fail',
    };
  } catch {
    return { configured: true, errorCode: 'evidence_unreadable' };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
