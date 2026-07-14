import { makePoMigrationId as makeId } from './legacyIds.js';
import {
  type ImportError,
  normalizeLines,
  normalizeString,
  parseDate,
  parseEnumValue,
  parseNumber,
} from './poInput.js';

export const DOC_STATUS_VALUES = [
  'draft',
  'pending_qa',
  'pending_exec',
  'approved',
  'rejected',
  'sent',
  'paid',
  'cancelled',
  'received',
  'acknowledged',
] as const;
export const PROJECT_STATUS_VALUES = [
  'draft',
  'active',
  'on_hold',
  'closed',
] as const;
export const TIME_STATUS_VALUES = [
  'submitted',
  'approved',
  'rejected',
] as const;

export type DocStatus = (typeof DOC_STATUS_VALUES)[number];
export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];
export type TimeStatus = (typeof TIME_STATUS_VALUES)[number];

export const PO_MIGRATION_ENTITY_ORDER = [
  'users',
  'customers',
  'vendors',
  'projects',
  'tasks',
  'milestones',
  'estimates',
  'invoices',
  'purchase_orders',
  'vendor_quotes',
  'vendor_invoices',
  'time_entries',
  'expenses',
] as const;

export type PoMigrationScope = (typeof PO_MIGRATION_ENTITY_ORDER)[number];

export type PlannedIds = Record<PoMigrationScope, Set<string>>;

export type ImportResult = { created: number; updated: number };
export type ImportSummary = Record<string, ImportResult & { total: number }>;

export type CustomerInput = {
  legacyId: string;
  code: string;
  name: string;
  status: string;
  invoiceRegistrationId?: string | null;
  taxRegion?: string | null;
  billingAddress?: string | null;
};

export type UserInput = {
  legacyId: string;
  userId: string;
  userName: string;
  email?: string | null;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  active?: boolean | null;
};

export type VendorInput = {
  legacyId: string;
  code: string;
  name: string;
  status: string;
  bankInfo?: string | null;
  taxRegion?: string | null;
};

export type ProjectInput = {
  legacyId: string;
  code: string;
  name: string;
  status?: ProjectStatus;
  projectType?: string | null;
  parentLegacyId?: string | null;
  customerLegacyId?: string | null;
  ownerUserId?: string | null;
  orgUnitId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string | null;
  planHours?: number | null;
  budgetCost?: number | null;
};

export type TaskInput = {
  legacyId: string;
  projectLegacyId: string;
  name: string;
  status?: string | null;
  assigneeId?: string | null;
  parentLegacyId?: string | null;
  progressPercent?: number | null;
  planStart?: string | null;
  planEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
};

export type MilestoneInput = {
  legacyId: string;
  projectLegacyId: string;
  name: string;
  amount: number;
  currency?: string | null;
  billUpon?: string | null;
  dueDate?: string | null;
  taxRate?: number | null;
};

export type TimeEntryInput = {
  legacyId: string;
  projectLegacyId: string;
  userId: string;
  workDate: string;
  minutes: number;
  taskLegacyId?: string | null;
  workType?: string | null;
  location?: string | null;
  notes?: string | null;
  status?: TimeStatus;
};

export type ExpenseInput = {
  legacyId: string;
  projectLegacyId: string;
  userId: string;
  category: string;
  amount: number;
  currency: string;
  incurredOn: string;
  isShared?: boolean;
  receiptUrl?: string | null;
  status?: DocStatus;
};

export type EstimateLineInput = {
  description: string;
  quantity?: number | null;
  unitPrice: number;
  taxRate?: number | null;
  taskLegacyId?: string | null;
};

export type EstimateInput = {
  legacyId: string;
  projectLegacyId: string;
  estimateNo?: string | null;
  numberingDate?: string | null;
  version?: number | null;
  totalAmount: number;
  currency: string;
  status?: DocStatus;
  validUntil?: string | null;
  notes?: string | null;
  lines?: EstimateLineInput[] | null;
};

