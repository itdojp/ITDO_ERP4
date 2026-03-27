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
  ReportSubscriptionsCard,
  type ReportDeliveryItem,
  type ReportFormState,
  type ReportSubscriptionsCardItem,
} from './ReportSubscriptionsCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const baseForm: ReportFormState = {
  name: '月次工数レポート',
  reportKey: 'project_hours_monthly',
  format: 'csv',
  schedule: '0 8 * * 1',
  paramsJson: '{"projectId":"pj-1"}',
  recipientsJson: '{"roles":["mgmt"]}',
  channels: 'dashboard,email',
  isEnabled: true,
};

function createItem(
  overrides: Partial<ReportSubscriptionsCardItem> = {},
): ReportSubscriptionsCardItem {
  return {
    id: 'sub-1',
    name: '工数月次',
    reportKey: 'project_hours_monthly',
    format: 'csv',
    schedule: '0 8 * * 1',
    channels: ['dashboard', 'email'],
    isEnabled: true,
    lastRunAt: '2026-03-28T00:00:00.000Z',
    lastRunStatus: 'success',
    ...overrides,
  };
}

function createDelivery(
  overrides: Partial<ReportDeliveryItem> = {},
): ReportDeliveryItem {
  return {
    id: 'delivery-1',
    subscriptionId: 'sub-1',
    channel: 'email',
    status: 'sent',
    target: 'ops@example.com',
    sentAt: '2026-03-28T01:00:00.000Z',
    createdAt: '2026-03-28T00:30:00.000Z',
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof ReportSubscriptionsCard>> = {},
) {
  const setReportForm = vi.fn();
  const setReportDryRun = vi.fn();
  const onSubmit = vi.fn();
  const onReset = vi.fn();
  const onReload = vi.fn();
  const onRunAll = vi.fn();
  const onShowDeliveries = vi.fn();
  const onEdit = vi.fn();
  const onToggle = vi.fn();
  const onRun = vi.fn();
  const setReportDeliveryFilterId = vi.fn();
  const formatDateTime = vi.fn((value?: string | null) =>
    value ? `fmt:${value}` : '-',
  );

  render(
    <ReportSubscriptionsCard
      reportForm={baseForm}
      setReportForm={setReportForm}
      reportFormats={['csv', 'xlsx']}
      reportDryRun={false}
      setReportDryRun={setReportDryRun}
      editingReportId={null}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
      onRunAll={onRunAll}
      onShowDeliveries={onShowDeliveries}
      items={[]}
      onEdit={onEdit}
      onToggle={onToggle}
      onRun={onRun}
      reportDeliveryFilterId=""
      setReportDeliveryFilterId={setReportDeliveryFilterId}
      deliveries={[]}
      formatDateTime={formatDateTime}
      {...overrides}
    />,
  );

  return {
    setReportForm,
    setReportDryRun,
    onSubmit,
    onReset,
    onReload,
    onRunAll,
    onShowDeliveries,
    onEdit,
    onToggle,
    onRun,
    setReportDeliveryFilterId,
    formatDateTime,
  };
}

describe('ReportSubscriptionsCard', () => {
  it('renders empty states and delegates form-level actions', () => {
    const {
      setReportForm,
      setReportDryRun,
      onSubmit,
      onReset,
      onReload,
      onRunAll,
      onShowDeliveries,
      setReportDeliveryFilterId,
    } = renderCard();

    expect(screen.getByText('購読なし')).toBeInTheDocument();
    expect(screen.getByText('履歴なし')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '週次工数レポート' },
    });
    expect(setReportForm).toHaveBeenCalledWith({
      ...baseForm,
      name: '週次工数レポート',
    });

    fireEvent.change(screen.getByLabelText('reportKey'), {
      target: { value: 'project_hours_weekly' },
    });
    expect(setReportForm).toHaveBeenCalledWith({
      ...baseForm,
      reportKey: 'project_hours_weekly',
    });

    fireEvent.change(screen.getByLabelText('format'), {
      target: { value: 'xlsx' },
    });
    expect(setReportForm).toHaveBeenCalledWith({
      ...baseForm,
      format: 'xlsx',
    });

    fireEvent.change(screen.getByLabelText('購読ID'), {
      target: { value: 'sub-1' },
    });
    expect(setReportDeliveryFilterId).toHaveBeenCalledWith('sub-1');

    fireEvent.click(screen.getByLabelText('dry-run'));
    expect(setReportDryRun).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));
    fireEvent.click(screen.getByRole('button', { name: '一括実行' }));
    fireEvent.click(screen.getByRole('button', { name: '配信履歴を表示' }));
    fireEvent.click(screen.getByRole('button', { name: '表示' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onRunAll).toHaveBeenCalledTimes(1);
    expect(onShowDeliveries).toHaveBeenNthCalledWith(1);
    expect(onShowDeliveries).toHaveBeenNthCalledWith(2, undefined);
  });

  it('calls onShowDeliveries with filter id when provided', () => {
    const { onShowDeliveries } = renderCard({
      reportDeliveryFilterId: 'sub-1',
    });

    fireEvent.click(screen.getByRole('button', { name: '表示' }));

    expect(onShowDeliveries).toHaveBeenCalledTimes(1);
    expect(onShowDeliveries).toHaveBeenCalledWith('sub-1');
  });

  it('renders items and deliveries and delegates item actions', () => {
    const enabledItem = createItem();
    const disabledItem = createItem({
      id: 'sub-2',
      reportKey: 'project_profitability_monthly',
      name: null,
      channels: null,
      format: null,
      schedule: null,
      isEnabled: false,
      lastRunAt: null,
      lastRunStatus: null,
    });
    const delivery = createDelivery();
    const { onEdit, onToggle, onRun, onShowDeliveries, formatDateTime } =
      renderCard({
        editingReportId: 'sub-1',
        reportDeliveryFilterId: 'sub-1',
        items: [enabledItem, disabledItem],
        deliveries: [
          delivery,
          createDelivery({ id: 'delivery-2', sentAt: null }),
        ],
      });

    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'キャンセル' }),
    ).toBeInTheDocument();
    expect(screen.getByText('filter: sub-1')).toBeInTheDocument();

    const enabledCard = within(
      screen
        .getAllByText('project_hours_monthly', { selector: 'strong' })[0]
        .closest('.card') as HTMLElement,
    );
    expect(enabledCard.getByText('enabled')).toBeInTheDocument();
    expect(
      enabledCard.getByText(/channels: dashboard, email/),
    ).toBeInTheDocument();
    expect(enabledCard.getByText(/status: success/)).toBeInTheDocument();
    fireEvent.click(enabledCard.getByRole('button', { name: '編集' }));
    fireEvent.click(enabledCard.getByRole('button', { name: '無効化' }));
    fireEvent.click(enabledCard.getByRole('button', { name: '実行' }));
    fireEvent.click(enabledCard.getByRole('button', { name: '配信履歴' }));

    expect(onEdit).toHaveBeenCalledWith(enabledItem);
    expect(onToggle).toHaveBeenCalledWith(enabledItem);
    expect(onRun).toHaveBeenCalledWith('sub-1');
    expect(onShowDeliveries).toHaveBeenCalledWith('sub-1');

    const disabledCard = within(
      screen
        .getAllByText('project_profitability_monthly', {
          selector: 'strong',
        })[0]
        .closest('.card') as HTMLElement,
    );
    expect(disabledCard.getByText('disabled')).toBeInTheDocument();
    expect(disabledCard.getByText(/format: -/)).toBeInTheDocument();
    expect(disabledCard.getByText(/channels: -/)).toBeInTheDocument();
    expect(disabledCard.getByRole('button', { name: '実行' })).toBeDisabled();

    expect(screen.getAllByText('target: ops@example.com')).toHaveLength(2);
    expect(screen.getAllByText('subscription: sub-1')).toHaveLength(2);
    expect(formatDateTime).toHaveBeenCalledWith('2026-03-28T00:00:00.000Z');
    expect(formatDateTime).toHaveBeenCalledWith('2026-03-28T01:00:00.000Z');
    expect(formatDateTime).toHaveBeenCalledWith(null);
  });
});
