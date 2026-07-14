import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makePoMigrationId } from '../dist/migration/legacyIds.js';
import {
  buildPoMigrationPlannedIds,
  buildPoTaskProjectMap,
  formatPoMigrationIssues,
  formatPoMigrationSummary,
  getPoEstimateLines,
  getPoInvoiceLines,
  getPoPurchaseOrderLines,
  hasPoMigrationBlockingIssues,
  mapPoCustomer,
  mapPoEstimateHeader,
  mapPoExpense,
  mapPoInvoiceHeader,
  mapPoLineUnitPrice,
  mapPoMilestone,
  mapPoProject,
  mapPoPurchaseOrderHeader,
  mapPoTask,
  mapPoTimeEntry,
  mapPoUser,
  mapPoVendor,
  mapPoVendorInvoiceHeader,
  mapPoVendorQuoteHeader,
  normalizePoTaskInputs,
  shouldRunPoScope,
  withImportTotal,
} from '../dist/migration/poDomain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const fallbackDate = new Date('2026-07-14T00:00:00.000Z');

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function emptyInputs(overrides = {}) {
  return {
    users: [],
    customers: [],
    vendors: [],
    projects: [],
    tasks: [],
    milestones: [],
    estimates: [],
    invoices: [],
    purchase_orders: [],
    vendor_quotes: [],
    vendor_invoices: [],
    time_entries: [],
    expenses: [],
    ...overrides,
  };
}

