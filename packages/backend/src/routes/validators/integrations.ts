import { Type } from '@sinclair/typebox';
import { booleanQuerySchema } from './shared.js';

export const integrationRunMetricsQuerySchema = {
  querystring: Type.Object(
    {
      settingId: Type.Optional(Type.String({ minLength: 1 })),
      days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    },
    { additionalProperties: false },
  ),
};

const leaveExportTargetSchema = Type.Union([
  Type.Literal('attendance'),
  Type.Literal('payroll'),
]);

const hrEmployeeMasterExportFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
]);

const hrAttendanceExportFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
]);

const accountingIcsExportFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
  Type.Literal('ics_template'),
]);

const integrationReconciliationDetailsFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
]);

const accountingPeriodKeyLooseSchema = Type.String({
  minLength: 1,
  maxLength: 7,
});

const integrationExportJobKindSchema = Type.Union([
  Type.Literal('hr_leave_export_attendance'),
  Type.Literal('hr_leave_export_payroll'),
  Type.Literal('hr_employee_master_export'),
  Type.Literal('hr_attendance_export'),
  Type.Literal('accounting_ics_export'),
]);

const accountingMappingRuleBodySchema = Type.Object(
  {
    mappingKey: Type.String({ minLength: 1, maxLength: 200 }),
    debitAccountCode: Type.String({ minLength: 1, maxLength: 100 }),
    debitAccountName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    debitSubaccountCode: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
    requireDebitSubaccountCode: Type.Optional(Type.Boolean()),
    creditAccountCode: Type.String({ minLength: 1, maxLength: 100 }),
    creditAccountName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    creditSubaccountCode: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
    requireCreditSubaccountCode: Type.Optional(Type.Boolean()),
    departmentCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    requireDepartmentCode: Type.Optional(Type.Boolean()),
    taxCode: Type.String({ minLength: 1, maxLength: 100 }),
    isActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const statutoryAccountingActualAmountTypeSchema = Type.Union([
  Type.Literal('revenue'),
  Type.Literal('direct_cost'),
  Type.Literal('labor_cost'),
  Type.Literal('vendor_cost'),
  Type.Literal('expense_cost'),
]);

const statutoryAccountingActualImportRowSchema = Type.Object(
  {
    rowNo: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    sourceRef: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    projectCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    departmentCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    accountCode: Type.String({ minLength: 1, maxLength: 100 }),
    accountName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    amountType: statutoryAccountingActualAmountTypeSchema,
    currency: Type.String({ pattern: '^[A-Z]{3}$' }),
    amount: Type.Union([
      Type.Number({ exclusiveMinimum: 0 }),
      Type.String({ minLength: 1, maxLength: 100 }),
    ]),
  },
  { additionalProperties: false },
);

export const integrationHrLeaveExportQuerySchema = {
  querystring: Type.Object(
    {
      target: Type.Optional(leaveExportTargetSchema),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrLeaveExportDispatchSchema = {
  body: Type.Object(
    {
      target: leaveExportTargetSchema,
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrLeaveExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      target: Type.Optional(leaveExportTargetSchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrEmployeeMasterExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(hrEmployeeMasterExportFormatSchema),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrEmployeeMasterExportDispatchSchema = {
  body: Type.Object(
    {
      format: Type.Optional(Type.Literal('csv')),
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrEmployeeMasterExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

const attendanceClosingPeriodKeySchema = Type.String({
  pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
});

export const integrationHrAttendanceExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(hrAttendanceExportFormatSchema),
      periodKey: attendanceClosingPeriodKeySchema,
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceExportDispatchSchema = {
  body: Type.Object(
    {
      format: Type.Optional(Type.Literal('csv')),
      periodKey: attendanceClosingPeriodKeySchema,
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: Type.Optional(attendanceClosingPeriodKeySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingIcsExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(accountingIcsExportFormatSchema),
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      companyCode: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
      companyName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      fiscalYearStartMonth: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 12 }),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingIcsExportDispatchSchema = {
  body: Type.Object(
    {
      format: Type.Optional(
        Type.Union([Type.Literal('csv'), Type.Literal('ics_template')]),
      ),
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      companyCode: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
      companyName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      fiscalYearStartMonth: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 12 }),
      ),
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingIcsExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      status: Type.Optional(
        Type.Union([
          Type.Literal('running'),
          Type.Literal('success'),
          Type.Literal('failed'),
        ]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingMappingRuleListQuerySchema = {
  querystring: Type.Object(
    {
      mappingKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      isActive: Type.Optional(booleanQuerySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingMappingRuleCreateSchema = {
  body: accountingMappingRuleBodySchema,
};

export const integrationAccountingMappingRulePatchSchema = {
  params: Type.Object(
    {
      id: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  body: Type.Partial(accountingMappingRuleBodySchema, {
    additionalProperties: false,
  }),
};

export const integrationAccountingMappingRuleReapplySchema = {
  body: Type.Object(
    {
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      mappingKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationStatutoryAccountingActualImportSchema = {
  body: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
      importBatchKey: Type.String({ minLength: 1, maxLength: 200 }),
      accountingSystem: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 100 }),
          Type.Null(),
        ]),
      ),
      rows: Type.Array(statutoryAccountingActualImportRowSchema, {
        minItems: 1,
        maxItems: 1000,
      }),
    },
    { additionalProperties: false },
  ),
};

export const integrationExportJobListQuerySchema = {
  querystring: Type.Object(
    {
      kind: Type.Optional(integrationExportJobKindSchema),
      status: Type.Optional(
        Type.Union([
          Type.Literal('running'),
          Type.Literal('success'),
          Type.Literal('failed'),
        ]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationExportJobRedispatchSchema = {
  params: Type.Object(
    {
      kind: integrationExportJobKindSchema,
      id: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  body: Type.Object(
    {
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceClosingCreateSchema = {
  body: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
      reclose: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceClosingListQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: Type.Optional(attendanceClosingPeriodKeySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceClosingSummaryListSchema = {
  params: Type.Object(
    {
      id: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  querystring: Type.Object(
    {
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationReconciliationSummaryQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
    },
    { additionalProperties: false },
  ),
};

export const integrationReconciliationDetailsQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
      format: Type.Optional(integrationReconciliationDetailsFormatSchema),
    },
    { additionalProperties: false },
  ),
};
