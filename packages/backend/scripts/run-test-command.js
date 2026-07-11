import { spawnSync } from 'node:child_process';

const DEFAULT_DATABASE_URL =
  'postgresql://user:pass@localhost:5432/postgres?schema=public';

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run(npmCommand, ['run', 'prisma:generate']);
run(npmCommand, ['run', 'build']);
run(process.execPath, ['scripts/run-tests.js', ...process.argv.slice(2)]);
