import assert from 'node:assert/strict';
import test from 'node:test';

import {
  retryDocumentSend,
  sendInvoiceDocument,
  sendPurchaseOrderDocument,
} from '../dist/application/send/useCases.js';

function actor(overrides = {}) {
  return {
    userId: 'admin-user',
    roles: ['admin', 'mgmt'],
    groupIds: ['group-001'],
    groupAccountIds: ['group-account-001'],
    ...overrides,
  };
}

function auditContext(overrides = {}) {
  return {
    userId: 'admin-user',
    requestId: 'req-send-app',
    source: 'api',
    ...overrides,
  };
}

function invoice(overrides = {}) {
  return {
    id: 'inv-001',
    status: 'approved',
    projectId: 'proj-001',
    invoiceNo: 'INV-001',
    ...overrides,
  };
}

function purchaseOrder(overrides = {}) {
  return {
    id: 'po-001',
    status: 'approved',
    projectId: 'proj-001',
    poNo: 'PO-001',
    ...overrides,
  };
}

function template(kind = 'invoice') {
  return {
    id:
      kind === 'purchase_order' ? 'purchase-order-default' : `${kind}-default`,
    name: `${kind} default`,
    kind,
    version: 'v1',
    isDefault: true,
  };
}

function allowPolicy(overrides = {}) {
  return {
    allowed: true,
    policyApplied: true,
    matchedPolicyId: 'policy-send',
    requireReason: false,
    ...overrides,
  };
}

function allowedEvidence(overrides = {}) {
  return {
    required: true,
    allowed: true,
    approvalInstanceId: 'approval-001',
    snapshotId: 'snapshot-001',
    ...overrides,
  };
}

function pdfResult(overrides = {}) {
  return {
    url: '/pdf-files/document.pdf',
    filePath: '/workspace/document.pdf',
    filename: 'document.pdf',
    ...overrides,
  };
}

function makePorts(calls, overrides = {}) {
  const records = {
    invoice: invoice(),
    purchaseOrder: purchaseOrder(),
    sendLog: null,
    ...overrides.records,
  };
  const tx = {
    invoice: {
      update: async (args) => {
        calls.push(['invoiceUpdate', args]);
        return { ...records.invoice, ...args.data };
      },
    },
    purchaseOrder: {
      update: async (args) => {
        calls.push(['purchaseOrderUpdate', args]);
        return { ...records.purchaseOrder, ...args.data };
      },
    },
    documentSendLog: {
      update: async (args) => {
        calls.push(['sendLogUpdate', args]);
        return args;
      },
    },
  };
  const ports = {
    db: {
      invoice: {
        findUnique: async (args) => {
          calls.push(['invoiceFindUnique', args]);
          return records.invoice;
        },
      },
      purchaseOrder: {
        findUnique: async (args) => {
          calls.push(['purchaseOrderFindUnique', args]);
          return records.purchaseOrder;
        },
      },
      docTemplateSetting: {
        findUnique: async (args) => {
          calls.push(['templateSettingFindUnique', args]);
          return null;
        },
        findFirst: async (args) => {
          calls.push(['templateSettingFindFirst', args]);
          return null;
        },
      },
      documentSendLog: {
        create: async ({ data }) => {
          const id = data.metadata?.retryOf ? 'retry-log-1' : 'send-log-1';
          calls.push(['sendLogCreate', { id, data }]);
          return { id };
        },
        findUnique: async (args) => {
          calls.push(['sendLogFindUnique', args]);
          return records.sendLog;
        },
      },
      documentSendEvent: {
        findFirst: async (args) => {
          calls.push(['sendEventFindFirst', args]);
          return null;
        },
      },
      $transaction: async (callback) => {
        calls.push(['transactionStart']);
        const result = await callback(tx);
        calls.push(['transactionEnd']);
        return result;
      },
    },
    evaluateActionPolicyWithFallback: async (input) => {
      calls.push(['policy', input]);
      return allowPolicy(overrides.policy);
    },
    logActionPolicyFallbackAllowed: async (params) => {
      calls.push(['policyFallbackAudit', params]);
    },
    logActionPolicyOverride: async (params) => {
      calls.push(['policyOverrideAudit', params]);
    },
    ensureApprovalEvidenceReady: async (...args) => {
      calls.push(['evidence', args]);
      return overrides.evidence ?? allowedEvidence();
    },
    generatePdf: async (...args) => {
      calls.push(['generatePdf', args]);
      return overrides.pdf ?? pdfResult();
    },
    getPdfTemplate: (id) => {
      calls.push(['getPdfTemplate', id]);
      if (id === 'missing-template') return undefined;
      if (id.startsWith('purchase-order')) return template('purchase_order');
      if (id.startsWith('estimate')) return template('estimate');
      return template('invoice');
    },
    getDefaultTemplate: (kind) => {
      calls.push(['getDefaultTemplate', kind]);
      return template(kind);
    },
    sendInvoiceEmail: async (...args) => {
      calls.push(['sendInvoiceEmail', args]);
      return (
        overrides.notify ?? {
          status: 'success',
          channel: 'email',
          messageId: 'msg-invoice-001',
        }
      );
    },
    sendPurchaseOrderEmail: async (...args) => {
      calls.push(['sendPurchaseOrderEmail', args]);
      return (
        overrides.notify ?? {
          status: 'success',
          channel: 'email',
          messageId: 'msg-po-001',
        }
      );
    },
    sendEstimateEmail: async (...args) => {
      calls.push(['sendEstimateEmail', args]);
      return (
        overrides.notify ?? {
          status: 'success',
          channel: 'email',
          messageId: 'msg-estimate-001',
        }
      );
    },
    logAudit: async (input) => {
      calls.push([`logAudit:${input.action}`, input]);
    },
    now: () => overrides.now ?? new Date('2026-07-13T00:00:00Z').getTime(),
  };
  return { ...ports, ...overrides.ports };
}

