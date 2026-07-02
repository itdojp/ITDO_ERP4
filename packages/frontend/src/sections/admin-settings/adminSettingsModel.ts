import type { PolicyFormSchema, PolicyFormValue } from '../../ui';
import type { AccountingMappingRuleFormState } from './AccountingMappingRulesCard';

export type AlertSetting = {
  id: string;
  type: string;
  threshold: number;
  period: string;
  scopeProjectId?: string | null;
  recipients?: {
    emails?: string[];
    roles?: string[];
    users?: string[];
    slackWebhooks?: string[];
    webhooks?: string[];
  } | null;
  channels?: string[] | null;
  remindAfterHours?: number | null;
  remindMaxCount?: number | null;
  isEnabled?: boolean | null;
};

export type ApprovalRule = {
  id: string;
  flowType: string;
  ruleKey?: string | null;
  version?: number | null;
  isActive?: boolean | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  supersedesRuleId?: string | null;
  conditions?: Record<string, unknown> | null;
  steps?: unknown | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AuditLogItem = {
  id: string;
  action: string;
  userId?: string | null;
  actorRole?: string | null;
  actorGroupId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  targetTable?: string | null;
  targetId?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

export type ActionPolicy = {
  id: string;
  flowType: string;
  actionKey: string;
  priority?: number | null;
  isEnabled?: boolean | null;
  subjects?: Record<string, unknown> | null;
  stateConstraints?: Record<string, unknown> | null;
  requireReason?: boolean | null;
  guards?: unknown | null;
};

export type ActionPolicyForm = {
  flowType: string;
  actionKey: string;
  priority?: number;
  isEnabled: boolean;
  requireReason: boolean;
  subjectsJson: string;
  stateConstraintsJson: string;
  guardsJson: string;
};

export type ChatAckTemplate = {
  id: string;
  flowType: string;
  actionKey: string;
  messageBody: string;
  requiredUserIds?: string[] | null;
  requiredGroupIds?: string[] | null;
  requiredRoles?: string[] | null;
  dueInHours?: number | null;
  remindIntervalHours?: number | null;
  escalationAfterHours?: number | null;
  escalationUserIds?: string[] | null;
  escalationGroupIds?: string[] | null;
  escalationRoles?: string[] | null;
  isEnabled?: boolean | null;
  createdAt?: string | null;
};

export type PdfTemplate = {
  id: string;
  name: string;
  kind: string;
  version: string;
  description?: string | null;
  isDefault?: boolean | null;
};

export type TemplateSetting = {
  id: string;
  kind: string;
  templateId: string;
  numberRule: string;
  layoutConfig?: Record<string, unknown> | null;
  logoUrl?: string | null;
  signatureText?: string | null;
  isDefault?: boolean | null;
};

export type IntegrationSetting = {
  id: string;
  type: string;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  schedule?: string | null;
  config?: Record<string, unknown> | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};

export type IntegrationRun = {
  id: string;
  settingId: string;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
  metrics?: Record<string, unknown> | null;
  retryCount?: number | null;
  nextRetryAt?: string | null;
};

export type ReportSubscription = {
  id: string;
  name?: string | null;
  reportKey: string;
  format?: string | null;
  schedule?: string | null;
  params?: Record<string, unknown> | null;
  recipients?: Record<string, unknown> | null;
  channels?: string[] | null;
  isEnabled?: boolean | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};

export type ReportDelivery = {
  id: string;
  subscriptionId?: string | null;
  channel?: string | null;
  status?: string | null;
  target?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
};

export type AccountingMappingRuleReapplyForm = {
  periodKey: string;
  mappingKey: string;
  limit: number;
  offset: number;
};

export const alertTypes = [
  'budget_overrun',
  'overtime',
  'approval_delay',
  'approval_escalation',
  'delivery_due',
  'integration_failure',
  'daily_report_missing',
];
export const alertChannels = ['email', 'dashboard', 'slack', 'webhook'];
export const flowTypes = [
  'estimate',
  'invoice',
  'expense',
  'leave',
  'time',
  'purchase_order',
  'vendor_invoice',
  'vendor_quote',
];
export const templateKinds = ['estimate', 'invoice', 'purchase_order'];
export const integrationTypes = ['hr', 'crm'];
export const integrationStatuses = ['active', 'disabled'];
export const reportFormats = ['csv', 'pdf'];

export const actionPolicyFormSchema: PolicyFormSchema = {
  sections: [
    {
      id: 'basic',
      title: '基本設定',
    },
    {
      id: 'constraints',
      title: '適用条件/ガード',
    },
  ],
  fields: [
    {
      name: 'flowType',
      label: 'flowType',
      type: 'select',
      required: true,
      sectionId: 'basic',
      options: flowTypes.map((type) => ({ label: type, value: type })),
    },
    {
      name: 'actionKey',
      label: 'actionKey',
      type: 'text',
      required: true,
      sectionId: 'basic',
      placeholder: 'submit/send/edit/...',
    },
    {
      name: 'priority',
      label: 'priority',
      type: 'number',
      sectionId: 'basic',
      step: 1,
      validator: (fieldValue) => {
        if (
          fieldValue === undefined ||
          fieldValue === null ||
          fieldValue === ''
        ) {
          return undefined;
        }
        if (
          typeof fieldValue !== 'number' ||
          !Number.isFinite(fieldValue) ||
          !Number.isInteger(fieldValue)
        ) {
          return 'priority は整数で入力してください';
        }
        return undefined;
      },
    },
    {
      name: 'isEnabled',
      label: 'isEnabled',
      type: 'checkbox',
      sectionId: 'basic',
    },
    {
      name: 'requireReason',
      label: 'requireReason',
      type: 'checkbox',
      sectionId: 'basic',
    },
    {
      name: 'subjectsJson',
      label: 'subjects (JSON)',
      type: 'textarea',
      sectionId: 'constraints',
      rows: 3,
      columnSpan: 2,
      placeholder:
        '{"roles":["admin","mgmt"],"groupIds":["mgmt"],"userIds":["user@example.com"]}',
    },
    {
      name: 'stateConstraintsJson',
      label: 'stateConstraints (JSON)',
      type: 'textarea',
      sectionId: 'constraints',
      rows: 3,
      columnSpan: 2,
      placeholder: '{"statusIn":["draft"],"statusNotIn":["cancelled"]}',
    },
    {
      name: 'guardsJson',
      label: 'guards (JSON)',
      type: 'textarea',
      sectionId: 'constraints',
      rows: 3,
      columnSpan: 2,
      placeholder:
        '[{"type":"approval_open"},{"type":"project_closed"},{"type":"period_lock"},{"type":"editable_days"},{"type":"chat_ack_completed"}]',
    },
  ],
};

export function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatJson(value: unknown): string {
  if (value === undefined) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '-';
  }
}

export function parseDateTime(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getApprovalRuleSeriesKey(
  rule: Pick<ApprovalRule, 'flowType' | 'ruleKey' | 'id'>,
): string {
  return `${rule.flowType}::${rule.ruleKey || rule.id}`;
}

export function compareApprovalRulesForSeries(
  left: ApprovalRule,
  right: ApprovalRule,
): number {
  const leftVersion = left.version ?? 1;
  const rightVersion = right.version ?? 1;
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;
  const leftCreatedAt = parseDateTime(left.createdAt)?.getTime() ?? 0;
  const rightCreatedAt = parseDateTime(right.createdAt)?.getTime() ?? 0;
  return rightCreatedAt - leftCreatedAt;
}

export const createDefaultAlertForm = () => ({
  type: 'budget_overrun',
  threshold: '10',
  period: 'month',
  scopeProjectId: '',
  remindAfterHours: '',
  remindMaxCount: '',
  emails: 'alert@example.com',
  roles: 'mgmt',
  users: '',
  slackWebhooks: '',
  webhooks: '',
  channels: new Set<string>(['email', 'dashboard']),
});

export type AlertFormDraftPayload = Omit<
  ReturnType<typeof createDefaultAlertForm>,
  'channels' | 'slackWebhooks' | 'webhooks'
> & {
  channels: string[];
};

export const createDefaultRuleForm = () => ({
  flowType: 'invoice',
  isActive: true,
  effectiveFrom: '',
  conditionsJson: '{"amountMin": 0}',
  stepsJson: '[{"approverGroupId":"mgmt","stepOrder":1}]',
});

export const createDefaultActionPolicyForm = (): ActionPolicyForm => ({
  flowType: 'invoice',
  actionKey: 'submit',
  priority: 0,
  isEnabled: true,
  requireReason: false,
  subjectsJson: '',
  stateConstraintsJson: '',
  guardsJson: '',
});

export function normalizeActionPolicyForm(
  value: PolicyFormValue,
): ActionPolicyForm {
  const priorityRaw = value.priority;
  let priority: number | undefined;
  if (typeof priorityRaw === 'number') {
    priority = Number.isFinite(priorityRaw) ? priorityRaw : undefined;
  } else if (typeof priorityRaw === 'string' && priorityRaw.trim().length > 0) {
    const parsed = Number(priorityRaw);
    priority = Number.isFinite(parsed) ? parsed : undefined;
  }
  return {
    flowType: typeof value.flowType === 'string' ? value.flowType : 'invoice',
    actionKey: typeof value.actionKey === 'string' ? value.actionKey : '',
    priority,
    isEnabled: value.isEnabled !== false,
    requireReason: value.requireReason === true,
    subjectsJson:
      typeof value.subjectsJson === 'string' ? value.subjectsJson : '',
    stateConstraintsJson:
      typeof value.stateConstraintsJson === 'string'
        ? value.stateConstraintsJson
        : '',
    guardsJson: typeof value.guardsJson === 'string' ? value.guardsJson : '',
  };
}

export const createDefaultChatAckTemplateForm = () => ({
  flowType: 'invoice',
  actionKey: 'approve',
  messageBody: '',
  requiredUserIdsJson: '[]',
  requiredGroupIdsJson: '[]',
  requiredRolesJson: '[]',
  dueInHours: '',
  remindIntervalHours: '',
  escalationAfterHours: '',
  escalationUserIdsJson: '[]',
  escalationGroupIdsJson: '[]',
  escalationRolesJson: '[]',
  isEnabled: true,
});

export const createDefaultIntegrationForm = () => ({
  type: 'crm',
  name: '',
  provider: '',
  status: 'active',
  schedule: '',
  configJson: '',
});

export const createDefaultReportForm = () => ({
  name: '',
  reportKey: '',
  format: 'csv',
  schedule: '',
  paramsJson: '',
  recipientsJson: '',
  channels: 'dashboard',
  isEnabled: true,
});

export const createDefaultAccountingMappingRuleForm =
  (): AccountingMappingRuleFormState => ({
    mappingKey: '',
    debitAccountCode: '',
    debitAccountName: '',
    debitSubaccountCode: '',
    requireDebitSubaccountCode: false,
    creditAccountCode: '',
    creditAccountName: '',
    creditSubaccountCode: '',
    requireCreditSubaccountCode: false,
    departmentCode: '',
    requireDepartmentCode: false,
    taxCode: '',
    isActive: true,
  });

export const DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT = 20;
export const DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET = 0;
export const RECONCILIATION_PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const currentPeriodKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export const createDefaultAccountingMappingRuleReapplyForm =
  (): AccountingMappingRuleReapplyForm => ({
    periodKey: currentPeriodKey(),
    mappingKey: '',
    limit: 500,
    offset: 0,
  });

export const createClientIdempotencyKey = (prefix: string) => {
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};
