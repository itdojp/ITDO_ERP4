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
  IntegrationSettingsCard,
  type IntegrationFormState,
  type IntegrationRunItem,
  type IntegrationRunMetrics,
  type IntegrationSettingsCardItem,
} from './IntegrationSettingsCard';

const baseForm: IntegrationFormState = {
  type: 'hr',
  name: 'HRIS',
  provider: 'azure_ad',
  status: 'active',
  schedule: '0 3 * * *',
  configJson: '{"tenant":"example"}',
};

const integrationTypes = ['hr', 'crm', 'scim'];
const integrationStatuses = ['active', 'disabled'];
const formatDateTime = vi.fn((value?: string | null) =>
  value ? `dt:${value}` : '-',
);

const items: IntegrationSettingsCardItem[] = [
  {
    id: 'setting-1',
    type: 'hr',
    name: 'HRIS',
    provider: 'azure_ad',
    status: 'active',
    schedule: '0 3 * * *',
    lastRunAt: '2026-03-25T00:00:00Z',
    lastRunStatus: 'success',
  },
  {
    id: 'setting-2',
    type: 'crm',
    name: null,
    provider: null,
    status: 'disabled',
    schedule: null,
    lastRunAt: null,
    lastRunStatus: null,
  },
];

const runs: IntegrationRunItem[] = [
  {
    id: 'run-1',
    settingId: 'setting-1',
    status: 'success',
    startedAt: '2026-03-25T00:00:00Z',
    finishedAt: '2026-03-25T00:10:00Z',
    message: 'completed',
    retryCount: 1,
    nextRetryAt: null,
  },
  {
    id: 'run-2',
    settingId: 'setting-2',
    status: null,
    startedAt: null,
    finishedAt: null,
    message: null,
    retryCount: null,
    nextRetryAt: '2026-03-26T00:00:00Z',
  },
];

const metrics: IntegrationRunMetrics = {
  window: { days: 7 },
  summary: {
    totalRuns: 10,
    successRuns: 7,
    failedRuns: 2,
    runningRuns: 1,
    retryScheduledRuns: 3,
    successRate: null,
    avgDurationMs: 1200,
    p95DurationMs: null,
  },
  failureReasons: [{ reason: 'timeout', count: 2 }],
  byType: [
    {
      type: 'hr',
      totalRuns: 6,
      successRuns: 5,
      failedRuns: 1,
      runningRuns: 0,
      successRate: 83,
    },
  ],
};