function names(calls) {
  return calls.map(([name]) => name);
}

test('sendInvoiceDocument runs guard, pdf, send, log, update sequence and propagates Message-ID', async () => {
  const calls = [];
  const result = await sendInvoiceDocument({
    id: 'inv-001',
    reasonText: ' send override ',
    actor: actor(),
    auditContext: auditContext(),
    ports: makePorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'sent');
  assert.equal(result.value.emailMessageId, 'msg-invoice-001');

  assert.deepEqual(
    names(calls).filter((name) =>
      [
        'invoiceFindUnique',
        'policy',
        'evidence',
        'policyFallbackAudit',
        'policyOverrideAudit',
        'getDefaultTemplate',
        'generatePdf',
        'sendLogCreate',
        'logAudit:document_send_requested',
        'sendInvoiceEmail',
        'transactionStart',
        'invoiceUpdate',
        'sendLogUpdate',
        'transactionEnd',
        'logAudit:document_send_completed',
      ].includes(name),
    ),
    [
      'invoiceFindUnique',
      'policy',
      'evidence',
      'policyFallbackAudit',
      'policyOverrideAudit',
      'getDefaultTemplate',
      'generatePdf',
      'sendLogCreate',
      'logAudit:document_send_requested',
      'sendInvoiceEmail',
      'transactionStart',
      'invoiceUpdate',
      'sendLogUpdate',
      'transactionEnd',
      'logAudit:document_send_completed',
    ],
  );

  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.flowType, 'invoice');
  assert.equal(policy.actionKey, 'send');
  assert.equal(policy.reasonText, 'send override');
  assert.deepEqual(policy.state, { status: 'approved', projectId: 'proj-001' });

  const sendLog = calls.find(([name]) => name === 'sendLogCreate')?.[1];
  assert.equal(sendLog.data.status, 'requested');
  assert.equal(sendLog.data.targetTable, 'invoices');
  assert.deepEqual(sendLog.data.recipients, ['fin@example.com']);

  const email = calls.find(([name]) => name === 'sendInvoiceEmail')?.[1];
  assert.equal(email[1], 'INV-001');
  assert.deepEqual(email[3].metadata, {
    sendLogId: 'send-log-1',
    targetTable: 'invoices',
    targetId: 'inv-001',
    kind: 'invoice',
  });

  const invoiceUpdate = calls.find(([name]) => name === 'invoiceUpdate')?.[1];
  assert.equal(invoiceUpdate.data.status, 'sent');
  assert.equal(invoiceUpdate.data.emailMessageId, 'msg-invoice-001');
  const sendLogUpdate = calls.find(([name]) => name === 'sendLogUpdate')?.[1];
  assert.equal(sendLogUpdate.data.providerMessageId, 'msg-invoice-001');
});

