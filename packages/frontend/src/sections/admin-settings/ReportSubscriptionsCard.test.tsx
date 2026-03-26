import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ReportSubscriptionsCard,
  type ReportDeliveryItem,
  type ReportFormState,
  type ReportSubscriptionsCardItem,
} from './ReportSubscriptionsCard';

const baseForm: ReportFormState = {
  name: '月次工数レポート',
  reportKey: 'project_hours_monthly',
  format: 'csv',
  schedule: '0 8 * * 1',
  paramsJson: '{"projectId":"project-1"}',
  recipientsJson: '{"roles":["mgmt"]}',
  channels: 'dashboard,email',
  isEnabled: true,
};

const reportFormats = ['csv', 'json'];
const formatDateTime = vi.fn((value?: string | null) =>
  value ? `dt:${value}` : '-',
);

const items: ReportSubscriptionsCardItem[] = [
  {
    id: 'sub-1',
    name: '月次工数レポート',
    reportKey: 'project_hours_monthly',
    format: 'csv',
    schedule: '0 8 * * 1',
    channels: ['dashboard', 'email'],
    isEnabled: true,
    lastRunAt: '2026-03-25T00:00:00Z',
    lastRunStatus: 'success',
  },
  {
    id: 'sub-2',
    name: null,
    reportKey: 'project_profitability',
    format: null,
    schedule: null,
    channels: null,
    isEnabled: false,
    lastRunAt: null,
    lastRunStatus: null,
  },
];

const deliveries: ReportDeliveryItem[] = [
  {
    id: 'delivery-1',
    subscriptionId: 'sub-1',
    channel: 'email',
    status: 'sent',
    target: 'ops@example.com',
    sentAt: '2026-03-26T00:00:00Z',
    createdAt: '2026-03-25T23:50:00Z',
  },
  {
    id: 'delivery-2',
    subscriptionId: null,
    channel: null,
    status: null,
    target: null,
    sentAt: null,
    createdAt: null,
  },
];

function renderCard(
  overrides: Partial<React.ComponentProps<typeof ReportSubscriptionsCard>> = {},
) {
  const props: React.ComponentProps<typeof ReportSubscriptionsCard> = {
    reportForm: baseForm,
    setReportForm: vi.fn(),
    reportFormats,
    reportDryRun: false,
    setReportDryRun: vi.fn(),
    editingReportId: null,
    onSubmit: vi.fn(),
    onReset: vi.fn(),
    onReload: vi.fn(),
    onRunAll: vi.fn(),
    onShowDeliveries: vi.fn(),
    items: [],
    onEdit: vi.fn(),
    onToggle: vi.fn(),
    onRun: vi.fn(),
    reportDeliveryFilterId: '',
    setReportDeliveryFilterId: vi.fn(),
    deliveries: [],
    formatDateTime,
    ...overrides,
  };

  render(<ReportSubscriptionsCard {...props} />);
  return props;
}

function getStrongText(text: string) {
  return screen.getByText(
    (_, node) => node?.tagName === 'STRONG' && node.textContent === text,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  formatDateTime.mockClear();
});

