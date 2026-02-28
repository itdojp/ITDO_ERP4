// Bootstrap script: create (or normalize) per-user personal GA chat rooms for existing users.
//
// Usage:
//   npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/bootstrap-personal-ga-chat.ts
//   npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/bootstrap-personal-ga-chat.ts --limit=200
//   npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/bootstrap-personal-ga-chat.ts --only-user=e2e-user@example.com
//
// Note: This script imports backend dist modules; run `npm run build --prefix packages/backend` beforehand.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { prisma } from '../packages/backend/dist/services/db.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { ensurePersonalGeneralAffairsChatRoom } from '../packages/backend/dist/services/personalGaChatRoom.js';

function parseArgValue(key: string): string | undefined {
  const prefix = `--${key}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function shouldShowHelp(): boolean {
  return process.argv.includes('--help') || process.argv.includes('-h');
}

function parseLimit(value?: string) {
  if (!value) return 1000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid --limit: ${value} (expected: positive number)`);
  }
  return Math.min(Math.floor(parsed), 10000);
}

function printHelp() {
  const lines = [
    'Usage: scripts/bootstrap-personal-ga-chat.ts [--limit=N] [--only-user=USER_ID]',
    '',
    'Examples:',
    '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/bootstrap-personal-ga-chat.ts',
    '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/bootstrap-personal-ga-chat.ts --limit=200',
    '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/bootstrap-personal-ga-chat.ts --only-user=someone@example.com',
  ];
  console.log(lines.join('\n'));
}

async function main() {
  if (shouldShowHelp()) {
    printHelp();
    return;
  }

  const limit = parseLimit(parseArgValue('limit'));
  const onlyUser = (parseArgValue('only-user') || '').trim();

  const users = await prisma.userAccount.findMany({
    where: {
      active: true,
      deletedAt: null,
      ...(onlyUser ? { userName: onlyUser } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, userName: true, externalId: true, displayName: true },
  });

  let ensuredCount = 0;
  const errors: string[] = [];

  for (const user of users) {
    const userId = (user.externalId || user.userName || '').trim();
    if (!userId) continue;
    try {
      await ensurePersonalGeneralAffairsChatRoom({
        userAccountId: user.id,
        userId,
        userName: user.userName,
        displayName: user.displayName,
        createdBy: userId,
      });
      ensuredCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${userId}: ${message}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        userCount: users.length,
        ensuredCount,
        errorCount: errors.length,
        errors: errors.slice(0, 20),
      },
      null,
      2,
    ),
  );

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
