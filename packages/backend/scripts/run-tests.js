import { spawnSync } from 'node:child_process';

const DEFAULT_DATABASE_URL =
  'postgresql://user:pass@localhost:5432/postgres?schema=public';

// Keep developer overrides. Only provide a default when missing/empty.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env },
});

process.exit(result.status ?? 1);

