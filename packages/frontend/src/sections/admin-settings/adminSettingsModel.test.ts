import { describe, expect, it } from 'vitest';

import {
  compareApprovalRulesForSeries,
  formatDateTime,
  getApprovalRuleSeriesKey,
  isValidHttpUrl,
  normalizeActionPolicyForm,
  type ApprovalRule,
} from './adminSettingsModel';

describe('adminSettingsModel', () => {
  it('normalizes action policy form values from the form builder payload', () => {
    expect(
      normalizeActionPolicyForm({
        flowType: 'expense',
        actionKey: 'approve',
        priority: '12',
        isEnabled: false,
        requireReason: true,
        subjectsJson: '{"roles":["mgmt"]}',
        stateConstraintsJson: '{"statusIn":["draft"]}',
        guardsJson: '[]',
      }),
    ).toEqual({
      flowType: 'expense',
      actionKey: 'approve',
      priority: 12,
      isEnabled: false,
      requireReason: true,
      subjectsJson: '{"roles":["mgmt"]}',
      stateConstraintsJson: '{"statusIn":["draft"]}',
      guardsJson: '[]',
    });
  });

  it('orders approval rule series by newest version then createdAt', () => {
    const v1: ApprovalRule = {
      id: 'rule-v1',
      flowType: 'invoice',
      ruleKey: 'standard',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const v2: ApprovalRule = {
      ...v1,
      id: 'rule-v2',
      version: 2,
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    const sameVersionNewer: ApprovalRule = {
      ...v1,
      id: 'rule-v1b',
      createdAt: '2026-01-03T00:00:00.000Z',
    };

    expect(compareApprovalRulesForSeries(v1, v2)).toBeGreaterThan(0);
    expect(compareApprovalRulesForSeries(v1, sameVersionNewer)).toBeGreaterThan(
      0,
    );
    expect(getApprovalRuleSeriesKey(v1)).toBe('invoice::standard');
  });

  it('keeps URL and date formatting helpers defensive', () => {
    expect(isValidHttpUrl('https://example.com/hook')).toBe(true);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});
