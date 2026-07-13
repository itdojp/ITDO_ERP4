import {
  createApprovalOutcomeNotification as defaultCreateApprovalOutcomeNotification,
  createApprovalPendingNotifications as defaultCreateApprovalPendingNotifications,
} from '../../services/appNotifications.js';
import { applyChatAckTemplates as defaultApplyChatAckTemplates } from '../../services/chatAckTemplates.js';
import { DocStatusValue, type FlowType } from '../../types.js';

type ApplyChatAckTemplatesInput = Parameters<
  typeof defaultApplyChatAckTemplates
>[0];

type WorkflowSideEffectRequest = ApplyChatAckTemplatesInput['req'] & {
  log?: {
    warn?: (payload: unknown, message?: string) => void;
  };
};

type ApprovalStepLike = {
  stepOrder: number;
  status: string;
  approverGroupId?: string | null;
  approverUserId?: string | null;
};

type ApprovalInstanceForNotifications = {
  id: string;
  projectId?: string | null;
  createdBy?: string | null;
  flowType: string;
  targetTable: string;
  targetId: string;
  currentStep?: number | null;
  steps: ApprovalStepLike[];
};

type ApprovalInstanceForChatAck = {
  id: string;
  projectId?: string | null;
  flowType: string;
};

export type WorkflowApprovalActionSideEffectPorts = {
  createApprovalOutcomeNotification?: typeof defaultCreateApprovalOutcomeNotification;
  createApprovalPendingNotifications?: typeof defaultCreateApprovalPendingNotifications;
  applyChatAckTemplates?: typeof defaultApplyChatAckTemplates;
};

export type RunApprovalActionSideEffectsInput = {
  req: WorkflowSideEffectRequest;
  instance: ApprovalInstanceForChatAck;
  updated: ApprovalInstanceForNotifications | null;
  result: { status: string };
  actionKey: string;
  actorUserId: string;
};

function resolvePorts(overrides?: WorkflowApprovalActionSideEffectPorts) {
  return {
    createApprovalOutcomeNotification:
      overrides?.createApprovalOutcomeNotification ??
      defaultCreateApprovalOutcomeNotification,
    createApprovalPendingNotifications:
      overrides?.createApprovalPendingNotifications ??
      defaultCreateApprovalPendingNotifications,
    applyChatAckTemplates:
      overrides?.applyChatAckTemplates ?? defaultApplyChatAckTemplates,
  };
}

export async function runApprovalActionSideEffects(
  input: RunApprovalActionSideEffectsInput,
  overrides?: WorkflowApprovalActionSideEffectPorts,
) {
  const ports = resolvePorts(overrides);
  const { actorUserId, result, updated } = input;

  if (updated?.createdBy) {
    if (result.status === DocStatusValue.approved) {
      await ports.createApprovalOutcomeNotification({
        approvalInstanceId: updated.id,
        projectId: updated.projectId,
        requesterUserId: updated.createdBy,
        actorUserId,
        flowType: updated.flowType,
        targetTable: updated.targetTable,
        targetId: updated.targetId,
        outcome: 'approved',
      });
    } else if (result.status === DocStatusValue.rejected) {
      await ports.createApprovalOutcomeNotification({
        approvalInstanceId: updated.id,
        projectId: updated.projectId,
        requesterUserId: updated.createdBy,
        actorUserId,
        flowType: updated.flowType,
        targetTable: updated.targetTable,
        targetId: updated.targetId,
        outcome: 'rejected',
      });
    } else if (
      result.status === DocStatusValue.pending_qa ||
      result.status === DocStatusValue.pending_exec
    ) {
      await ports.createApprovalPendingNotifications({
        approvalInstanceId: updated.id,
        projectId: updated.projectId,
        requesterUserId: updated.createdBy,
        actorUserId,
        flowType: updated.flowType,
        targetTable: updated.targetTable,
        targetId: updated.targetId,
        currentStep: updated.currentStep,
        steps: updated.steps,
      });
    }
  }

  try {
    await ports.applyChatAckTemplates({
      req: input.req,
      flowType: input.instance.flowType as FlowType,
      actionKey: input.actionKey,
      targetTable: 'approval_instances',
      targetId: input.instance.id,
      projectId: input.instance.projectId,
      actorUserId,
    });
  } catch (err) {
    input.req.log?.warn?.(
      { err, approvalInstanceId: input.instance.id },
      'applyChatAckTemplates failed',
    );
  }
}
