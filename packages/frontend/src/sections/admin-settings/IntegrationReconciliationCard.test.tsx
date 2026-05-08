import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IntegrationReconciliationCard,
  type IntegrationReconciliationDetails,
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

function createDetails(
  overrides: Partial<IntegrationReconciliationDetails> = {},
): IntegrationReconciliationDetails {
  return {
    periodKey: '2026-03',
    payroll: {
      latestClosingId: 'closing-1',
      latestEmployeeMasterFullExportId: 'payroll-full-1',
      attendanceOnlyEmployeeCodes: ['E001', 'E002'],
      employeeMasterOnlyEmployeeCodes: ['E010'],
    },
    accounting: {
      byProject: [
        {
          key: 'PRJ-001',
          totalCount: 3,
          readyCount: 1,
          pendingMappingCount: 1,
          blockedCount: 1,
          invalidReadyCount: 0,
          readyAmountTotal: '2000',
        },
      ],
      byDepartment: [
        {
          key: 'DEP-A',
          totalCount: 2,
          readyCount: 1,
          pendingMappingCount: 1,
          blockedCount: 0,
          invalidReadyCount: 0,
          readyAmountTotal: '2000',
        },
      ],
      pendingMappingSamples: [
        {
          id: 'stg-001',
          eventId: 'evt-001',
          sourceTable: 'expenses',
          sourceId: 'exp-001',
          status: 'pending_mapping',
          mappingKey: 'expense:meal',
          description: 'meal',
          projectCode: 'PRJ-001',
          departmentCode: 'DEP-A',
          debitAccountCode: null,
          creditAccountCode: null,
          taxCode: null,
          amount: '1200',
        },
      ],
      blockedSamples: [
        {
          id: 'stg-002',
          eventId: 'evt-002',
          sourceTable: 'invoices',
          sourceId: 'inv-001',
          status: 'blocked',
          mappingKey: 'invoice:service',
          description: 'invoice',
          projectCode: 'PRJ-002',
          departmentCode: null,
          debitAccountCode: null,
          creditAccountCode: null,
          taxCode: null,
          amount: '1800',
        },
      ],
      invalidReadySamples: [
        {
          id: 'stg-003',
          eventId: 'evt-003',
          sourceTable: 'vendor_invoices',
          sourceId: 'vin-001',
          status: 'ready',
          mappingKey: 'vendor_invoice:office',
          description: 'office',
          projectCode: null,
          departmentCode: 'DEP-B',
          debitAccountCode: '',
          creditAccountCode: '2100',
          taxCode: 'A01',
          amount: '3000',
        },
      ],
    },
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
  const onLoadDetails = vi.fn();
  const formatDateTime = vi.fn((value?: string | null) =>
    value ? `fmt:${value}` : '-',
  );

  render(
    <IntegrationReconciliationCard
      periodKey="2026-03"
      setPeriodKey={setPeriodKey}
      summary={null}
      details={null}
      detailsLoading={false}
      detailsError={null}
      onLoad={onLoad}
      onLoadDetails={onLoadDetails}
      formatDateTime={formatDateTime}
      {...overrides}
    />,
  );

  return { setPeriodKey, onLoad, onLoadDetails, formatDateTime };
}

describe('IntegrationReconciliationCard', () => {
  it('renders empty state and delegates period filter/load actions', () => {
    const { setPeriodKey, onLoad, onLoadDetails } = renderCard();

    expect(screen.getByText('連携照合サマリ')).toBeInTheDocument();
    expect(screen.getAllByText('未取得')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('照合対象月'), {
      target: { value: '2026-04' },
    });
    expect(setPeriodKey).toHaveBeenCalledWith('2026-04');

    fireEvent.click(screen.getByRole('button', { name: '照合サマリ取得' }));
    expect(onLoad).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '照合詳細取得' }));
    expect(onLoadDetails).toHaveBeenCalledTimes(1);
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

  it('renders reconciliation details drilldown tables and samples', () => {
    const summary = createSummary();
    const details = createDetails();
    renderCard({ summary, details });

    expect(
      screen.getByTestId('integration-reconciliation-details-panel'),
    ).toBeInTheDocument();
    expect(screen.getByText('loaded')).toBeInTheDocument();
    expect(screen.getByText('給与連携詳細')).toBeInTheDocument();
    expect(screen.getAllByText('periodKey: 2026-03')).toHaveLength(2);
    expect(screen.getByText('latestClosingId: closing-1')).toBeInTheDocument();
    expect(
      screen.getByText('latestEmployeeMasterFullExportId: payroll-full-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('attendanceOnly (2): E001, E002'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('employeeMasterOnly (1): E010'),
    ).toBeInTheDocument();
    expect(screen.getByText('PJ別 breakdown')).toBeInTheDocument();
    expect(screen.getByText('部門別 breakdown')).toBeInTheDocument();
    expect(screen.getByText('PRJ-001')).toBeInTheDocument();
    expect(screen.getByText('DEP-A')).toBeInTheDocument();
    expect(screen.getByText('pending_mapping サンプル')).toBeInTheDocument();
    expect(screen.getByText('blocked サンプル')).toBeInTheDocument();
    expect(screen.getByText('invalid ready サンプル')).toBeInTheDocument();
    expect(
      screen.getByTestId(
        'integration-reconciliation-pending-mapping-sample-stg-001',
      ),
    ).toHaveTextContent('mappingKey: expense:meal / amount: 1200');
    expect(
      screen.getByTestId('integration-reconciliation-blocked-sample-stg-002'),
    ).toHaveTextContent('source: invoices/inv-001 / eventId: evt-002');
    expect(
      screen.getByTestId(
        'integration-reconciliation-invalid-ready-sample-stg-003',
      ),
    ).toHaveTextContent('debit: - / credit: 2100 / tax: A01');
  });

  it('renders details loading, empty, and error branches', () => {
    const { rerender } = render(
      <IntegrationReconciliationCard
        periodKey="2026-03"
        setPeriodKey={vi.fn()}
        summary={createSummary()}
        details={null}
        detailsLoading={true}
        detailsError={null}
        onLoad={vi.fn()}
        onLoadDetails={vi.fn()}
        formatDateTime={(value?: string | null) => value || '-'}
      />,
    );

    expect(
      screen.getByRole('button', { name: '照合詳細取得中...' }),
    ).toBeDisabled();
    expect(screen.getByText('照合詳細を取得中...')).toBeInTheDocument();

    rerender(
      <IntegrationReconciliationCard
        periodKey="2026-03"
        setPeriodKey={vi.fn()}
        summary={createSummary()}
        details={createDetails({
          payroll: {
            latestClosingId: null,
            latestEmployeeMasterFullExportId: null,
            attendanceOnlyEmployeeCodes: [],
            employeeMasterOnlyEmployeeCodes: [],
          },
          accounting: {
            byProject: [],
            byDepartment: [],
            pendingMappingSamples: [],
            blockedSamples: [],
            invalidReadySamples: [],
          },
        })}
        detailsLoading={false}
        detailsError={null}
        onLoad={vi.fn()}
        onLoadDetails={vi.fn()}
        formatDateTime={(value?: string | null) => value || '-'}
      />,
    );
    expect(screen.getByText('照合詳細差異なし')).toBeInTheDocument();
    expect(screen.getAllByText('集計なし')).toHaveLength(2);
    expect(screen.getAllByText('サンプルなし')).toHaveLength(3);

    rerender(
      <IntegrationReconciliationCard
        periodKey="2026-03"
        setPeriodKey={vi.fn()}
        summary={null}
        details={null}
        detailsLoading={false}
        detailsError="連携照合詳細の取得に失敗しました"
        onLoad={vi.fn()}
        onLoadDetails={vi.fn()}
        formatDateTime={(value?: string | null) => value || '-'}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      '連携照合詳細の取得に失敗しました',
    );
  });
});
