import { DocStatusValue, type FlowType } from '../types.js';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRules(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isApprovalEvidenceGateEnabled(
  flowType: FlowType,
  actionKey: string,
  ruleText: string | undefined = process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS,
) {
  const flow = normalizeString(flowType).toLowerCase();
  const action = normalizeString(actionKey).toLowerCase();
  if (!flow || !action) return false;
  for (const rule of parseRules(ruleText)) {
    const [ruleFlow, ruleAction] = rule.split(':');
    if (!ruleFlow || !ruleAction) continue;
    const flowMatched = ruleFlow === '*' || ruleFlow === flow;
    const actionMatched = ruleAction === '*' || ruleAction === action;
    if (flowMatched && actionMatched) return true;
  }
  return false;
}

type EnsureApprovalEvidenceInput = {
  flowType: FlowType;
  actionKey: string;
  targetTable: string;
  targetId: string;
};

type EnsureApprovalEvidenceResult =
  | { required: false; allowed: true }
  | {
      required: true;
      allowed: true;
      approvalInstanceId: string;
      snapshotId: string;
    }
  | {
      required: true;
      allowed: false;
      code: 'APPROVAL_REQUIRED' | 'EVIDENCE_REQUIRED';
      message: string;
      approvalInstanceId?: string;
    };

export async function ensureApprovalEvidenceReady(
  client: any,
  input: EnsureApprovalEvidenceInput,
  ruleText: string | undefined = process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS,
): Promise<EnsureApprovalEvidenceResult> {
  if (
    !isApprovalEvidenceGateEnabled(input.flowType, input.actionKey, ruleText)
  ) {
    return { required: false, allowed: true };
  }

  const latest = await client.approvalInstance.findFirst({
    where: {
      flowType: input.flowType,
      targetTable: input.targetTable,
      targetId: input.targetId,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true },
  });
  if (!latest?.id || latest.status !== DocStatusValue.approved) {
    return {
      required: true,
      allowed: false,
      code: 'APPROVAL_REQUIRED',
      message: 'Approval is required before this operation',
      approvalInstanceId: latest?.id ?? undefined,
    };
  }

  const snapshot = await client.evidenceSnapshot.findFirst({
    where: { approvalInstanceId: latest.id },
    orderBy: { capturedAt: 'desc' },
    select: { id: true },
  });
  if (!snapshot?.id) {
    return {
      required: true,
      allowed: false,
      code: 'EVIDENCE_REQUIRED',
      message: 'Evidence snapshot is required before this operation',
      approvalInstanceId: latest.id,
    };
  }

  return {
    required: true,
    allowed: true,
    approvalInstanceId: latest.id,
    snapshotId: snapshot.id,
  };
}