function renderCard(
  overrides: Partial<React.ComponentProps<typeof IntegrationSettingsCard>> = {},
) {
  const props: React.ComponentProps<typeof IntegrationSettingsCard> = {
    integrationForm: baseForm,
    setIntegrationForm: vi.fn(),
    integrationTypes,
    integrationStatuses,
    editingIntegrationId: null,
    onSubmit: vi.fn(),
    onReset: vi.fn(),
    onReload: vi.fn(),
    onShowRuns: vi.fn(),
    integrationRunFilterId: '',
    setIntegrationRunFilterId: vi.fn(),
    items: [],
    onEdit: vi.fn(),
    onRun: vi.fn(),
    runs: [],
    metrics: null,
    formatDateTime,
    ...overrides,
  };

  const renderResult = render(<IntegrationSettingsCard {...props} />);
  return { props, ...renderResult };
}
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('IntegrationSettingsCard', () => {
  it('updates form fields and delegates create mode actions', () => {
    const setIntegrationForm = vi.fn();
    const onSubmit = vi.fn();
    const onReset = vi.fn();
    const onReload = vi.fn();
    const onShowRuns = vi.fn();
    const setIntegrationRunFilterId = vi.fn();

    renderCard({
      setIntegrationForm,
      onSubmit,
      onReset,
      onReload,
      onShowRuns,
      setIntegrationRunFilterId,
      items,
    });

    fireEvent.change(screen.getByLabelText('種別'), {
      target: { value: 'crm' },
    });
    expect(setIntegrationForm).toHaveBeenNthCalledWith(1, {
      ...baseForm,
      type: 'crm',
    });

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: 'CRM Sync' },
    });
    expect(setIntegrationForm).toHaveBeenNthCalledWith(2, {
      ...baseForm,
      name: 'CRM Sync',
    });

    fireEvent.change(screen.getByLabelText('プロバイダ'), {
      target: { value: 'salesforce' },
    });
    expect(setIntegrationForm).toHaveBeenNthCalledWith(3, {
      ...baseForm,
      provider: 'salesforce',
    });

    fireEvent.change(screen.getByLabelText('ステータス'), {
      target: { value: 'disabled' },
    });
    expect(setIntegrationForm).toHaveBeenNthCalledWith(4, {
      ...baseForm,
      status: 'disabled',
    });

    fireEvent.change(screen.getByLabelText('スケジュール'), {
      target: { value: '0 5 * * *' },
    });
    expect(setIntegrationForm).toHaveBeenNthCalledWith(5, {
      ...baseForm,
      schedule: '0 5 * * *',
    });

    fireEvent.change(screen.getByLabelText('config (JSON)'), {
      target: { value: '{"tenant":"demo"}' },
    });
    expect(setIntegrationForm).toHaveBeenNthCalledWith(6, {
      ...baseForm,
      configJson: '{"tenant":"demo"}',
    });

    fireEvent.change(screen.getByLabelText('履歴フィルタ'), {
      target: { value: 'setting-1' },
    });
    expect(setIntegrationRunFilterId).toHaveBeenCalledWith('setting-1');

    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onShowRuns).not.toHaveBeenCalled();
  });

  it('selects a run filter and passes the selected value to onShowRuns', () => {
    const onShowRuns = vi.fn();
    const setIntegrationRunFilterId = vi.fn();

    const { rerender, props } = renderCard({
      onShowRuns,
      setIntegrationRunFilterId,
      integrationRunFilterId: '',
      items,
    });

    fireEvent.change(screen.getByLabelText('履歴フィルタ'), {
      target: { value: 'setting-1' },
    });
    expect(setIntegrationRunFilterId).toHaveBeenCalledWith('setting-1');

    rerender(
      <IntegrationSettingsCard
        {...props}
        onShowRuns={onShowRuns}
        setIntegrationRunFilterId={setIntegrationRunFilterId}
        integrationRunFilterId="setting-1"
        items={items}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '履歴表示' }));
    expect(onShowRuns).toHaveBeenCalledWith('setting-1');
  });

  it('switches labels in edit mode and shows the current run filter', () => {
    const onShowRuns = vi.fn();

    renderCard({
      editingIntegrationId: 'setting-1',
      onShowRuns,
      integrationRunFilterId: 'setting-1',
      items,
    });

    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'キャンセル' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '履歴表示' }));
    expect(onShowRuns).toHaveBeenCalledWith('setting-1');
  });

  it('renders items, metrics, runs, and delegates item actions', () => {
    const onEdit = vi.fn();
    const onRun = vi.fn();

    renderCard({
      items,
      metrics,
      runs,
      onEdit,
      onRun,
    });

    const editButtons = screen.getAllByRole('button', { name: '編集' });
    const firstItemCard = editButtons[0].closest('.card');
    const secondItemCard = editButtons[1].closest('.card');

    expect(firstItemCard).not.toBeNull();
    expect(secondItemCard).not.toBeNull();

    expect(
      within(firstItemCard as HTMLElement).getByText('hr'),
    ).toBeInTheDocument();
    expect(
      within(firstItemCard as HTMLElement).getByText(/\/ HRIS$/),
    ).toBeInTheDocument();
    expect(
      within(firstItemCard as HTMLElement).getByText(
        'provider: azure_ad / schedule: 0 3 * * *',
      ),
    ).toBeInTheDocument();
    expect(
      within(firstItemCard as HTMLElement).getByText(
        (_, node) =>
          node?.textContent ===
          'lastRun: dt:2026-03-25T00:00:00Z / status: success',
      ),
    ).toBeInTheDocument();

    expect(
      within(secondItemCard as HTMLElement).getByText('crm'),
    ).toBeInTheDocument();
    expect(
      within(secondItemCard as HTMLElement).getByText(
        'provider: - / schedule: -',
      ),
    ).toBeInTheDocument();
    expect(
      within(secondItemCard as HTMLElement).getByText(
        (_, node) => node?.textContent === 'lastRun: - / status: -',
      ),
    ).toBeInTheDocument();

    expect(screen.getByText('実行メトリクス')).toBeInTheDocument();
    expect(screen.getByText('直近 7 日')).toBeInTheDocument();
    expect(
      screen.getByText('total: 10 / success: 7 / failed: 2 / running: 1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('successRate: - / avg(ms): 1200 / p95(ms): -'),
    ).toBeInTheDocument();
    expect(screen.getByText('retryScheduled: 3')).toBeInTheDocument();
    expect(screen.getByText('failureReasons: timeout (2)')).toBeInTheDocument();
    expect(screen.getByText('byType: hr: 6 (ok 5 / ng 1)')).toBeInTheDocument();

    expect(
      screen.getByText((_, node) => node?.textContent === 'success / retry: 1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === '- / retry: 0'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          'finished: dt:2026-03-25T00:10:00Z / nextRetry: -',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          'finished: - / nextRetry: dt:2026-03-26T00:00:00Z',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('message: completed')).toBeInTheDocument();
    expect(screen.getByText('message: -')).toBeInTheDocument();
    expect(screen.getByText('setting: setting-2')).toBeInTheDocument();

    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(items[0]);

    const runButtons = screen.getAllByRole('button', { name: '実行' });
    expect(runButtons[1]).toBeDisabled();
    fireEvent.click(runButtons[0]);
    expect(onRun).toHaveBeenCalledWith('setting-1');
  });

  it('shows empty states when no items or runs are present', () => {
    renderCard({ items: [], runs: [], metrics: null });

    expect(screen.getByText('設定なし')).toBeInTheDocument();
    expect(screen.queryByText('実行メトリクス')).not.toBeInTheDocument();
    expect(screen.getByText('連携履歴なし')).toBeInTheDocument();
  });
});
