import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IntegrationReconciliationCard,
  type IntegrationReconciliationSummary,
} from './IntegrationReconciliationCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createSummary(
  overrides: Partial<IntegrationReconciliationSummary> = {},
): IntegrationReconciliationSummary {
  return {
    periodKey: '2026-03',
    attendance: {
      latestClosing: {
        id: 'closing-1',
        periodKey: '2026-03',
        version: 2,
        status: 'closed',
        closedAt: '2026-03-26T00:00:00.000Z',
        summaryCount: 14,
        sourceTimeEntryCount: 41,
        sourceLeaveRequestCount: 3,
      },
    },
    payroll: {
      latestEmployeeMasterExport: {
        id: 'payroll-delta-1',
        idempotencyKey: 'idem-delta',
        status: 'success',
        exportedCount: 10,
      },
      latestEmployeeMasterFullExport: {
        id: 'payroll-full-1',
        idempotencyKey: 'idem-full',
        status: 'failed',
        exportedCount: 12,
      },
      comparisonStatus: 'mismatch',
      attendanceEmployeeCount: 11,
      employeeMasterExportCount: 10,
      matchedEmployeeCount: 9,
      countsAligned: false,
      attendanceOnlyCount: 1,
      attendanceOnlyEmployeeCodes: ['E001'],
      employeeMasterOnlyCount: 2,
      employeeMasterOnlyEmployeeCodes: ['E010', 'E011'],
    },
    accounting: {
      latestIcsExport: {
        id: 'ics-1',
        idempotencyKey: 'idem-ics',
        status: 'success',
        exportedCount: 8,
      },
      comparisonStatus: 'ready',
      latestExportedCount: 8,
      countsAligned: true,
      mappingComplete: false,
      staging: {
        totalCount: 12,
        readyCount: 8,
        pendingMappingCount: 2,
        blockedCount: 1,
        invalidReadyCount: 1,
        readyAmountTotal: '1200',
        readyDebitTotal: '600',
        readyCreditTotal: '600',
        debitCreditBalanced: true,
      },
    },
    hasBlockingDifferences: true,
    ...overrides,
  };
}

function getByTextContent(text: string) {
  return screen.getByText((_, element) => element?.textContent === text);
}

function renderCard(
  overrides: Partial<
    React.ComponentProps<typeof IntegrationReconciliationCard>
  > = {},
) {
  const setPeriodKey = vi.fn();
  const onLoad = vi.fn();
  const formatDateTime = vi.fn((value?: string | null) =>
    value ? `fmt:${value}` : '-',
  );

  render(
    <IntegrationReconciliationCard
      periodKey="2026-03"
      setPeriodKey={setPeriodKey}
      summary={null}
      onLoad={onLoad}
      formatDateTime={formatDateTime}
      {...overrides}
    />,
  );

  return { setPeriodKey, onLoad, formatDateTime };
}

describe('IntegrationReconciliationCard', () => {
  it('renders empty state and delegates period filter/load actions', () => {
    const { setPeriodKey, onLoad } = renderCard();

    expect(screen.getByText('連携照合サマリ')).toBeInTheDocument();
    expect(screen.getAllByText('未取得')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('照合対象月'), {
      target: { value: '2026-04' },
    });
    expect(setPeriodKey).toHaveBeenCalledWith('2026-04');

    fireEvent.click(screen.getByRole('button', { name: '照合サマリ取得' }));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('renders summary details and blocking badge', () => {
    const summary = createSummary();
    const { formatDateTime } = renderCard({ summary, periodKey: '2026-03' });

    expect(screen.getByText('blocking')).toBeInTheDocument();
    expect(screen.getByText('periodKey: 2026-03')).toBeInTheDocument();
    expect(
      screen.getByText('latestClosing: closing-1 / v2'),
    ).toBeInTheDocument();
    expect(
      getByTextContent('summaries: 14 / timeEntries: 41 / leaveRequests: 3'),
    ).toBeInTheDocument();
    expect(screen.getByText('comparisonStatus: mismatch')).toBeInTheDocument();
    expect(
      getByTextContent(
        'attendanceEmployees: 11 / employeeMasterExport: 10 / matched: 9',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('countsAligned: 不一致')).toBeInTheDocument();
    expect(screen.getByText('attendanceOnly (1): E001')).toBeInTheDocument();
    expect(
      screen.getByText('employeeMasterOnly (2): E010, E011'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('latestFullExport: payroll-full-1 / failed / count=12'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'latestDeltaExport: payroll-delta-1 / success / count=10',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('comparisonStatus: ready')).toBeInTheDocument();
    expect(screen.getByText('mappingComplete: no')).toBeInTheDocument();
    expect(
      screen.getByText('latestExportedCount: 8 / countsAligned: 一致'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('latestIcsExport: ics-1 / success / count=8'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'staging: total=12 / ready=8 / pending_mapping=2 / blocked=1',
      ),
    ).toBeInTheDocument();
    expect(
      getByTextContent('invalidReady=1 / amount=1200'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('debit=600 / credit=600 / balanced=yes'),
    ).toBeInTheDocument();

    expect(formatDateTime).toHaveBeenCalledWith('2026-03-26T00:00:00.000Z');
  });

  it('renders ok badge and fallbacks when optional values are absent', () => {
    const summary = createSummary({
      attendance: { latestClosing: null },
      payroll: {
        latestEmployeeMasterExport: null,
        latestEmployeeMasterFullExport: null,
        comparisonStatus: 'ok',
        attendanceEmployeeCount: null,
        employeeMasterExportCount: null,
        matchedEmployeeCount: null,
        countsAligned: null,
        attendanceOnlyCount: 0,
        attendanceOnlyEmployeeCodes: [],
        employeeMasterOnlyCount: 0,
        employeeMasterOnlyEmployeeCodes: [],
      },
      accounting: {
        latestIcsExport: null,
        comparisonStatus: 'pending',
        latestExportedCount: null,
        countsAligned: null,
        mappingComplete: true,
        staging: {
          totalCount: 0,
          readyCount: 0,
          pendingMappingCount: 0,
          blockedCount: 0,
          invalidReadyCount: 0,
          readyAmountTotal: '0',
          readyDebitTotal: '0',
          readyCreditTotal: '0',
          debitCreditBalanced: false,
        },
      },
      hasBlockingDifferences: false,
    });
    const { formatDateTime } = renderCard({ summary });

    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('latestClosing: -')).toBeInTheDocument();
    expect(screen.getByText('closedAt: -')).toBeInTheDocument();
    expect(
      getByTextContent('summaries: - / timeEntries: - / leaveRequests: -'),
    ).toBeInTheDocument();
    expect(screen.getByText('countsAligned: -')).toBeInTheDocument();
    expect(screen.getByText('attendanceOnly (0): -')).toBeInTheDocument();
    expect(screen.getByText('employeeMasterOnly (0): -')).toBeInTheDocument();
    expect(screen.getByText('latestFullExport: -')).toBeInTheDocument();
    expect(screen.getByText('latestDeltaExport: -')).toBeInTheDocument();
    expect(screen.getByText('mappingComplete: yes')).toBeInTheDocument();
    expect(
      screen.getByText('latestExportedCount: - / countsAligned: -'),
    ).toBeInTheDocument();
    expect(screen.getByText('latestIcsExport: -')).toBeInTheDocument();
    expect(
      screen.getByText('debit=0 / credit=0 / balanced=no'),
    ).toBeInTheDocument();

    expect(formatDateTime).toHaveBeenCalledWith(null);
  });
});
