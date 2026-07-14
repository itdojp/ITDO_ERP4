// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { prisma } from '../packages/backend/dist/services/db.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { runPoMigrationCli } from '../packages/backend/dist/migration/poRunner.js';

runPoMigrationCli()
  .then((result: { exitCode?: number }) => {
    process.exitCode = result.exitCode ?? 0;
  })
  .catch((err: unknown) => {
    console.error('[migration-po] fatal:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
