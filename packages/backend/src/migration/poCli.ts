import { PO_MIGRATION_ENTITY_ORDER } from './poDomain.js';

export type PoMigrationCliOptions = {
  inputDir: string;
  inputFormat: 'json' | 'csv';
  apply: boolean;
  only: Set<string> | null;
};

export type PoMigrationEnvironment = Record<string, string | undefined>;

export type PoMigrationLogger = Pick<Console, 'log' | 'error'>;

export type PoMigrationCliRequest =
  { kind: 'help' } | { kind: 'run'; options: PoMigrationCliOptions };

export function formatPoCliHelp(): string {
  return [
    'Usage: scripts/migrate-po.ts [--input-dir=DIR] [--input-format=json|csv] [--only=users,customers,...] [--apply]',
    '',
    'Options:',
    '  --input-dir=DIR   Input directory (default: tmp/migration/po)',
    '  --input-format=F  Input format: json|csv (default: json)',
    `  --only=LIST       Comma-separated scopes: ${PO_MIGRATION_ENTITY_ORDER.join(',')}`,
    '  --apply           Apply changes to DB (requires MIGRATION_CONFIRM=1)',
    '',
    'Examples:',
    '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts',
    '  MIGRATION_CONFIRM=1 npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --apply',
  ].join('\n');
}

export function shouldShowPoCliHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function parsePoCliArgValue(
  argv: readonly string[],
  key: string,
): string | undefined {
  const prefix = `--${key}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

export function parsePoCliFlag(argv: readonly string[], key: string): boolean {
  return argv.includes(`--${key}`) || argv.includes(`--${key}=1`);
}

export function parsePoInputFormat(value?: string): 'json' | 'csv' {
  if (!value) return 'json';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'json') return 'json';
  if (normalized === 'csv') return 'csv';
  throw new Error(`invalid --input-format: ${value} (expected: json|csv)`);
}

export function parsePoOnlyScopes(value?: string): Set<string> | null {
  if (!value) return null;
  const items = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

export function requirePoApplyConfirm(
  apply: boolean,
  env: PoMigrationEnvironment,
): void {
  if (!apply) return;
  if (env.MIGRATION_CONFIRM !== '1') {
    throw new Error('MIGRATION_CONFIRM=1 is required when --apply is set');
  }
}

export function parsePoCliRequest(
  argv: readonly string[],
  env: PoMigrationEnvironment,
): PoMigrationCliRequest {
  if (shouldShowPoCliHelp(argv)) return { kind: 'help' };

  const inputDir =
    parsePoCliArgValue(argv, 'input-dir') ||
    parsePoCliArgValue(argv, 'inputDir') ||
    'tmp/migration/po';
  const inputFormat = parsePoInputFormat(
    parsePoCliArgValue(argv, 'input-format') ||
      parsePoCliArgValue(argv, 'inputFormat'),
  );
  const apply = parsePoCliFlag(argv, 'apply');
  const only = parsePoOnlyScopes(parsePoCliArgValue(argv, 'only'));
  requirePoApplyConfirm(apply, env);

  return { kind: 'run', options: { inputDir, inputFormat, apply, only } };
}
