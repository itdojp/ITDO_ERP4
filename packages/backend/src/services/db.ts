import { PrismaClient } from '@prisma/client';

// PrismaClient のシングルトン。各ルートで new しないように集約。
export const prisma = new PrismaClient();