export type BillingLineInput = {
  description: string;
  quantity?: number | null;
  unitPrice: number;
  taxRate?: number | null;
  taskLegacyId?: string | null;
  timeEntryRange?: string | null;
};

export type InvoiceInput = {
  legacyId: string;
  projectLegacyId: string;
  invoiceNo?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  estimateLegacyId?: string | null;
  milestoneLegacyId?: string | null;
  lines?: BillingLineInput[] | null;
};

export type PurchaseOrderLineInput = {
  description: string;
  quantity?: number | null;
  unitPrice: number;
  taxRate?: number | null;
  taskLegacyId?: string | null;
  expenseLegacyId?: string | null;
};

export type PurchaseOrderInput = {
  legacyId: string;
  projectLegacyId: string;
  vendorLegacyId: string;
  poNo?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  lines?: PurchaseOrderLineInput[] | null;
};

export type VendorQuoteInput = {
  legacyId: string;
  projectLegacyId: string;
  vendorLegacyId: string;
  quoteNo?: string | null;
  issueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  documentUrl?: string | null;
};

export type VendorInvoiceInput = {
  legacyId: string;
  projectLegacyId: string;
  vendorLegacyId: string;
  vendorInvoiceNo?: string | null;
  receivedDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  documentUrl?: string | null;
};

export type PoMigrationInputs = {
  users: UserInput[];
  customers: CustomerInput[];
  vendors: VendorInput[];
  projects: ProjectInput[];
  tasks: TaskInput[];
  milestones: MilestoneInput[];
  estimates: EstimateInput[];
  invoices: InvoiceInput[];
  purchase_orders: PurchaseOrderInput[];
  vendor_quotes: VendorQuoteInput[];
  vendor_invoices: VendorInvoiceInput[];
  time_entries: TimeEntryInput[];
  expenses: ExpenseInput[];
};

export function shouldRunPoScope(
  only: ReadonlySet<string> | null,
  key: string,
): boolean {
  return !only || only.has(key);
}

export function createEmptyPlannedIds(): PlannedIds {
  return Object.fromEntries(
    PO_MIGRATION_ENTITY_ORDER.map((scope) => [scope, new Set<string>()]),
  ) as PlannedIds;
}

