import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';

import {
  AccountingMappingRuleServiceError,
  createAccountingMappingRule,
  listAccountingMappingRules,
  normalizeAccountingMappingRuleInput,
  reapplyAccountingMappingRulesWithAudit,
  updateAccountingMappingRule,
} from '../dist/services/accountingMappingRules.js';

function mappingRuleRecord(overrides = {}) {
  return {
    id: 'rule-001',
    mappingKey: 'invoice_approved:default',
    debitAccountCode: '1110',
    debitAccountName: '売掛金',
    debitSubaccountCode: null,
    requireDebitSubaccountCode: false,
    creditAccountCode: '4110',
    creditAccountName: '売上高',
    creditSubaccountCode: null,
    requireCreditSubaccountCode: false,
    departmentCode: null,
    requireDepartmentCode: false,
    taxCode: 'TAX-001',
    isActive: true,
    createdAt: new Date('2026-03-17T00:00:00.000Z'),
    updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    ...overrides,
  };
}

test('normalizeAccountingMappingRuleInput trims required fields and reports missing fields', () => {
  const normalized = normalizeAccountingMappingRuleInput(
    {
      mappingKey: ' invoice_approved:default ',
      debitAccountCode: ' 1110 ',
      creditAccountCode: ' ',
      debitAccountName: ' ',
      taxCode: ' TAX-001 ',
    },
    { partial: false },
  );

  assert.deepEqual(normalized.invalidFields, ['creditAccountCode']);
  assert.equal(normalized.data.mappingKey, 'invoice_approved:default');
  assert.equal(normalized.data.debitAccountCode, '1110');
  assert.equal(normalized.data.debitAccountName, null);
  assert.equal(normalized.data.taxCode, 'TAX-001');
});

test('listAccountingMappingRules normalizes filters and pagination in service', async () => {
  let capturedFindMany = null;
  const client = {
    accountingMappingRule: {
      findMany: async (args) => {
        capturedFindMany = args;
        return [mappingRuleRecord()];
      },
    },
  };

  const result = await listAccountingMappingRules(
    {
      query: {
        mappingKey: ' invoice ',
        isActive: 'true',
        limit: '10',
        offset: '2',
      },
    },
    { client },
  );

  assert.equal(result.limit, 10);
  assert.equal(result.offset, 2);
  assert.equal(result.items[0].mappingKey, 'invoice_approved:default');
  assert.deepEqual(capturedFindMany.where, {
    mappingKey: { contains: 'invoice' },
    isActive: true,
  });
  assert.equal(capturedFindMany.take, 10);
  assert.equal(capturedFindMany.skip, 2);
});

test('createAccountingMappingRule writes normalized data and audit entry', async () => {
  let capturedCreate = null;
  const auditEntries = [];
  const client = {
    accountingMappingRule: {
      create: async (args) => {
        capturedCreate = args;
        return mappingRuleRecord({
          id: 'rule-created',
          ...args.data,
        });
      },
    },
  };

  const result = await createAccountingMappingRule(
    {
      body: {
        mappingKey: ' expense_approved:交通費 ',
        debitAccountCode: ' 7110 ',
        debitAccountName: ' 旅費交通費 ',
        creditAccountCode: ' 1110 ',
        creditAccountName: ' 普通預金 ',
        departmentCode: ' ',
        requireDepartmentCode: true,
        taxCode: ' TAX-EXP ',
      },
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user', requestId: 'req-001' },
    },
    {
      client,
      logAudit: async (entry) => auditEntries.push(entry),
    },
  );

  assert.equal(result.id, 'rule-created');
  assert.equal(capturedCreate.data.mappingKey, 'expense_approved:交通費');
  assert.equal(capturedCreate.data.debitAccountCode, '7110');
  assert.equal(capturedCreate.data.creditAccountName, '普通預金');
  assert.equal(capturedCreate.data.departmentCode, null);
  assert.equal(capturedCreate.data.requireDepartmentCode, true);
  assert.equal(capturedCreate.data.createdBy, 'admin-user');
  assert.equal(capturedCreate.data.updatedBy, 'admin-user');
  assert.equal(auditEntries.length, 1);
  assert.equal(
    auditEntries[0].action,
    'integration_accounting_mapping_rule_created',
  );
  assert.equal(auditEntries[0].targetId, 'rule-created');
  assert.equal(auditEntries[0].metadata.mappingKey, 'expense_approved:交通費');
});

test('createAccountingMappingRule rejects invalid payload before writing', async () => {
  const client = {
    accountingMappingRule: {
      create: async () => {
        throw new Error('create should not be called');
      },
    },
  };

  await assert.rejects(
    () =>
      createAccountingMappingRule(
        {
          body: {
            mappingKey: ' ',
            debitAccountCode: '1110',
            creditAccountCode: '4110',
            taxCode: 'TAX-001',
          },
        },
        { client },
      ),
    (error) => {
      assert.ok(error instanceof AccountingMappingRuleServiceError);
      assert.equal(error.code, 'invalid_accounting_mapping_rule_payload');
      assert.deepEqual(error.responseBody.invalidFields, ['mappingKey']);
      return true;
    },
  );
});

