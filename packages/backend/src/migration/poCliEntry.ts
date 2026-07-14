import { prisma } from '../services/db.js';

import { runPoMigrationCli } from './poRunner.js';

runPoMigrationCli()
  .then((result) => {
    process.exitCode = result.exitCode ?? 0;
  })
  .catch((err: unknown) => {
    console.error(
      '[migration-po] fatal:',
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
