import { prisma } from './db.js';

export async function computeBudgetOverrun(projectId: string): Promise<number> {
  // TODO: replace with real calculation
  return 111; // percent
}

export async function computeOvertime(userId: string): Promise<number> {
  // TODO: replace with real calculation per week/day
  return 6; // hours
}

export async function computeApprovalDelay(instanceId: string): Promise<number> {
  // TODO: replace with real calculation in hours
  return 26;
}

export async function computeDeliveryDue(): Promise<number> {
  const now = new Date();
  const count = await prisma.projectMilestone.count({
    where: {
      dueDate: { lte: now },
      deletedAt: null,
      project: { deletedAt: null },
      invoices: { none: { deletedAt: null } },
    },
  });
  return count;
}
