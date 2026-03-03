import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEvidencePackJsonExport,
  maskEvidencePackJsonExport,
  renderEvidencePackPdf,
} from '../dist/services/evidencePackExport.js';

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

test('maskEvidencePackJsonExport: masks sensitive fields and rehashes', () => {
  const base = buildEvidencePackJsonExport({
    exportedAt: new Date('2026-02-14T00:00:00.000Z'),
    exportedBy: 'auditor@example.com',
    approval: {
      id: 'ap-2',
      flowType: 'invoice',
      targetTable: 'invoices',
      targetId: 'inv-2',
      status: 'pending_qa',
      currentStep: 1,
      projectId: 'prj-2',
      createdAt: new Date('2026-02-13T10:00:00.000Z'),
      createdBy: 'u1234567',
    },
    snapshot: {
      id: 'snap-2',
      version: 1,
      capturedAt: new Date('2026-02-14T00:00:00.000Z'),
      capturedBy: 'u7654321',
      sourceAnnotationUpdatedAt: new Date('2026-02-13T11:00:00.000Z'),
      items: {
        notes: 'contact foo@example.com and 09012345678',
        subject: {
          kind: 'time_entry',
          timeEntry: {
            id: 't-1',
            userId: 'u99999',
            projectId: 'p-1',
            notes: 'mail foo@example.com',
          },
        },
        externalUrls: ['https://example.com/private/path?a=1'],
        internalRefs: [
          { kind: 'chat_message', id: 'm-1', label: 'secret 09011112222' },
        ],
        chatMessages: [
          {
            id: 'm-1',
            roomId: 'r-1',
            userId: 'u99999',
            createdAt: '2026-02-13T10:00:00.000Z',
            excerpt: 'mail foo@example.com',
          },
        ],
      },
    },
    workflowHistory: {
      steps: [
        {
          id: 'step-1',
          stepOrder: 1,
          approverGroupId: 'g-1',
          approverUserId: 'u-approver',
          status: 'approved',
          actedBy: 'u99999',
          actedAt: '2026-02-14T00:00:00.000Z',
          createdAt: '2026-02-13T00:00:00.000Z',
        },
      ],
      events: [
        {
          id: 'audit-1',
          action: 'approval_step_approve',
          occurredAt: '2026-02-14T00:00:00.000Z',
          targetTable: 'approval_steps',
          targetId: 'step-1',
          userId: 'u99999',
          actorRole: 'user',
          actorGroupId: 'g-1',
          reasonText: 'mail foo@example.com',
          metadata: { step: 1 },
        },
      ],
    },
    attachments: [
      {
        kind: 'chat_attachment',
        id: 'att-1',
        sourceTable: 'chat_messages',
        sourceId: 'm-1',
        filename: 'secret foo@example.com.png',
        contentType: 'image/png',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      },
    ],
  });
  const masked = maskEvidencePackJsonExport(base);
  assert.notEqual(masked.integrity.digest, base.integrity.digest);
  assert.notEqual(masked.payload.exportedBy, base.payload.exportedBy);
  assert.notEqual(
    masked.payload.snapshot.capturedBy,
    base.payload.snapshot.capturedBy,
  );
  assert.notEqual(masked.payload.workflowHistory.steps[0].actedBy, 'u99999');
  assert.notEqual(masked.payload.workflowHistory.events[0].userId, 'u99999');
  assert.equal(
    masked.payload.workflowHistory.events[0].reasonText.includes(
      'foo@example.com',
    ),
    false,
  );
  assert.equal(
    masked.payload.attachments[0].filename.includes('foo@example.com'),
    false,
  );
  const maskedItems = masked.payload.snapshot.items;
  assert.equal(maskedItems.notes.includes('foo@example.com'), false);
  assert.notEqual(maskedItems.subject.timeEntry.userId, 'u99999');
  assert.equal(
    maskedItems.subject.timeEntry.notes.includes('foo@example.com'),
    false,
  );
  assert.equal(maskedItems.externalUrls[0], 'https://example.com/***');
  assert.equal(
    maskedItems.chatMessages[0].excerpt.includes('foo@example.com'),
    false,
  );
  assert.notEqual(maskedItems.chatMessages[0].userId, 'u99999');
});

test('renderEvidencePackPdf: returns pdf buffer', async () => {
  const exported = buildEvidencePackJsonExport({
    exportedAt: new Date('2026-02-14T00:00:00.000Z'),
    exportedBy: 'auditor@example.com',
    approval: {
      id: 'ap-3',
      flowType: 'invoice',
      targetTable: 'invoices',
      targetId: 'inv-3',
      status: 'pending_qa',
      currentStep: 1,
      projectId: 'prj-3',
      createdAt: new Date('2026-02-13T10:00:00.000Z'),
      createdBy: 'u1234567',
    },
    snapshot: {
      id: 'snap-3',
      version: 1,
      capturedAt: new Date('2026-02-14T00:00:00.000Z'),
      capturedBy: 'u7654321',
      sourceAnnotationUpdatedAt: new Date('2026-02-13T11:00:00.000Z'),
      items: { notes: 'test' },
    },
  });
  const pdf = await renderEvidencePackPdf(exported);
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