export function buildPoMigrationPlannedIds(
  inputs: PoMigrationInputs,
  only: ReadonlySet<string> | null,
): PlannedIds {
  const planned = createEmptyPlannedIds();
  if (shouldRunPoScope(only, 'users')) {
    inputs.users.forEach((item) => planned.users.add(item.userId));
  }
  if (shouldRunPoScope(only, 'customers')) {
    inputs.customers.forEach((item) =>
      planned.customers.add(makeId('customer', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'vendors')) {
    inputs.vendors.forEach((item) =>
      planned.vendors.add(makeId('vendor', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'projects')) {
    inputs.projects.forEach((item) =>
      planned.projects.add(makeId('project', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'tasks')) {
    inputs.tasks.forEach((item) =>
      planned.tasks.add(makeId('task', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'milestones')) {
    inputs.milestones.forEach((item) =>
      planned.milestones.add(makeId('milestone', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'estimates')) {
    inputs.estimates.forEach((item) =>
      planned.estimates.add(makeId('estimate', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'invoices')) {
    inputs.invoices.forEach((item) =>
      planned.invoices.add(makeId('invoice', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'purchase_orders')) {
    inputs.purchase_orders.forEach((item) =>
      planned.purchase_orders.add(makeId('purchase_order', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'vendor_quotes')) {
    inputs.vendor_quotes.forEach((item) =>
      planned.vendor_quotes.add(makeId('vendor_quote', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'vendor_invoices')) {
    inputs.vendor_invoices.forEach((item) =>
      planned.vendor_invoices.add(makeId('vendor_invoice', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'time_entries')) {
    inputs.time_entries.forEach((item) =>
      planned.time_entries.add(makeId('time_entry', item.legacyId)),
    );
  }
  if (shouldRunPoScope(only, 'expenses')) {
    inputs.expenses.forEach((item) =>
      planned.expenses.add(makeId('expense', item.legacyId)),
    );
  }
  return planned;
}

export function withImportTotal(
  result: ImportResult,
  total: number,
): ImportResult & { total: number } {
  return { ...result, total };
}

export function formatPoMigrationSummary(summary: ImportSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function formatPoMigrationIssues(
  issues: ImportError[],
  limit = 50,
): string {
  return JSON.stringify(issues.slice(0, limit), null, 2);
}

export function hasPoMigrationBlockingIssues(issues: ImportError[]): boolean {
  return issues.length > 0;
}

export function mapPoUser(item: UserInput, errors: ImportError[]) {
  const id = normalizeString(item.userId);
  if (!id) {
    errors.push({
      scope: 'users',
      legacyId: item.legacyId,
      message: 'userId is required',
    });
    return null;
  }
  const userName = normalizeString(item.userName);
  if (!userName) {
    errors.push({
      scope: 'users',
      legacyId: item.legacyId,
      message: 'userName is required',
    });
    return null;
  }
  const email = normalizeString(item.email) ?? undefined;
  const givenName = normalizeString(item.givenName) ?? undefined;
  const familyName = normalizeString(item.familyName) ?? undefined;
  const fallbackDisplayName = [givenName, familyName].filter(Boolean).join(' ');
  const displayName =
    normalizeString(item.displayName) ??
    (fallbackDisplayName ? fallbackDisplayName : undefined);
  return {
    id,
    data: {
      id,
      userName,
      displayName,
      givenName,
      familyName,
      active: item.active ?? true,
      emails: email ? [{ value: email, primary: true }] : undefined,
    },
  };
}

export function mapPoCustomer(item: CustomerInput) {
  const id = makeId('customer', item.legacyId);
  return {
    id,
    data: {
      id,
      code: item.code,
      name: item.name,
      status: item.status,
      invoiceRegistrationId:
        normalizeString(item.invoiceRegistrationId) ?? undefined,
      taxRegion: normalizeString(item.taxRegion) ?? undefined,
      billingAddress: normalizeString(item.billingAddress) ?? undefined,
      externalSource: 'po',
      externalId: item.legacyId,
    },
  };
}

export function mapPoVendor(item: VendorInput) {
  const id = makeId('vendor', item.legacyId);
  return {
    id,
    data: {
      id,
      code: item.code,
      name: item.name,
      status: item.status,
      bankInfo: normalizeString(item.bankInfo) ?? undefined,
      taxRegion: normalizeString(item.taxRegion) ?? undefined,
      externalSource: 'po',
      externalId: item.legacyId,
    },
  };
}

export function mapPoProject(item: ProjectInput, errors: ImportError[]) {
  const id = makeId('project', item.legacyId);
  const startDate = parseDate(item.startDate);
  const endDate = parseDate(item.endDate);
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    errors.push({
      scope: 'projects',
      legacyId: item.legacyId,
      message: 'startDate must be before or equal to endDate',
    });
    return null;
  }
  const customerId = item.customerLegacyId
    ? makeId('customer', item.customerLegacyId)
    : null;
  const parentId = item.parentLegacyId
    ? makeId('project', item.parentLegacyId)
    : null;
  return {
    id,
    customerId,
    parentId,
    data: {
      id,
      code: item.code,
      name: item.name,
      status: parseEnumValue(item.status, PROJECT_STATUS_VALUES, 'active'),
      projectType: normalizeString(item.projectType) ?? undefined,
      customerId,
      ownerUserId: normalizeString(item.ownerUserId) ?? undefined,
      orgUnitId: normalizeString(item.orgUnitId) ?? undefined,
      startDate,
      endDate,
      currency: normalizeString(item.currency) ?? undefined,
      planHours: parseNumber(item.planHours) ?? undefined,
      budgetCost: parseNumber(item.budgetCost) ?? undefined,
    },
  };
}

export function normalizePoTaskInputs(items: TaskInput[]) {
  return items.map((item) => ({
    ...item,
    parentLegacyId: normalizeString(item.parentLegacyId) ?? null,
  }));
}

export function buildPoTaskProjectMap(
  items: Pick<TaskInput, 'legacyId' | 'projectLegacyId'>[],
) {
  const taskProjectMap = new Map<string, string>();
  for (const item of items) {
    taskProjectMap.set(
      makeId('task', item.legacyId),
      makeId('project', item.projectLegacyId),
    );
  }
  return taskProjectMap;
}

export function mapPoTask(item: TaskInput, errors: ImportError[]) {
  const id = makeId('task', item.legacyId);
  const projectId = makeId('project', item.projectLegacyId);
  const progressPercent = parseNumber(item.progressPercent);
  if (
    progressPercent != null &&
    (progressPercent < 0 || progressPercent > 100)
  ) {
    errors.push({
      scope: 'tasks',
      legacyId: item.legacyId,
      message: 'progressPercent must be between 0 and 100',
    });
    return null;
  }
  const planStart = parseDate(item.planStart);
  const planEnd = parseDate(item.planEnd);
  if (planStart && planEnd && planStart.getTime() > planEnd.getTime()) {
    errors.push({
      scope: 'tasks',
      legacyId: item.legacyId,
      message: 'planStart must be before or equal to planEnd',
    });
    return null;
  }
  const actualStart = parseDate(item.actualStart);
  const actualEnd = parseDate(item.actualEnd);
  if (actualStart && actualEnd && actualStart.getTime() > actualEnd.getTime()) {
    errors.push({
      scope: 'tasks',
      legacyId: item.legacyId,
      message: 'actualStart must be before or equal to actualEnd',
    });
    return null;
  }
  return {
    id,
    projectId,
    data: {
      id,
      projectId,
      name: item.name,
      status: normalizeString(item.status) ?? undefined,
      assigneeId: normalizeString(item.assigneeId) ?? undefined,
      parentTaskId: null,
      progressPercent:
        progressPercent == null ? null : Math.round(progressPercent),
      planStart,
      planEnd,
      actualStart,
      actualEnd,
    },
  };
}

export function mapPoMilestone(item: MilestoneInput) {
  const id = makeId('milestone', item.legacyId);
  const projectId = makeId('project', item.projectLegacyId);
  const taxRate = parseNumber(item.taxRate);
  return {
    id,
    projectId,
    data: {
      id,
      projectId,
      name: item.name,
      amount: item.amount,
      billUpon: normalizeString(item.billUpon) ?? 'acceptance',
      dueDate: parseDate(item.dueDate),
      taxRate: taxRate == null ? null : taxRate,
      invoiceTemplateId: null,
    },
  };
}

export function mapPoEstimateHeader(
  item: EstimateInput,
  projectId: string,
  numberingDateFallback: Date,
  errors: ImportError[],
) {
  const totalAmount = parseNumber(item.totalAmount);
  if (totalAmount == null || totalAmount < 0) {
    errors.push({
      scope: 'estimates',
      legacyId: item.legacyId,
      message: 'totalAmount must be >= 0',
    });
    return null;
  }
  const versionRaw = parseNumber(item.version);
  return {
    id: makeId('estimate', item.legacyId),
    projectId,
    totalAmount,
    version: versionRaw == null ? 1 : Math.max(1, Math.trunc(versionRaw)),
    validUntil: parseDate(item.validUntil),
    numberingDate: parseDate(item.numberingDate) || numberingDateFallback,
    preferredNo: normalizeString(item.estimateNo),
    currency: normalizeString(item.currency) || 'JPY',
    status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
    notes: normalizeString(item.notes) ?? undefined,
  };
}

export function getPoEstimateLines(
  item: EstimateInput,
  totalAmount: number,
): EstimateLineInput[] {
  return normalizeLines(item.lines).length
    ? normalizeLines(item.lines)
    : [
        {
          description: `Imported (${item.legacyId})`,
          quantity: 1,
          unitPrice: totalAmount,
          taxRate: null,
          taskLegacyId: null,
        },
      ];
}

export function mapPoLineUnitPrice(
  scope: string,
  legacyId: string,
  unitPrice: unknown,
  errors: ImportError[],
): number | null {
  const parsed = parseNumber(unitPrice);
  if (parsed == null || parsed < 0) {
    errors.push({ scope, legacyId, message: 'line.unitPrice must be >= 0' });
    return null;
  }
  return parsed;
}

export function mapPoInvoiceHeader(
  item: InvoiceInput,
  projectId: string,
  numberingDateFallback: Date,
  errors: ImportError[],
) {
  const totalAmount = parseNumber(item.totalAmount);
  if (totalAmount == null || totalAmount < 0) {
    errors.push({
      scope: 'invoices',
      legacyId: item.legacyId,
      message: 'totalAmount must be >= 0',
    });
    return null;
  }
  const issueDate = parseDate(item.issueDate);
  const dueDate = parseDate(item.dueDate);
  return {
    id: makeId('invoice', item.legacyId),
    projectId,
    totalAmount,
    issueDate,
    dueDate,
    numberingDate: issueDate || dueDate || numberingDateFallback,
    preferredNo: normalizeString(item.invoiceNo),
    currency: normalizeString(item.currency) || 'JPY',
    estimateId: normalizeString(item.estimateLegacyId)
      ? makeId('estimate', item.estimateLegacyId as string)
      : null,
    milestoneId: normalizeString(item.milestoneLegacyId)
      ? makeId('milestone', item.milestoneLegacyId as string)
      : null,
    status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
  };
}

export function getPoInvoiceLines(
  item: InvoiceInput,
  totalAmount: number,
): BillingLineInput[] {
  return normalizeLines(item.lines).length
    ? normalizeLines(item.lines)
    : [
        {
          description: `Imported (${item.legacyId})`,
          quantity: 1,
          unitPrice: totalAmount,
          taxRate: null,
          taskLegacyId: null,
          timeEntryRange: null,
        },
      ];
}

export function mapPoPurchaseOrderHeader(
  item: PurchaseOrderInput,
  projectId: string,
  vendorId: string,
  numberingDateFallback: Date,
  errors: ImportError[],
) {
  const totalAmount = parseNumber(item.totalAmount);
  if (totalAmount == null || totalAmount < 0) {
    errors.push({
      scope: 'purchase_orders',
      legacyId: item.legacyId,
      message: 'totalAmount must be >= 0',
    });
    return null;
  }
  const issueDate = parseDate(item.issueDate);
  const dueDate = parseDate(item.dueDate);
  return {
    id: makeId('purchase_order', item.legacyId),
    projectId,
    vendorId,
    totalAmount,
    issueDate,
    dueDate,
    numberingDate: issueDate || dueDate || numberingDateFallback,
    preferredNo: normalizeString(item.poNo),
    currency: normalizeString(item.currency) || 'JPY',
    status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
  };
}

export function getPoPurchaseOrderLines(
  item: PurchaseOrderInput,
  totalAmount: number,
): PurchaseOrderLineInput[] {
  return normalizeLines(item.lines).length
    ? normalizeLines(item.lines)
    : [
        {
          description: `Imported (${item.legacyId})`,
          quantity: 1,
          unitPrice: totalAmount,
          taxRate: null,
          taskLegacyId: null,
          expenseLegacyId: null,
        },
      ];
}

export function mapPoVendorQuoteHeader(
  item: VendorQuoteInput,
  projectId: string,
  vendorId: string,
  numberingDateFallback: Date,
  errors: ImportError[],
) {
  const totalAmount = parseNumber(item.totalAmount);
  if (totalAmount == null || totalAmount < 0) {
    errors.push({
      scope: 'vendor_quotes',
      legacyId: item.legacyId,
      message: 'totalAmount must be >= 0',
    });
    return null;
  }
  const issueDate = parseDate(item.issueDate);
  return {
    id: makeId('vendor_quote', item.legacyId),
    projectId,
    vendorId,
    totalAmount,
    issueDate,
    numberingDate: issueDate || numberingDateFallback,
    preferredNo: normalizeString(item.quoteNo),
    currency: normalizeString(item.currency) || 'JPY',
    status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'received'),
    documentUrl: normalizeString(item.documentUrl) ?? undefined,
  };
}

export function mapPoVendorInvoiceHeader(
  item: VendorInvoiceInput,
  projectId: string,
  vendorId: string,
  numberingDateFallback: Date,
  errors: ImportError[],
) {
  const totalAmount = parseNumber(item.totalAmount);
  if (totalAmount == null || totalAmount < 0) {
    errors.push({
      scope: 'vendor_invoices',
      legacyId: item.legacyId,
      message: 'totalAmount must be >= 0',
    });
    return null;
  }
  const receivedDate = parseDate(item.receivedDate);
  const dueDate = parseDate(item.dueDate);
  return {
    id: makeId('vendor_invoice', item.legacyId),
    projectId,
    vendorId,
    totalAmount,
    receivedDate,
    dueDate,
    numberingDate: receivedDate || dueDate || numberingDateFallback,
    preferredNo: normalizeString(item.vendorInvoiceNo),
    currency: normalizeString(item.currency) || 'JPY',
    status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'received'),
    documentUrl: normalizeString(item.documentUrl) ?? undefined,
  };
}

export function mapPoTimeEntry(
  item: TimeEntryInput,
  projectId: string,
  taskId: string | null,
  errors: ImportError[],
) {
  const workDate = parseDate(item.workDate);
  if (!workDate) {
    errors.push({
      scope: 'time_entries',
      legacyId: item.legacyId,
      message: 'invalid workDate',
    });
    return null;
  }
  const minutes = parseNumber(item.minutes);
  if (minutes == null || minutes <= 0) {
    errors.push({
      scope: 'time_entries',
      legacyId: item.legacyId,
      message: 'minutes must be > 0',
    });
    return null;
  }
  const id = makeId('time_entry', item.legacyId);
  return {
    id,
    data: {
      id,
      projectId,
      taskId,
      billedInvoiceId: null,
      billedAt: null,
      userId: item.userId,
      workDate,
      minutes: Math.round(minutes),
      workType: normalizeString(item.workType) ?? undefined,
      location: normalizeString(item.location) ?? undefined,
      notes: normalizeString(item.notes) ?? undefined,
      status: parseEnumValue(item.status, TIME_STATUS_VALUES, 'submitted'),
      approvedBy: null,
      approvedAt: null,
    },
  };
}

export function mapPoExpense(
  item: ExpenseInput,
  projectId: string,
  errors: ImportError[],
) {
  const incurredOn = parseDate(item.incurredOn);
  if (!incurredOn) {
    errors.push({
      scope: 'expenses',
      legacyId: item.legacyId,
      message: 'invalid incurredOn',
    });
    return null;
  }
  const amount = parseNumber(item.amount);
  if (amount == null || amount < 0) {
    errors.push({
      scope: 'expenses',
      legacyId: item.legacyId,
      message: 'amount must be >= 0',
    });
    return null;
  }
  const id = makeId('expense', item.legacyId);
  return {
    id,
    data: {
      id,
      projectId,
      userId: item.userId,
      category: item.category,
      amount,
      currency: item.currency,
      incurredOn,
      isShared: item.isShared === true,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
      receiptUrl: normalizeString(item.receiptUrl) ?? undefined,
    },
  };
}
