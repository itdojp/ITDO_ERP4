import { prisma } from './db.js';

type AuditInput = {
  action: string;
  userId?: string;
  targetTable?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export async function logAudit(entry: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId,
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        metadata: entry.metadata ? entry.metadata : undefined,
      },
    });
  } catch (err) {
    // 粗めのスタブ: 失敗してもアプリ処理は継続
    console.error('[audit log failed]', err);
  }
}