test('createAccountingMappingRule maps unique constraint races to conflict error', async () => {
  const client = {
    accountingMappingRule: {
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['mappingKey'] },
        });
      },
    },
  };

  await assert.rejects(
    () =>
      createAccountingMappingRule(
        {
          body: {
            mappingKey: 'invoice_approved:default',
            debitAccountCode: '1110',
            creditAccountCode: '4110',
            taxCode: 'TAX-001',
          },
        },
        { client },
      ),
    (error) => {
      assert.ok(error instanceof AccountingMappingRuleServiceError);
      assert.equal(error.code, 'accounting_mapping_rule_exists');
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
});

test('updateAccountingMappingRule returns service not-found error', async () => {
  const client = {
    accountingMappingRule: {
      findUnique: async () => null,
      update: async () => {
        throw new Error('update should not be called');
      },
    },
  };

  await assert.rejects(
    () =>
      updateAccountingMappingRule(
        {
          id: 'missing-rule',
          body: { isActive: false },
          actorUserId: 'admin-user',
        },
        { client },
      ),
    (error) => {
      assert.ok(error instanceof AccountingMappingRuleServiceError);
      assert.equal(error.code, 'accounting_mapping_rule_not_found');
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test('updateAccountingMappingRule writes normalized data and audit before/after metadata', async () => {
  let capturedUpdate = null;
  const auditEntries = [];
  const client = {
    accountingMappingRule: {
      findUnique: async () =>
        mappingRuleRecord({
          id: 'rule-001',
          mappingKey: 'invoice_approved:default',
          isActive: true,
        }),
      update: async (args) => {
        capturedUpdate = args;
        return mappingRuleRecord({
          id: 'rule-001',
          mappingKey: 'invoice_approved:special',
          isActive: false,
          ...args.data,
        });
      },
    },
  };

  const result = await updateAccountingMappingRule(
    {
      id: ' rule-001 ',
      body: {
        mappingKey: ' invoice_approved:special ',
        debitAccountName: ' 未収入金 ',
        isActive: false,
      },
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user', requestId: 'req-003' },
    },
    {
      client,
      logAudit: async (entry) => auditEntries.push(entry),
    },
  );

  assert.equal(result.mappingKey, 'invoice_approved:special');
  assert.equal(result.debitAccountName, '未収入金');
  assert.equal(result.isActive, false);
  assert.equal(capturedUpdate.where.id, 'rule-001');
  assert.equal(capturedUpdate.data.mappingKey, 'invoice_approved:special');
  assert.equal(capturedUpdate.data.debitAccountName, '未収入金');
  assert.equal(capturedUpdate.data.updatedBy, 'admin-user');
  assert.equal(auditEntries.length, 1);
  assert.equal(
    auditEntries[0].action,
    'integration_accounting_mapping_rule_updated',
  );
  assert.deepEqual(auditEntries[0].metadata.before, {
    mappingKey: 'invoice_approved:default',
    isActive: true,
  });
  assert.deepEqual(auditEntries[0].metadata.after, {
    mappingKey: 'invoice_approved:special',
    isActive: false,
  });
});

test('reapplyAccountingMappingRulesWithAudit revalidates rows and records audit metadata', async () => {
  const updateCalls = [];
  const auditEntries = [];
  const client = {
    accountingJournalStaging: {
      findMany: async (args) => {
        assert.equal(args.where.event.periodKey, '2026-03');
        assert.equal(args.take, 50);
        assert.equal(args.skip, 0);
        return [
          {
            id: 'stg-001',
            mappingKey: 'invoice_approved:default',
            departmentCode: 'OLD-DEPT',
            validationErrors: [],
          },
        ];
      },
      update: async (args) => {
        updateCalls.push(args);
        return { id: args.where.id };
      },
    },
    accountingMappingRule: {
      findMany: async () => [
        mappingRuleRecord({
          departmentCode: 'D001',
          requireDepartmentCode: true,
        }),
      ],
    },
  };

  const result = await reapplyAccountingMappingRulesWithAudit(
    {
      body: { periodKey: '2026-03', limit: 50, offset: 0 },
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user', requestId: 'req-002' },
    },
    {
      client,
      logAudit: async (entry) => auditEntries.push(entry),
    },
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.readyCount, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].data.status, 'ready');
  assert.equal(updateCalls[0].data.departmentCode, 'D001');
  assert.equal(updateCalls[0].data.updatedBy, 'admin-user');
  assert.deepEqual(updateCalls[0].data.validationErrors, []);
  assert.equal(auditEntries.length, 1);
  assert.equal(
    auditEntries[0].action,
    'integration_accounting_mapping_rule_reapplied',
  );
  assert.equal(auditEntries[0].targetId, '2026-03');
  assert.equal(auditEntries[0].metadata.readyCount, 1);
});

test('reapplyAccountingMappingRulesWithAudit rejects invalid period keys', async () => {
  const client = {
    accountingJournalStaging: {
      findMany: async () => {
        throw new Error('findMany should not be called');
      },
    },
    accountingMappingRule: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () =>
      reapplyAccountingMappingRulesWithAudit(
        { body: { periodKey: '2026-13' } },
        { client },
      ),
    (error) => {
      assert.ok(error instanceof AccountingMappingRuleServiceError);
      assert.equal(error.code, 'invalid_period_key');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});