test('sendInvoiceDocument stops before external send when approval evidence is missing', async () => {
  const calls = [];
  const result = await sendInvoiceDocument({
    id: 'inv-001',
    actor: actor(),
    auditContext: auditContext(),
    ports: makePorts(calls, {
      evidence: {
        required: true,
        allowed: false,
        code: 'EVIDENCE_REQUIRED',
        message: 'Evidence snapshot is required before this operation',
        approvalInstanceId: 'approval-001',
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, 'EVIDENCE_REQUIRED');
  assert.equal(names(calls).includes('generatePdf'), false);
  assert.equal(names(calls).includes('sendInvoiceEmail'), false);
  assert.equal(names(calls).includes('sendLogCreate'), false);
  assert.equal(names(calls).includes('policyFallbackAudit'), false);
});

test('sendInvoiceDocument maps reason-required policy denial without evidence or send side effects', async () => {
  const calls = [];
  const result = await sendInvoiceDocument({
    id: 'inv-001',
    actor: actor(),
    auditContext: auditContext(),
    ports: makePorts(calls, {
      policy: {
        allowed: false,
        policyApplied: true,
        reason: 'reason_required',
        matchedPolicyId: 'policy-reason',
        requireReason: true,
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: {
      code: 'REASON_REQUIRED',
      message: 'reasonText is required for override',
      details: { matchedPolicyId: 'policy-reason' },
    },
  });
  assert.equal(names(calls).includes('evidence'), false);
  assert.equal(names(calls).includes('generatePdf'), false);
  assert.equal(names(calls).includes('sendInvoiceEmail'), false);
});

test('sendInvoiceDocument records failed send log and audit when PDF generation fails', async () => {
  const calls = [];
  const result = await sendInvoiceDocument({
    id: 'inv-001',
    actor: actor(),
    auditContext: auditContext(),
    ports: makePorts(calls, { pdf: { url: '/pdf-files/missing.pdf' } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: 'pdf_generation_failed' });
  const sendLog = calls.find(([name]) => name === 'sendLogCreate')?.[1];
  assert.equal(sendLog.data.status, 'failed');
  assert.equal(sendLog.data.error, 'pdf_generation_failed');
  assert.equal(names(calls).includes('sendInvoiceEmail'), false);
  assert.equal(names(calls).includes('transactionStart'), false);
  const failedAudit = calls.find(
    ([name]) => name === 'logAudit:document_send_failed',
  )?.[1];
  assert.equal(failedAudit.metadata.error, 'pdf_generation_failed');
});

test('sendPurchaseOrderDocument updates purchase order without invoice Message-ID field', async () => {
  const calls = [];
  const result = await sendPurchaseOrderDocument({
    id: 'po-001',
    actor: actor(),
    auditContext: auditContext(),
    ports: makePorts(calls),
  });

  assert.equal(result.ok, true);
  const sendLog = calls.find(([name]) => name === 'sendLogCreate')?.[1];
  assert.equal(sendLog.data.targetTable, 'purchase_orders');
  assert.deepEqual(sendLog.data.recipients, ['vendor@example.com']);
  const poUpdate = calls.find(([name]) => name === 'purchaseOrderUpdate')?.[1];
  assert.deepEqual(poUpdate.data, {
    status: 'sent',
    pdfUrl: '/pdf-files/document.pdf',
  });
});

test('retryDocumentSend creates retry log, preserves retryOf metadata, and propagates Message-ID', async () => {
  const calls = [];
  const previous = process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES;
  process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES = '0';
  try {
    const result = await retryDocumentSend({
      id: 'send-log-1',
      actor: actor(),
      auditContext: auditContext(),
      ports: makePorts(calls, {
        records: {
          sendLog: {
            id: 'send-log-1',
            kind: 'invoice',
            targetTable: 'invoices',
            targetId: 'inv-001',
            status: 'failed',
            recipients: ['fin@example.com'],
            templateId: 'invoice-default',
            metadata: {},
            updatedAt: new Date(0),
            createdAt: new Date(0),
          },
        },
      }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { status: 'ok', retryLogId: 'retry-log-1' });
    const retryLog = calls.find(([name]) => name === 'sendLogCreate')?.[1];
    assert.equal(retryLog.id, 'retry-log-1');
    assert.equal(retryLog.data.metadata.retryOf, 'send-log-1');
    assert.equal(names(calls).includes('logAudit:document_send_retried'), true);
    assert.equal(
      names(calls).includes('logAudit:document_send_completed'),
      true,
    );
    const invoiceUpdate = calls.find(([name]) => name === 'invoiceUpdate')?.[1];
    assert.equal(invoiceUpdate.data.emailMessageId, 'msg-invoice-001');
  } finally {
    if (previous === undefined) {
      delete process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES;
    } else {
      process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES = previous;
    }
  }
});

test('retryDocumentSend blocks already sent and cooldown duplicate requests before sending', async () => {
  const alreadySentCalls = [];
  const alreadySent = await retryDocumentSend({
    id: 'send-log-1',
    actor: actor(),
    auditContext: auditContext(),
    ports: makePorts(alreadySentCalls, {
      records: {
        sendLog: {
          id: 'send-log-1',
          status: 'success',
          targetTable: 'invoices',
          targetId: 'inv-001',
        },
      },
    }),
  });
  assert.equal(alreadySent.ok, false);
  assert.equal(alreadySent.statusCode, 400);
  assert.deepEqual(alreadySent.body, { error: 'already_sent' });
  assert.equal(names(alreadySentCalls).includes('generatePdf'), false);

  const cooldownCalls = [];
  const previous = process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES;
  process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES = '5';
  try {
    const retryTooSoon = await retryDocumentSend({
      id: 'send-log-1',
      actor: actor(),
      auditContext: auditContext(),
      ports: makePorts(cooldownCalls, {
        now: new Date('2026-07-13T00:01:00Z').getTime(),
        records: {
          sendLog: {
            id: 'send-log-1',
            status: 'failed',
            targetTable: 'invoices',
            targetId: 'inv-001',
            updatedAt: new Date('2026-07-13T00:00:00Z'),
            createdAt: new Date('2026-07-13T00:00:00Z'),
          },
        },
      }),
    });
    assert.equal(retryTooSoon.ok, false);
    assert.equal(retryTooSoon.statusCode, 429);
    assert.deepEqual(retryTooSoon.body, { error: 'retry_too_soon' });
    assert.equal(names(cooldownCalls).includes('generatePdf'), false);
  } finally {
    if (previous === undefined) {
      delete process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES;
    } else {
      process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES = previous;
    }
  }
});
