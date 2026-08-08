import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// PrismaClient のシングルトン。各ルートで new しないように集約。
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

// activitySequence is an internal unread high-water boundary. Keep it out of
// legacy route responses by default; services that own unread state select it
// explicitly when required.
export const prisma = new PrismaClient({
  adapter,
  omit: { chatMessage: { activitySequence: true } },
});
