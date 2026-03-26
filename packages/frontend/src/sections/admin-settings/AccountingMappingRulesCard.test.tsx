import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountingMappingRulesCard,
  type AccountingMappingRuleFormState,
  type AccountingMappingRuleItem,
} from './AccountingMappingRulesCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const baseForm: AccountingMappingRuleFormState = {
  mappingKey: 'invoice_approved:default',
  debitAccountCode: '1110',
  debitAccountName: '売掛金',
  debitSubaccountCode: '01',
  requireDebitSubaccountCode: true,
  creditAccountCode: '5110',
  creditAccountName: '売上高',
  creditSubaccountCode: '99',
  requireCreditSubaccountCode: false,
  departmentCode: 'D01',
  requireDepartmentCode: true,
  taxCode: 'tax-10',
  isActive: true,
};

function createItem(
  overrides: Partial<AccountingMappingRuleItem> = {},
): AccountingMappingRuleItem {
  return {
    id: 'rule-1',
    mappingKey: 'invoice_approved:default',
    debitAccountCode: '1110',
    debitAccountName: '売掛金',
    debitSubaccountCode: '01',
    requireDebitSubaccountCode: true,
    creditAccountCode: '5110',
    creditAccountName: '売上高',
    creditSubaccountCode: '99',
    requireCreditSubaccountCode: false,
    departmentCode: 'D01',
    requireDepartmentCode: true,
    taxCode: 'tax-10',
    isActive: true,
    createdAt: '2026-03-26T00:00:00.000Z',
    updatedAt: '2026-03-26T01:00:00.000Z',
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<
    React.ComponentProps<typeof AccountingMappingRulesCard>
  > = {},
) {
  const setMappingKeyFilter = vi.fn();
  const setIsActiveFilter = vi.fn();
  const setLimit = vi.fn();
  const setOffset = vi.fn();
  const setForm = vi.fn();
  const onSubmit = vi.fn();
  const onReset = vi.fn();
  const onLoad = vi.fn();
  const onEdit = vi.fn();
  const setReapplyPeriodKey = vi.fn();
  const setReapplyMappingKey = vi.fn();
  const setReapplyLimit = vi.fn();
  const setReapplyOffset = vi.fn();
  const onReapply = vi.fn();
  const formatDateTime = vi.fn((value?: string | null) =>
    value ? `fmt:${value}` : '-',
  );

  render(
    <AccountingMappingRulesCard
      mappingKeyFilter=""
      setMappingKeyFilter={setMappingKeyFilter}
      isActiveFilter=""
      setIsActiveFilter={setIsActiveFilter}
      limit={20}
      setLimit={setLimit}
      offset={0}
      setOffset={setOffset}
      loading={false}
      items={[]}
      form={baseForm}
      setForm={setForm}
      editingId={null}
      onSubmit={onSubmit}
      onReset={onReset}
      onLoad={onLoad}
      onEdit={onEdit}
      reapplyPeriodKey="2026-03"
      setReapplyPeriodKey={setReapplyPeriodKey}
      reapplyMappingKey="invoice_approved:default"
      setReapplyMappingKey={setReapplyMappingKey}
      reapplyLimit={100}
      setReapplyLimit={setReapplyLimit}
      reapplyOffset={0}
      setReapplyOffset={setReapplyOffset}
      reapplying={false}
      onReapply={onReapply}
      reapplyResult={null}
      formatDateTime={formatDateTime}
      {...overrides}
    />,
  );

  return {
    setMappingKeyFilter,
    setIsActiveFilter,
    setLimit,
    setOffset,
    setForm,
    onSubmit,
    onReset,
    onLoad,
    onEdit,
    setReapplyPeriodKey,
    setReapplyMappingKey,
    setReapplyLimit,
    setReapplyOffset,
    onReapply,
    formatDateTime,
  };
}

describe('AccountingMappingRulesCard', () => {
  it('delegates form edits and submit/reset actions', () => {
    const { setForm, onSubmit, onReset } = renderCard();

    fireEvent.change(screen.getByLabelText('会計ルールmappingKey'), {
      target: { value: 'invoice_paid:default' },
    });
    fireEvent.change(screen.getByLabelText('会計ルール借方科目'), {
      target: { value: '1120' },
    });
    fireEvent.change(screen.getByLabelText('会計ルール借方名称'), {
      target: { value: '未収入金' },
    });
    fireEvent.click(screen.getByLabelText('貸方枝番必須'));

    expect(setForm).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '作成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'クリア' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('accounting-mapping-rule-submit'));
    fireEvent.click(screen.getByTestId('accounting-mapping-rule-reset'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders edit mode labels, reapply controls and normalizes numeric inputs', () => {
    const {
      setReapplyPeriodKey,
      setReapplyMappingKey,
      setReapplyLimit,
      setReapplyOffset,
      onReapply,
      setLimit,
      setOffset,
      setMappingKeyFilter,
      setIsActiveFilter,
    } = renderCard({
      editingId: 'rule-1',
      reapplying: true,
      reapplyResult: {
        processedCount: 20,
        updatedCount: 10,
        readyCount: 8,
        pendingMappingCount: 1,
        blockedCount: 1,
      },
      limit: 15,
      offset: 4,
      reapplyLimit: 30,
      reapplyOffset: 6,
    });

    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '編集解除' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/processed=20 \/ updated=10 \/ ready=8/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('会計ルール再適用periodKey'), {
      target: { value: '2026-04' },
    });
    expect(setReapplyPeriodKey).toHaveBeenCalledWith('2026-04');

    fireEvent.change(screen.getByLabelText('会計ルール再適用mappingKey'), {
      target: { value: 'invoice_paid:default' },
    });
    expect(setReapplyMappingKey).toHaveBeenCalledWith('invoice_paid:default');

    fireEvent.change(screen.getByLabelText('会計ルール再適用limit'), {
      target: { value: '5000' },
    });
    expect(setReapplyLimit).toHaveBeenCalledWith(2000);

    fireEvent.change(screen.getByLabelText('会計ルール再適用offset'), {
      target: { value: '-2' },
    });
    expect(setReapplyOffset).toHaveBeenCalledWith(6);

    const reapplyButton = screen.getByTestId('accounting-mapping-rule-reapply');
    expect(reapplyButton).toBeDisabled();
    expect(reapplyButton).toHaveTextContent('再適用中...');

    fireEvent.change(screen.getByLabelText('会計ルール検索mappingKey'), {
      target: { value: 'invoice' },
    });
    expect(setMappingKeyFilter).toHaveBeenCalledWith('invoice');

    fireEvent.change(screen.getByLabelText('会計ルール検索isActive'), {
      target: { value: 'true' },
    });
    expect(setIsActiveFilter).toHaveBeenCalledWith('true');

    fireEvent.change(screen.getByLabelText('会計ルール検索limit'), {
      target: { value: '0' },
    });
    expect(setLimit).toHaveBeenCalledWith(15);

    fireEvent.change(screen.getByLabelText('会計ルール検索offset'), {
      target: { value: '-1' },
    });
    expect(setOffset).toHaveBeenCalledWith(4);

    fireEvent.click(reapplyButton);
    expect(onReapply).not.toHaveBeenCalled();
  });

  it('renders rule cards and delegates load/edit actions', () => {
    const item = createItem();
    const { onLoad, onEdit, formatDateTime } = renderCard({ items: [item] });

    expect(screen.queryByText('ルールなし')).not.toBeInTheDocument();
    const card = within(screen.getByTestId('accounting-mapping-rule-rule-1'));
    expect(card.getByText('invoice_approved:default')).toBeInTheDocument();
    expect(card.getByText('active')).toBeInTheDocument();
    expect(
      card.getByText(/借方: 1110 \(売掛金\)-01 \/ 貸方: 5110 \(売上高\)-99/),
    ).toBeInTheDocument();
    expect(card.getByText('部門: D01 / 税区分: tax-10')).toBeInTheDocument();
    expect(
      card.getByTestId('accounting-mapping-rule-require-debit-subaccount'),
    ).toHaveTextContent('借方枝番: 必須');
    expect(
      card.getByTestId('accounting-mapping-rule-require-credit-subaccount'),
    ).toHaveTextContent('貸方枝番: 任意');
    expect(
      card.getByTestId('accounting-mapping-rule-require-department'),
    ).toHaveTextContent('部門コード: 必須');
    expect(
      card.getByText(
        /createdAt: fmt:2026-03-26T00:00:00.000Z \/ updatedAt: fmt:2026-03-26T01:00:00.000Z/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('accounting-mapping-rules-load'));
    expect(onLoad).toHaveBeenCalledTimes(1);

    fireEvent.click(card.getByRole('button', { name: '編集' }));
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(formatDateTime).toHaveBeenCalledWith('2026-03-26T00:00:00.000Z');
    expect(formatDateTime).toHaveBeenCalledWith('2026-03-26T01:00:00.000Z');
  });

  it('renders empty state when no rules exist', () => {
    renderCard({ items: [] });
    expect(screen.getByText('ルールなし')).toBeInTheDocument();
  });
});
