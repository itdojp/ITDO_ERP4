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
