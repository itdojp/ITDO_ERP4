import { DocStatusValue } from '../types.js';
import { prisma } from './db.js';

type Step = { approverGroupId?: string; approverUserId?: string };

export async function createApproval(flowType: string, targetTable: string, targetId: string, steps: Step[]) {
  const ruleId = 'manual';
  return prisma.$transaction(async (tx: any) => {
    const instance = await tx.approvalInstance.create({
      data: {
        flowType,
        targetTable,
        targetId,
        status: DocStatusValue.pending_qa,
        currentStep: steps.length ? 1 : null,
        ruleId,
        steps: {
          create: steps.map((s: any, idx: number) => ({
            stepOrder: idx + 1,
            approverGroupId: s.approverGroupId,
            approverUserId: s.approverUserId,
            status: DocStatusValue.pending_qa,
          })),
        },
      },
      include: { steps: true },
    });
    return instance;
  });
}

export async function act(instanceId: string, userId: string, action: 'approve' | 'reject') {
  return prisma.$transaction(async (tx: any) => {
    const instance = await tx.approvalInstance.findUnique({ where: { id: instanceId }, include: { steps: true } });
    if (!instance) throw new Error('Instance not found');
    const current = instance.steps.find((s: any) => s.stepOrder === instance.currentStep);
    if (!current) throw new Error('No current step');
    await tx.approvalStep.update({
      where: { id: current.id },
      data: { status: action === 'approve' ? DocStatusValue.approved : DocStatusValue.rejected, actedBy: userId, actedAt: new Date() },
    });
    let newStatus;
    let newCurrentStep = instance.currentStep;
    if (action === 'reject') {
      newStatus = DocStatusValue.rejected;
    } else {
      const nextStep = instance.currentStep
        ? instance.steps.find((s: any) => s.stepOrder === instance.currentStep + 1)
        : null;
      if (nextStep) {
        newCurrentStep = nextStep.stepOrder;
        newStatus = DocStatusValue.pending_qa;
      } else {
        newCurrentStep = null;
        newStatus = DocStatusValue.approved;
      }
    }
    await tx.approvalInstance.update({ where: { id: instance.id }, data: { status: newStatus, currentStep: newCurrentStep } });
    return { status: newStatus, currentStep: newCurrentStep };
  });
}
