import type { ApprovalCondition, ApprovalStep } from './approvalLogic.js';

export type DefaultRuleSeed = {
  ruleKey: string;
  conditions: ApprovalCondition;
  steps: ApprovalStep[];
};

export type ApprovalDefaultRuleSpec = {
  flowType: string;
  ruleKey: string;
  conditions: ApprovalCondition;
  steps: ApprovalStep[];
};

export const APPROVAL_DEFAULT_RULE_EFFECTIVE_FROM_ISO =
  '2000-01-01T00:00:00.000Z';
export const APPROVAL_DEFAULT_RULE_EFFECTIVE_FROM_SQL = '2000-01-01 00:00:00';

const AMOUNT_BASED_FLOWS = [
  'estimate',
  'invoice',
  'expense',
  'purchase_order',
  'vendor_invoice',
  'vendor_quote',
] as const;

const SINGLE_STAGE_STEPS: ApprovalStep[] = [
  { approverGroupId: 'mgmt', stepOrder: 1 },
];
const TWO_STAGE_STEPS: ApprovalStep[] = [
  { approverGroupId: 'mgmt', stepOrder: 1 },
  { approverGroupId: 'exec', stepOrder: 2 },
];

function cloneSteps(steps: ApprovalStep[]) {
  return steps.map((step) => ({ ...step }));
}

function buildAmountBasedSpecs(flowType: string): ApprovalDefaultRuleSpec[] {
  return [
    {
      flowType,
      ruleKey: `system-default:${flowType}:low`,
      conditions: { amountMax: 99_999 },
      steps: cloneSteps(SINGLE_STAGE_STEPS),
    },
    {
      flowType,
      ruleKey: `system-default:${flowType}:high`,
      conditions: { amountMin: 100_000 },
      steps: cloneSteps(TWO_STAGE_STEPS),
    },
  ];
}

export const APPROVAL_DEFAULT_RULE_SPECS: ApprovalDefaultRuleSpec[] = [
  ...AMOUNT_BASED_FLOWS.flatMap((flowType) => buildAmountBasedSpecs(flowType)),
  {
    flowType: 'leave',
    ruleKey: 'system-default:leave',
    conditions: {},
    steps: cloneSteps(SINGLE_STAGE_STEPS),
  },
  {
    flowType: 'time',
    ruleKey: 'system-default:time',
    conditions: {},
    steps: cloneSteps(SINGLE_STAGE_STEPS),
  },
];

export function defaultRuleSeedsForFlow(flowType: string): DefaultRuleSeed[] {
  return APPROVAL_DEFAULT_RULE_SPECS.filter(
    (spec) => spec.flowType === flowType,
  ).map((spec) => ({
    ruleKey: spec.ruleKey,
    conditions: { ...(spec.conditions as Record<string, unknown>) },
    steps: cloneSteps(spec.steps),
  })) as DefaultRuleSeed[];
}
