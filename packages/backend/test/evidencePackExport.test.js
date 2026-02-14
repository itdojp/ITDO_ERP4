import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvidencePackJsonExport } from '../dist/services/evidencePackExport.js';

test('buildEvidencePackJsonExport: returns stable sha256 digest', () => {
  const exportedAt = new Date('2026-02-14T00:00:00.000Z');
  const approval = {
    id: 'ap-1',
    flowType: 'invoice',
    targetTable: 'invoices',
    targetId: 'inv-1',
    status: 'pending_qa',
    currentStep: 1,
    projectId: 'prj-1',
    createdAt: new Date('2026-02-13T10:00:00.000Z'),
    createdBy: 'user-a',
  };
  const snapshotA = {
    id: 'snap-1',
    version: 2,
    capturedAt: new Date('2026-02-14T00:00:00.000Z'),
    capturedBy: 'user-a',
    sourceAnnotationUpdatedAt: new Date('2026-02-13T11:00:00.000Z'),
    items: {
      z: 1,
      a: { y: 2, x: 3 },
    },
  };
  const snapshotB = {
    ...snapshotA,
    items: {
      a: { x: 3, y: 2 },
      z: 1,
    },
  };

  const packA = buildEvidencePackJsonExport({
    exportedAt,
    exportedBy: 'auditor',
    approval,
    snapshot: snapshotA,
  });
  const packB = buildEvidencePackJsonExport({
    exportedAt,
    exportedBy: 'auditor',
    approval,
    snapshot: snapshotB,
  });

  assert.equal(packA.format, 'json');
  assert.equal(packA.integrity.algorithm, 'sha256');
  assert.match(packA.integrity.digest, /^[a-f0-9]{64}$/);
  assert.equal(packA.integrity.digest, packB.integrity.digest);
});
