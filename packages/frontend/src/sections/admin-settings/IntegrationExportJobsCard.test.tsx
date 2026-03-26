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
  IntegrationExportJobsCard,
  type IntegrationExportJobItem,
} from './IntegrationExportJobsCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createItem(
  overrides: Partial<IntegrationExportJobItem> = {},
): IntegrationExportJobItem {
  return {
    kind: 'accounting_ics_export',
    id: 'job-1',
    idempotencyKey: 'idem-1',
    status: 'success',
    exportedCount: 3,
    startedAt: '2026-03-26T00:00:00.000Z',
    finishedAt: '2026-03-26T01:00:00.000Z',
    scope: { periodKey: '2026-03' },
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<
    React.ComponentProps<typeof IntegrationExportJobsCard>
  > = {},
) {
  const setKindFilter = vi.fn();
  const setStatusFilter = vi.fn();
  const setLimit = vi.fn();
  const setOffset = vi.fn();
  const onLoad = vi.fn();
  const onRedispatch = vi.fn();
  const formatDateTime = vi.fn((value?: string | null) =>
    value ? `fmt:${value}` : '-',
  );

  render(
    <IntegrationExportJobsCard
      kindFilter=""
      setKindFilter={setKindFilter}
      statusFilter=""
      setStatusFilter={setStatusFilter}
      limit={25}
      setLimit={setLimit}
      offset={0}
      setOffset={setOffset}
      items={[]}
      loading={false}
      redispatchingId={null}
      onLoad={onLoad}
      onRedispatch={onRedispatch}
      formatDateTime={formatDateTime}
      {...overrides}
    />,
  );

  return {
    setKindFilter,
    setStatusFilter,
    setLimit,
    setOffset,
    onLoad,
    onRedispatch,
    formatDateTime,
  };
}

describe('IntegrationExportJobsCard', () => {
  it('renders empty state and delegates filter actions', () => {
    const { setKindFilter, setStatusFilter, setLimit, setOffset, onLoad } =
      renderCard();

    expect(screen.getByText('ジョブなし')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('連携ジョブ種別'), {
      target: { value: 'accounting_ics_export' },
    });
    expect(setKindFilter).toHaveBeenCalledWith('accounting_ics_export');

    fireEvent.change(screen.getByLabelText('連携ジョブステータス'), {
      target: { value: 'failed' },
    });
    expect(setStatusFilter).toHaveBeenCalledWith('failed');

    fireEvent.change(screen.getByLabelText('連携ジョブlimit'), {
      target: { value: '101' },
    });
    expect(setLimit).toHaveBeenCalledWith(100);

    fireEvent.change(screen.getByLabelText('連携ジョブoffset'), {
      target: { value: '-5' },
    });
    expect(setOffset).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole('button', { name: '連携ジョブ取得' }));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('falls back to current limit and zero offset for invalid numeric input', () => {
    const { setLimit, setOffset } = renderCard({ limit: 20, offset: 7 });

    fireEvent.change(screen.getByLabelText('連携ジョブlimit'), {
      target: { value: 'invalid' },
    });
    expect(setLimit).toHaveBeenCalledWith(20);

    fireEvent.change(screen.getByLabelText('連携ジョブoffset'), {
      target: { value: 'invalid' },
    });
    expect(setOffset).toHaveBeenCalledWith(0);
  });

  it('renders job details, scope labels, and dispatch actions by status', () => {
    const firstItem = createItem();
    const secondItem = createItem({
      id: 'job-2',
      kind: 'hr_leave_export_payroll',
      status: 'running',
      exportedCount: null,
      startedAt: null,
      finishedAt: null,
      message: null,
      scope: {
        target: 'payroll',
        updatedSince: '2026-03-01T00:00:00.000Z',
      },
    });
    const { onRedispatch, formatDateTime } = renderCard({
      items: [firstItem, secondItem],
      redispatchingId: 'job-2',
    });

    const firstCard = within(
      screen.getByTestId('integration-export-job-job-1'),
    );
    expect(firstCard.getByText('ICS仕訳CSV')).toBeInTheDocument();
    expect(firstCard.getByText(/scope: periodKey=2026-03/)).toBeInTheDocument();
    expect(firstCard.getByText(/idempotencyKey: idem-1/)).toBeInTheDocument();
    expect(firstCard.getByText(/reexportOfId: -/)).toBeInTheDocument();
    expect(firstCard.getByText(/message: -/)).toBeInTheDocument();
    fireEvent.click(firstCard.getByRole('button', { name: '再出力' }));
    expect(onRedispatch).toHaveBeenCalledWith(firstItem);

    const secondCard = within(
      screen.getByTestId('integration-export-job-job-2'),
    );
    expect(secondCard.getByText('休暇CSV（給与）')).toBeInTheDocument();
    expect(
      secondCard.getByText(
        /scope: target=payroll \/ updatedSince=2026-03-01T00:00:00.000Z/,
      ),
    ).toBeInTheDocument();
    expect(
      secondCard.getByRole('button', { name: '再出力中...' }),
    ).toBeDisabled();

    expect(formatDateTime).toHaveBeenCalledWith('2026-03-26T00:00:00.000Z');
    expect(formatDateTime).toHaveBeenCalledWith('2026-03-26T01:00:00.000Z');
    expect(formatDateTime).toHaveBeenCalledWith(null);
  });

  it('disables reload while loading', () => {
    const { onLoad } = renderCard({ loading: true });

    const button = screen.getByRole('button', { name: '連携ジョブ取得' });
    expect(button).toBeDisabled();
    expect(screen.getByText('loading')).toBeInTheDocument();

    fireEvent.click(button);
    expect(onLoad).not.toHaveBeenCalled();
  });
});