describe('ReportSubscriptionsCard', () => {
  it('updates form fields and delegates create mode actions', () => {
    const setReportForm = vi.fn();
    const setReportDryRun = vi.fn();
    const onSubmit = vi.fn();
    const onReset = vi.fn();
    const onReload = vi.fn();
    const onRunAll = vi.fn();
    const onShowDeliveries = vi.fn();
    const setReportDeliveryFilterId = vi.fn();

    renderCard({
      setReportForm,
      setReportDryRun,
      onSubmit,
      onReset,
      onReload,
      onRunAll,
      onShowDeliveries,
      setReportDeliveryFilterId,
      reportDeliveryFilterId: '',
      items,
    });

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '週次工数レポート' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(1, {
      ...baseForm,
      name: '週次工数レポート',
    });

    fireEvent.change(screen.getByLabelText('reportKey'), {
      target: { value: 'project_hours_weekly' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(2, {
      ...baseForm,
      reportKey: 'project_hours_weekly',
    });

    fireEvent.change(screen.getByLabelText('format'), {
      target: { value: 'json' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(3, {
      ...baseForm,
      format: 'json',
    });

    fireEvent.change(screen.getByLabelText('スケジュール'), {
      target: { value: '0 6 * * 1' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(4, {
      ...baseForm,
      schedule: '0 6 * * 1',
    });

    fireEvent.change(screen.getByLabelText('channels (CSV)'), {
      target: { value: 'email,slack' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(5, {
      ...baseForm,
      channels: 'email,slack',
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'enabled' }));
    expect(setReportForm).toHaveBeenNthCalledWith(6, {
      ...baseForm,
      isEnabled: false,
    });

    fireEvent.change(screen.getByLabelText('params (JSON)'), {
      target: { value: '{"projectId":"project-2"}' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(7, {
      ...baseForm,
      paramsJson: '{"projectId":"project-2"}',
    });

    fireEvent.change(screen.getByLabelText('recipients (JSON)'), {
      target: { value: '{"emails":["ops@example.com"]}' },
    });
    expect(setReportForm).toHaveBeenNthCalledWith(8, {
      ...baseForm,
      recipientsJson: '{"emails":["ops@example.com"]}',
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'dry-run' }));
    expect(setReportDryRun).toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByLabelText('購読ID'), {
      target: { value: 'sub-1' },
    });
    expect(setReportDeliveryFilterId).toHaveBeenCalledWith('sub-1');

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

  it('switches labels in edit mode and renders items with fallbacks', () => {
    const onEdit = vi.fn();
    const onToggle = vi.fn();
    const onRun = vi.fn();
    const onShowDeliveries = vi.fn();

    renderCard({
      editingReportId: 'sub-1',
      items,
      deliveries,
      onEdit,
      onToggle,
      onRun,
      onShowDeliveries,
      reportDeliveryFilterId: 'sub-1',
    });

    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'キャンセル' }),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent === 'project_hours_monthly / 月次工数レポート',
      ),
    ).toBeInTheDocument();
    expect(getStrongText('project_profitability')).toBeInTheDocument();
    expect(
      screen.getByText(
        'format: csv / schedule: 0 8 * * 1 / channels: dashboard, email',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('format: - / schedule: - / channels: -'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          'lastRun: dt:2026-03-25T00:00:00Z / status: success',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) => node?.textContent === 'lastRun: - / status: -',
      ),
    ).toBeInTheDocument();

    const editButtons = screen.getAllByRole('button', { name: '編集' });
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(items[0]);

    const toggleButtons = screen.getAllByRole('button', {
      name: /無効化|有効化/,
    });
    fireEvent.click(toggleButtons[0]);
    fireEvent.click(toggleButtons[1]);
    expect(onToggle).toHaveBeenNthCalledWith(1, items[0]);
    expect(onToggle).toHaveBeenNthCalledWith(2, items[1]);

    const runButtons = screen.getAllByRole('button', { name: '実行' });
    expect(runButtons[1]).toBeDisabled();
    fireEvent.click(runButtons[0]);
    expect(onRun).toHaveBeenCalledWith('sub-1');

    const deliveryButtons = screen.getAllByRole('button', { name: '配信履歴' });
    fireEvent.click(deliveryButtons[0]);
    expect(onShowDeliveries).toHaveBeenCalledWith('sub-1');
  });

  it('renders delivery list and delivery fallbacks', () => {
    renderCard({ deliveries, reportDeliveryFilterId: 'sub-1' });

    expect(screen.getByText('filter: sub-1')).toBeInTheDocument();
    expect(getStrongText('email')).toBeInTheDocument();
    expect(getStrongText('-')).toBeInTheDocument();
    expect(screen.getByText('target: ops@example.com')).toBeInTheDocument();
    expect(screen.getByText('target: -')).toBeInTheDocument();
    expect(screen.getByText('subscription: sub-1')).toBeInTheDocument();
    expect(screen.getByText('subscription: -')).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === 'email / sent'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === '- / -'),
    ).toBeInTheDocument();
  });

  it('shows empty states when subscriptions and deliveries are absent', () => {
    renderCard({ items: [], deliveries: [], reportDeliveryFilterId: '' });

    expect(screen.getByText('購読なし')).toBeInTheDocument();
    expect(screen.getByText('filter: all')).toBeInTheDocument();
    expect(screen.getByText('履歴なし')).toBeInTheDocument();
  });
});
