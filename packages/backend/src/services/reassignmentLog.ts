import { prisma } from './db.js';

type ReassignmentLogInput = {
  targetTable: string;
  targetId: string;
  fromProjectId?: string | null;
  toProjectId?: string | null;
  fromTaskId?: string | null;
  toTaskId?: string | null;
  reasonCode: string;
  reasonText: string;
  createdBy?: string | null;
};

export async function logReassignment(entry: ReassignmentLogInput) {
  try {
    await prisma.reassignmentLog.create({
      data: {
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        fromProjectId: entry.fromProjectId ?? null,
        toProjectId: entry.toProjectId ?? null,
        fromTaskId: entry.fromTaskId ?? null,
        toTaskId: entry.toTaskId ?? null,
        reasonCode: entry.reasonCode,
        reasonText: entry.reasonText,
        createdBy: entry.createdBy ?? null,
      },
    });
  } catch (err) {
    // 監査ログと同様に、失敗してもアプリ処理は継続
    console.error('[reassignment log failed]', err);
  }
}
