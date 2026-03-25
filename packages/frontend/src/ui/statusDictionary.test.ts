import { describe, expect, it } from 'vitest';

import { erpStatusDictionary, formatErpStatusLabel } from './statusDictionary';

describe('statusDictionary', () => {
  it('returns ERP-specific labels for known statuses', () => {
    expect(erpStatusDictionary.approved.label).toBe('承認済み');
    expect(formatErpStatusLabel(' approved ')).toBe('承認済み');
    expect(formatErpStatusLabel('failed')).toBe('失敗');
  });

  it('falls back for unknown statuses', () => {
    expect(formatErpStatusLabel('custom_pending')).toBe('Custom Pending');
  });
});
