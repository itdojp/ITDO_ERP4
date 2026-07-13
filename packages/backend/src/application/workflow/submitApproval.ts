import { createApprovalFor } from '../../services/approval.js';
import { logAudit } from '../../services/audit.js';
import { prisma } from '../../services/db.js';
import { createEvidenceSnapshotForApproval } from '../../services/evidenceSnapshot.js';

/**
 * Options for submitApprovalWithUpdate.
 * update() runs in a transaction and should return the updated entity.
 * payload is optional when approval matching needs fields not in the update result.
 */
export type SubmitApprovalOptions = {
  flowType: string;
  targetTable: string;
  targetId: string;
  update: (tx: any) => Promise<any>;
  payload?: Record<string, unknown>;
  createdBy?: string;
};

/**
 * Atomically update a target, create an approval instance, and capture evidence
 * in one transaction. This application orchestration boundary is the only
 * Workflow entry point that calls the Evidence snapshot adapter directly.
 */
export async function submitApprovalWithUpdate(options: SubmitApprovalOptions) {
  return prisma.$transaction(async (tx: any) => {
    const updated = await options.update(tx);
    const approvalPayload =
      options.payload ?? (updated as Record<string, unknown>);
    const approval = await createApprovalFor(
      options.flowType,
      options.targetTable,
      options.targetId,
      approvalPayload,
      {
        client: tx,
        createdBy: options.createdBy,
      },
    );
    const snapshotResult = await createEvidenceSnapshotForApproval(tx, {
      approvalInstanceId: approval.id,
      targetTable: approval.targetTable,
      targetId: approval.targetId,
      capturedBy: options.createdBy ?? null,
      forceRegenerate: false,
    });
    if (snapshotResult.created) {
      const snapshot = snapshotResult.snapshot;
      await logAudit({
        action: 'evidence_snapshot_created',
        targetTable: 'evidence_snapshots',
        targetId: snapshot.id,
        userId: options.createdBy,
        source: 'system',
        metadata: {
          approvalInstanceId: snapshot.approvalInstanceId,
          targetTable: snapshot.targetTable,
          targetId: snapshot.targetId,
          version: snapshot.version,
          sourceAnnotationUpdatedAt:
            snapshot.sourceAnnotationUpdatedAt?.toISOString() ?? null,
          trigger: 'submit_auto',
        },
      });
    }
    return { updated, approval };
  });
}