test('poDomain is pure and does not depend on IO, process, console, or real clock/random', () => {
  const text = source('packages/backend/src/migration/poDomain.ts');

  assert.doesNotMatch(
    text,
    /from ['"]node:fs['"]|from ['"]fs['"]|require\(['"]fs['"]\)/,
  );
  assert.doesNotMatch(text, /@prisma\/client|\bPrismaClient\b|\bprisma\b/i);
  assert.doesNotMatch(text, /\bprocess\b/);
  assert.doesNotMatch(text, /\bconsole\b/);
  assert.doesNotMatch(text, /Date\.now\s*\(/);
  assert.doesNotMatch(text, /new Date\s*\(/);
  assert.doesNotMatch(text, /randomUUID\s*\(/);
  assert.doesNotMatch(text, /Math\.random\s*\(/);
});

test('planned ID generation respects dependency scopes and only filter', () => {
  const all = buildPoMigrationPlannedIds(
    emptyInputs({
      users: [{ legacyId: 'u-legacy', userId: 'user-1', userName: 'User' }],
      customers: [
        { legacyId: 'c-1', code: 'C1', name: 'Customer', status: 'active' },
      ],
      projects: [{ legacyId: 'p-1', code: 'P1', name: 'Project' }],
      purchase_orders: [
        {
          legacyId: 'po-1',
          projectLegacyId: 'p-1',
          vendorLegacyId: 'v-1',
          currency: 'JPY',
          totalAmount: 10,
        },
      ],
    }),
    null,
  );

  assert.deepEqual([...all.users], ['user-1']);
  assert.deepEqual([...all.customers], [makePoMigrationId('customer', 'c-1')]);
  assert.deepEqual([...all.projects], [makePoMigrationId('project', 'p-1')]);
  assert.deepEqual(
    [...all.purchase_orders],
    [makePoMigrationId('purchase_order', 'po-1')],
  );

  const onlyProjects = buildPoMigrationPlannedIds(
    emptyInputs({
      users: [{ legacyId: 'u-legacy', userId: 'user-1', userName: 'User' }],
      projects: [{ legacyId: 'p-1', code: 'P1', name: 'Project' }],
    }),
    new Set(['projects']),
  );
  assert.deepEqual([...onlyProjects.users], []);
  assert.deepEqual(
    [...onlyProjects.projects],
    [makePoMigrationId('project', 'p-1')],
  );

  assert.equal(shouldRunPoScope(null, 'users'), true);
  assert.equal(shouldRunPoScope(new Set(['projects']), 'users'), false);
});

test('mapPoUser preserves required-field errors and displayName fallback', () => {
  const errors = [];

  assert.equal(
    mapPoUser({ legacyId: 'u-missing', userId: ' ', userName: 'User' }, errors),
    null,
  );
  assert.equal(
    mapPoUser({ legacyId: 'u-name', userId: 'user-2', userName: ' ' }, errors),
    null,
  );
  const mapped = mapPoUser(
    {
      legacyId: 'u-1',
      userId: 'user-1',
      userName: 'login',
      email: ' user@example.com ',
      givenName: ' Taro ',
      familyName: ' Yamada ',
      active: false,
    },
    errors,
  );

  assert.deepEqual(errors, [
    { scope: 'users', legacyId: 'u-missing', message: 'userId is required' },
    { scope: 'users', legacyId: 'u-name', message: 'userName is required' },
  ]);
  assert.deepEqual(mapped.data, {
    id: 'user-1',
    userName: 'login',
    displayName: 'Taro Yamada',
    givenName: 'Taro',
    familyName: 'Yamada',
    active: false,
    emails: [{ value: 'user@example.com', primary: true }],
  });
});

test('party and project mappings keep external identifiers, defaults, and date validation', () => {
  assert.deepEqual(
    mapPoCustomer({
      legacyId: 'c-1',
      code: ' C1 ',
      name: 'Customer',
      status: 'active',
    }).data,
    {
      id: makePoMigrationId('customer', 'c-1'),
      code: ' C1 ',
      name: 'Customer',
      status: 'active',
      invoiceRegistrationId: undefined,
      taxRegion: undefined,
      billingAddress: undefined,
      externalSource: 'po',
      externalId: 'c-1',
    },
  );
  assert.deepEqual(
    mapPoVendor({
      legacyId: 'v-1',
      code: 'V1',
      name: 'Vendor',
      status: 'active',
    }).data,
    {
      id: makePoMigrationId('vendor', 'v-1'),
      code: 'V1',
      name: 'Vendor',
      status: 'active',
      bankInfo: undefined,
      taxRegion: undefined,
      externalSource: 'po',
      externalId: 'v-1',
    },
  );

  const errors = [];
  assert.equal(
    mapPoProject(
      {
        legacyId: 'p-bad',
        code: 'P',
        name: 'Bad',
        startDate: '2026-07-15',
        endDate: '2026-07-14',
      },
      errors,
    ),
    null,
  );
  assert.deepEqual(errors, [
    {
      scope: 'projects',
      legacyId: 'p-bad',
      message: 'startDate must be before or equal to endDate',
    },
  ]);

  const mapped = mapPoProject(
    {
      legacyId: 'p-1',
      code: 'P1',
      name: 'Project',
      status: 'unknown',
      customerLegacyId: 'c-1',
      parentLegacyId: 'p-root',
      currency: ' JPY ',
      planHours: '12.5',
    },
    errors,
  );
  assert.equal(mapped.id, makePoMigrationId('project', 'p-1'));
  assert.equal(mapped.customerId, makePoMigrationId('customer', 'c-1'));
  assert.equal(mapped.parentId, makePoMigrationId('project', 'p-root'));
  assert.equal(mapped.data.status, 'active');
  assert.equal(mapped.data.currency, 'JPY');
  assert.equal(mapped.data.planHours, 12.5);
});

test('task mapping normalizes parent key, progress, date ranges, and project map', () => {
  const normalized = normalizePoTaskInputs([
    {
      legacyId: 't-1',
      projectLegacyId: 'p-1',
      name: 'Task',
      parentLegacyId: ' parent ',
    },
  ]);
  assert.equal(normalized[0].parentLegacyId, 'parent');
  assert.deepEqual(
    [...buildPoTaskProjectMap(normalized)],
    [[makePoMigrationId('task', 't-1'), makePoMigrationId('project', 'p-1')]],
  );

  const errors = [];
  assert.equal(
    mapPoTask(
      {
        legacyId: 'bad-progress',
        projectLegacyId: 'p',
        name: 'Bad',
        progressPercent: 101,
      },
      errors,
    ),
    null,
  );
  assert.equal(
    mapPoTask(
      {
        legacyId: 'bad-plan',
        projectLegacyId: 'p',
        name: 'Bad',
        planStart: '2026-07-15',
        planEnd: '2026-07-14',
      },
      errors,
    ),
    null,
  );
  assert.deepEqual(
    errors.map((e) => e.message),
    [
      'progressPercent must be between 0 and 100',
      'planStart must be before or equal to planEnd',
    ],
  );

  const mapped = mapPoTask(
    {
      legacyId: 't-2',
      projectLegacyId: 'p-1',
      name: 'Task',
      progressPercent: 49.6,
      status: ' open ',
    },
    errors,
  );
  assert.equal(mapped.data.progressPercent, 50);
  assert.equal(mapped.data.status, 'open');
});

test('document header mappings use injected fallback date and preserve defaults', () => {
  const errors = [];
  const projectId = makePoMigrationId('project', 'p-1');
  const vendorId = makePoMigrationId('vendor', 'v-1');

  const estimate = mapPoEstimateHeader(
    {
      legacyId: 'e-1',
      projectLegacyId: 'p-1',
      totalAmount: '100.5',
      currency: '',
      status: 'approved',
    },
    projectId,
    fallbackDate,
    errors,
  );
  assert.equal(estimate.numberingDate, fallbackDate);
  assert.equal(estimate.currency, 'JPY');
  assert.equal(estimate.status, 'approved');
  assert.equal(estimate.version, 1);

  const invoice = mapPoInvoiceHeader(
    {
      legacyId: 'i-1',
      projectLegacyId: 'p-1',
      totalAmount: 200,
      currency: ' USD ',
      issueDate: '2026-07-01',
      estimateLegacyId: 'e-1',
      milestoneLegacyId: 'm-1',
    },
    projectId,
    fallbackDate,
    errors,
  );
  assert.equal(invoice.numberingDate.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(invoice.currency, 'USD');
  assert.equal(invoice.estimateId, makePoMigrationId('estimate', 'e-1'));
  assert.equal(invoice.milestoneId, makePoMigrationId('milestone', 'm-1'));

  const purchaseOrder = mapPoPurchaseOrderHeader(
    {
      legacyId: 'po-1',
      projectLegacyId: 'p-1',
      vendorLegacyId: 'v-1',
      totalAmount: 300,
      currency: '',
      status: 'sent',
    },
    projectId,
    vendorId,
    fallbackDate,
    errors,
  );
  assert.equal(purchaseOrder.currency, 'JPY');
  assert.equal(purchaseOrder.status, 'sent');

  const quote = mapPoVendorQuoteHeader(
    {
      legacyId: 'vq-1',
      projectLegacyId: 'p-1',
      vendorLegacyId: 'v-1',
      totalAmount: 400,
      currency: '',
    },
    projectId,
    vendorId,
    fallbackDate,
    errors,
  );
  assert.equal(quote.status, 'received');

  const vendorInvoice = mapPoVendorInvoiceHeader(
    {
      legacyId: 'vi-1',
      projectLegacyId: 'p-1',
      vendorLegacyId: 'v-1',
      totalAmount: 500,
      currency: '',
    },
    projectId,
    vendorId,
    fallbackDate,
    errors,
  );
  assert.equal(vendorInvoice.status, 'received');
  assert.deepEqual(errors, []);

  assert.equal(
    mapPoEstimateHeader(
      {
        legacyId: 'e-bad',
        projectLegacyId: 'p-1',
        totalAmount: -1,
        currency: 'JPY',
      },
      projectId,
      fallbackDate,
      errors,
    ),
    null,
  );
  assert.equal(errors.at(-1).message, 'totalAmount must be >= 0');
});

test('line defaults and line validation preserve current imported fallback behavior', () => {
  assert.deepEqual(
    getPoEstimateLines(
      {
        legacyId: 'e-1',
        projectLegacyId: 'p',
        totalAmount: 10,
        currency: 'JPY',
      },
      10,
    ),
    [
      {
        description: 'Imported (e-1)',
        quantity: 1,
        unitPrice: 10,
        taxRate: null,
        taskLegacyId: null,
      },
    ],
  );
  assert.deepEqual(
    getPoInvoiceLines(
      {
        legacyId: 'i-1',
        projectLegacyId: 'p',
        totalAmount: 20,
        currency: 'JPY',
      },
      20,
    ),
    [
      {
        description: 'Imported (i-1)',
        quantity: 1,
        unitPrice: 20,
        taxRate: null,
        taskLegacyId: null,
        timeEntryRange: null,
      },
    ],
  );
  assert.deepEqual(
    getPoPurchaseOrderLines(
      {
        legacyId: 'po-1',
        projectLegacyId: 'p',
        vendorLegacyId: 'v',
        totalAmount: 30,
        currency: 'JPY',
      },
      30,
    ),
    [
      {
        description: 'Imported (po-1)',
        quantity: 1,
        unitPrice: 30,
        taxRate: null,
        taskLegacyId: null,
        expenseLegacyId: null,
      },
    ],
  );

  const errors = [];
  assert.equal(mapPoLineUnitPrice('estimates', 'e-1', '-1', errors), null);
  assert.equal(errors[0].message, 'line.unitPrice must be >= 0');
  assert.equal(mapPoLineUnitPrice('estimates', 'e-1', '12.5', errors), 12.5);
});

test('time entry and expense mappings preserve date/amount validation and statuses', () => {
  const errors = [];
  const projectId = makePoMigrationId('project', 'p-1');
  const taskId = makePoMigrationId('task', 't-1');

  assert.equal(
    mapPoTimeEntry(
      {
        legacyId: 'te-bad',
        projectLegacyId: 'p',
        userId: 'u',
        workDate: 'x',
        minutes: 1,
      },
      projectId,
      null,
      errors,
    ),
    null,
  );
  assert.equal(
    mapPoExpense(
      {
        legacyId: 'ex-bad',
        projectLegacyId: 'p',
        userId: 'u',
        category: 'travel',
        amount: -1,
        currency: 'JPY',
        incurredOn: '2026-07-14',
      },
      projectId,
      errors,
    ),
    null,
  );
  assert.deepEqual(
    errors.map((e) => e.message),
    ['invalid workDate', 'amount must be >= 0'],
  );

  const timeEntry = mapPoTimeEntry(
    {
      legacyId: 'te-1',
      projectLegacyId: 'p',
      userId: 'u',
      workDate: '2026-07-14',
      minutes: 59.6,
      taskLegacyId: 't-1',
      status: 'approved',
    },
    projectId,
    taskId,
    errors,
  );
  assert.equal(timeEntry.data.minutes, 60);
  assert.equal(timeEntry.data.status, 'approved');
  assert.equal(timeEntry.data.taskId, taskId);

  const expense = mapPoExpense(
    {
      legacyId: 'ex-1',
      projectLegacyId: 'p',
      userId: 'u',
      category: 'travel',
      amount: 10,
      currency: 'JPY',
      incurredOn: '2026-07-14',
      isShared: true,
      status: 'approved',
    },
    projectId,
    errors,
  );
  assert.equal(expense.data.isShared, true);
  assert.equal(expense.data.status, 'approved');
});

test('report helpers keep summary and issue schema stable', () => {
  const summary = { users: withImportTotal({ created: 1, updated: 2 }, 3) };
  const issues = [
    {
      scope: 'users',
      legacyId: 'u-1',
      message: 'missing required field: userName',
    },
    { scope: 'projects', legacyId: 'p-1', message: 'project not found: p-0' },
  ];

  assert.equal(
    formatPoMigrationSummary(summary),
    JSON.stringify(summary, null, 2),
  );
  assert.equal(
    formatPoMigrationIssues(issues, 1),
    JSON.stringify(issues.slice(0, 1), null, 2),
  );
  assert.equal(hasPoMigrationBlockingIssues([]), false);
  assert.equal(hasPoMigrationBlockingIssues(issues), true);
});
