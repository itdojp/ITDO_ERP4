import assert from 'node:assert/strict';
import test from 'node:test';

import { stageAccountingEventForApproval } from '../dist/services/accountingEvents.js';

function createAccountingClient(overrides = {}) {
  const eventCalls = [];
  const stagingCalls = [];
  const client = {
    expense: {
      findUnique: async () => null,
    },
    invoice: {
      findUnique: async () => null,
    },
    vendorInvoice: {
      findUnique: async () => null,
    },
    project: {
      findUnique: async () => null,
    },
    userAccount: {
      findUnique: async () => null,
    },
    employeePayrollProfile: {
      findUnique: async () => null,
    },
    vendor: {
      findUnique: async () => null,
    },
    accountingMappingRule: {
      findMany: async () => [],
    },
    accountingEvent: {
      upsert: async (args) => {
        eventCalls.push(args);
        return { id: `event-${eventCalls.length}` };
      },
    },
    accountingJournalStaging: {
      upsert: async (args) => {
        stagingCalls.push(args);
        return { id: `staging-${stagingCalls.length}` };
      },
    },
    ...overrides,
  };
  return { client, eventCalls, stagingCalls };
}

test('stageAccountingEventForApproval creates invoice approved staging with pending mapping', async () => {
  const { client, eventCalls, stagingCalls } = createAccountingClient({
    invoice: {
      findUnique: async () => ({
        id: 'inv-001',
        projectId: 'proj-001',
        invoiceNo: 'INV-001',
        totalAmount: '55000',
        currency: 'JPY',
      }),
    },
    project: {
      findUnique: async () => ({
        code: 'PRJ-001',
        customer: { code: 'CUST-001' },
      }),
    },
  });

  const created = await stageAccountingEventForApproval({
    client,
    targetTable: 'invoices',
    targetId: 'inv-001',
    eventAt: new Date('2026-03-15T00:00:00.000Z'),
    approvalInstanceId: 'approval-001',
    actorUserId: 'approver-001',
  });

  assert.equal(created, true);
  assert.equal(eventCalls[0]?.create?.eventKind, 'invoice_approved');
  assert.equal(eventCalls[0]?.create?.customerCode, 'CUST-001');
  assert.equal(eventCalls[0]?.create?.externalRef, 'INV-001');
  assert.equal(
    eventCalls[0]?.create?.payload?.approvalInstanceId,
    'approval-001',
  );
  assert.equal(stagingCalls[0]?.create?.status, 'pending_mapping');
  assert.equal(stagingCalls[0]?.create?.mappingKey, 'invoice_approved:default');
});

test('stageAccountingEventForApproval applies active mapping rule when available', async () => {
  const { client, stagingCalls } = createAccountingClient({
    invoice: {
      findUnique: async () => ({
        id: 'inv-002',
        projectId: 'proj-001',
        invoiceNo: 'INV-002',
        totalAmount: '75000',
        currency: 'JPY',
      }),
    },
    project: {
      findUnique: async () => ({
        code: 'PRJ-001',
        customer: { code: 'CUST-001' },
      }),
    },
    accountingMappingRule: {
      findMany: async () => [
        {
          id: 'rule-001',
          mappingKey: 'invoice_approved:default',
          debitAccountCode: '1110',
          debitSubaccountCode: null,
          creditAccountCode: '4110',
          creditSubaccountCode: null,
          departmentCode: 'DEPT-001',
          taxCode: 'TAX-001',
          isActive: true,
        },
      ],
    },
  });

  const created = await stageAccountingEventForApproval({
    client,
    targetTable: 'invoices',
    targetId: 'inv-002',
    eventAt: new Date('2026-03-15T00:00:00.000Z'),
  });

  assert.equal(created, true);
  assert.equal(stagingCalls[0]?.create?.status, 'ready');
  assert.equal(stagingCalls[0]?.create?.debitAccountCode, '1110');
  assert.equal(stagingCalls[0]?.create?.creditAccountCode, '4110');
  assert.equal(stagingCalls[0]?.create?.taxCode, 'TAX-001');
  assert.equal(stagingCalls[0]?.create?.departmentCode, 'DEPT-001');
  assert.deepEqual(stagingCalls[0]?.create?.validationErrors, []);
});

test('stageAccountingEventForApproval blocks expense approval staging when employee code is missing', async () => {
  const { client, eventCalls, stagingCalls } = createAccountingClient({
    expense: {
      findUnique: async () => ({
        id: 'exp-001',
        projectId: 'proj-001',
        userId: 'user-001',
        category: '交通費',
        amount: '12000',
        currency: 'JPY',
      }),
    },
    project: {
      findUnique: async () => ({
        code: 'PRJ-001',
        customer: { code: 'CUST-001' },
      }),
    },
    userAccount: {
      findUnique: async () => ({
        employeeCode: null,
      }),
    },
    employeePayrollProfile: {
      findUnique: async () => ({
        departmentCode: 'DEPT-001',
      }),
    },
  });

  const created = await stageAccountingEventForApproval({
    client,
    targetTable: 'expenses',
    targetId: 'exp-001',
    eventAt: new Date('2026-03-15T00:00:00.000Z'),
  });

  assert.equal(created, true);
  assert.equal(eventCalls[0]?.create?.eventKind, 'expense_approved');
  assert.equal(eventCalls[0]?.create?.employeeCode, null);
  assert.equal(stagingCalls[0]?.create?.status, 'blocked');
  assert.deepEqual(stagingCalls[0]?.create?.validationErrors, [
    { code: 'employee_code_missing' },
    {
      code: 'mapping_pending',
      mappingKey: 'expense_approved:交通費',
      requiredFields: ['debitAccountCode', 'creditAccountCode', 'taxCode'],
    },
  ]);
});

test('stageAccountingEventForApproval creates vendor invoice approved staging with vendor code', async () => {
  const { client, eventCalls, stagingCalls } = createAccountingClient({
    vendorInvoice: {
      findUnique: async () => ({
        id: 'vin-001',
        projectId: 'proj-001',
        vendorId: 'vendor-001',
        vendorInvoiceNo: 'VIN-001',
        totalAmount: '33000',
        currency: 'JPY',
      }),
    },
    project: {
      findUnique: async () => ({
        code: 'PRJ-001',
        customer: { code: 'CUST-001' },
      }),
    },
    vendor: {
      findUnique: async () => ({
        code: 'VENDOR-001',
      }),
    },
  });

  const created = await stageAccountingEventForApproval({
    client,
    targetTable: 'vendor_invoices',
    targetId: 'vin-001',
    eventAt: new Date('2026-03-15T00:00:00.000Z'),
  });

  assert.equal(created, true);
  assert.equal(eventCalls[0]?.create?.eventKind, 'vendor_invoice_approved');
  assert.equal(eventCalls[0]?.create?.vendorCode, 'VENDOR-001');
  assert.equal(stagingCalls[0]?.create?.status, 'pending_mapping');
  assert.equal(
    stagingCalls[0]?.create?.mappingKey,
    'vendor_invoice_approved:default',
  );
});

test('stageAccountingEventForApproval ignores unsupported target tables', async () => {
  const { client, eventCalls, stagingCalls } = createAccountingClient();
  const created = await stageAccountingEventForApproval({
    client,
    targetTable: 'purchase_orders',
    targetId: 'po-001',
  });
  assert.equal(created, null);
  assert.equal(eventCalls.length, 0);
  assert.equal(stagingCalls.length, 0);
});
