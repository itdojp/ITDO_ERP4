import { prisma } from './db.js';
import { triggerAlert } from './alert.js';
import type { DocStatus } from '@prisma/client';

const PENDING_STATUSES: DocStatus[] = ['pending_qa', 'pending_exec'];

function buildTargetRef(instanceId: string, stepOrder: number) {
  return `approval_instance:${instanceId}:step:${stepOrder}`;
}

function hoursSince(createdAt: Date, now: number) {
  const diffHours = (now - createdAt.getTime()) / 3600000;
  return Math.round(diffHours * 100) / 100;
}

export async function runApprovalEscalations() {
  const settings = await prisma.alertSetting.findMany({
    where: { isEnabled: true, type: 'approval_escalation' },
  });
  for (const setting of settings) {
    const threshold = Number(setting.threshold);
    if (!Number.isFinite(threshold)) continue;

    const pendingSteps = await prisma.approvalStep.findMany({
      where: {
        status: { in: PENDING_STATUSES },
        instance: {
          status: { in: PENDING_STATUSES },
          ...(setting.scopeProjectId
            ? { projectId: setting.scopeProjectId }
            : {}),
        },
      },
      select: {
        instanceId: true,
        stepOrder: true,
        createdAt: true,
        instance: { select: { currentStep: true } },
      },
    });

    const grouped = new Map<
      string,
      { instanceId: string; stepOrder: number; createdAt: Date }
    >();
    for (const step of pendingSteps) {
      if (!step.instance.currentStep) continue;
      if (step.stepOrder !== step.instance.currentStep) continue;
      const key = `${step.instanceId}:${step.stepOrder}`;
      const existing = grouped.get(key);
      if (!existing || step.createdAt < existing.createdAt) {
        grouped.set(key, {
          instanceId: step.instanceId,
          stepOrder: step.stepOrder,
          createdAt: step.createdAt,
        });
      }
    }

    const now = Date.now();
    const nowDate = new Date(now);
    const overdueTargets: string[] = [];
    for (const group of grouped.values()) {
      const hours = hoursSince(group.createdAt, now);
      if (hours <= threshold) continue;
      const targetRef = buildTargetRef(group.instanceId, group.stepOrder);
      overdueTargets.push(targetRef);
      await triggerAlert(
        {
          id: setting.id,
          recipients: setting.recipients,
          channels: setting.channels,
          remindAfterHours: setting.remindAfterHours,
          remindMaxCount: setting.remindMaxCount,
        },
        hours,
        threshold,
        targetRef,
        nowDate,
      );
    }

    const baseWhere = { settingId: setting.id, status: 'open' };
    if (!overdueTargets.length) {
      await prisma.alert.updateMany({
        where: baseWhere,
        data: { status: 'closed' },
      });
      continue;
    }
    await prisma.alert.updateMany({
      where: { ...baseWhere, targetRef: { notIn: overdueTargets } },
      data: { status: 'closed' },
    });
  }
}
