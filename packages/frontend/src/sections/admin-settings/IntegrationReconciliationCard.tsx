import React from 'react';

type ReconciliationLog = {
  id: string;
  idempotencyKey: string;
  reexportOfId?: string | null;
  status?: string | null;
  exportedCount?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
};

export type IntegrationReconciliationSummary = {
  periodKey: string;
  attendance: {
    latestClosing?: {
      id: string;
      periodKey: string;
      version: number;
      status: string;
      closedAt: string;
      summaryCount: number;
      sourceTimeEntryCount: number;
      sourceLeaveRequestCount: number;
    } | null;
  };
  payroll: {
    latestEmployeeMasterExport?: ReconciliationLog | null;
    latestEmployeeMasterFullExport?: ReconciliationLog | null;
    comparisonStatus: string;
    attendanceEmployeeCount?: number | null;
    employeeMasterExportCount?: number | null;
    matchedEmployeeCount?: number | null;
    countsAligned?: boolean | null;
    attendanceOnlyCount: number;
    attendanceOnlyEmployeeCodes: string[];
    employeeMasterOnlyCount: number;
    employeeMasterOnlyEmployeeCodes: string[];
  };
  accounting: {
    latestIcsExport?: ReconciliationLog | null;
    comparisonStatus: string;
    latestExportedCount?: number | null;
    countsAligned?: boolean | null;
    mappingComplete: boolean;
    staging: {
      totalCount: number;
      readyCount: number;
      pendingMappingCount: number;
      blockedCount: number;
      invalidReadyCount: number;
      readyAmountTotal: string;
      readyDebitTotal: string;
      readyCreditTotal: string;
      debitCreditBalanced: boolean;
    };
  };
  hasBlockingDifferences: boolean;
};

type IntegrationReconciliationCardProps = {
  periodKey: string;
  setPeriodKey: React.Dispatch<React.SetStateAction<string>>;
  summary: IntegrationReconciliationSummary | null;
  onLoad: () => void;
  formatDateTime: (value?: string | null) => string;
};

function renderCodes(values: string[]) {
  if (!values.length) return '-';
  return values.join(', ');
}

function renderCountsAligned(value?: boolean | null) {
  if (value === null || value === undefined) return '-';
  return value ? '一致' : '不一致';
}

export const IntegrationReconciliationCard = ({
  periodKey,
  setPeriodKey,
  summary,
  onLoad,
  formatDateTime,
}: IntegrationReconciliationCardProps) => {
  const badgeLabel =
    summary === null
      ? '未取得'
      : summary.hasBlockingDifferences
        ? 'blocking'
        : 'ok';

  return (
    <div
      className="card"
      style={{ padding: 12 }}
      data-testid="integration-reconciliation-card"
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>連携照合サマリ</strong>
        <span className="badge">{badgeLabel}</span>
      </div>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <label>
          照合対象月
          <input
            aria-label="照合対象月"
            data-testid="integration-reconciliation-period-key"
            type="month"
            value={periodKey}
            onChange={(event) => setPeriodKey(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          type="button"
          onClick={onLoad}
          data-testid="integration-reconciliation-load"
        >
          照合サマリ取得
        </button>
      </div>
      {!summary && (
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          未取得
        </div>
      )}
      {summary && (
        <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <div className="card" style={{ padding: 12 }}>
            <strong>勤怠締め</strong>
            <div>periodKey: {summary.periodKey}</div>
            <div>
              latestClosing:{' '}
              {summary.attendance.latestClosing
                ? `${summary.attendance.latestClosing.id} / v${summary.attendance.latestClosing.version}`
                : '-'}
            </div>
            <div>
              closedAt:{' '}
              {formatDateTime(
                summary.attendance.latestClosing?.closedAt || null,
              )}
            </div>
            <div>
              summaries: {summary.attendance.latestClosing?.summaryCount ?? '-'}{' '}
              / timeEntries:{' '}
              {summary.attendance.latestClosing?.sourceTimeEntryCount ?? '-'} /
              leaveRequests:{' '}
              {summary.attendance.latestClosing?.sourceLeaveRequestCount ?? '-'}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <strong>給与連携照合</strong>
            <div>comparisonStatus: {summary.payroll.comparisonStatus}</div>
            <div>
              attendanceEmployees:{' '}
              {summary.payroll.attendanceEmployeeCount ?? '-'} /
              employeeMasterExport:{' '}
              {summary.payroll.employeeMasterExportCount ?? '-'} / matched:{' '}
              {summary.payroll.matchedEmployeeCount ?? '-'}
            </div>
            <div>
              countsAligned:{' '}
              {renderCountsAligned(summary.payroll.countsAligned)}
            </div>
            <div>
              attendanceOnly ({summary.payroll.attendanceOnlyCount}):{' '}
              {renderCodes(summary.payroll.attendanceOnlyEmployeeCodes)}
            </div>
            <div>
              employeeMasterOnly ({summary.payroll.employeeMasterOnlyCount}):{' '}
              {renderCodes(summary.payroll.employeeMasterOnlyEmployeeCodes)}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
              latestFullExport:{' '}
              {summary.payroll.latestEmployeeMasterFullExport
                ? `${summary.payroll.latestEmployeeMasterFullExport.id} / ${summary.payroll.latestEmployeeMasterFullExport.status || '-'} / count=${summary.payroll.latestEmployeeMasterFullExport.exportedCount ?? '-'}`
                : '-'}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              latestDeltaExport:{' '}
              {summary.payroll.latestEmployeeMasterExport
                ? `${summary.payroll.latestEmployeeMasterExport.id} / ${summary.payroll.latestEmployeeMasterExport.status || '-'} / count=${summary.payroll.latestEmployeeMasterExport.exportedCount ?? '-'}`
                : '-'}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <strong>会計連携照合</strong>
            <div>comparisonStatus: {summary.accounting.comparisonStatus}</div>
            <div>
              mappingComplete:{' '}
              {summary.accounting.mappingComplete ? 'yes' : 'no'}
            </div>
            <div>
              latestExportedCount:{' '}
              {summary.accounting.latestExportedCount ?? '-'} / countsAligned:{' '}
              {renderCountsAligned(summary.accounting.countsAligned)}
            </div>
            <div>
              latestIcsExport:{' '}
              {summary.accounting.latestIcsExport
                ? `${summary.accounting.latestIcsExport.id} / ${summary.accounting.latestIcsExport.status || '-'} / count=${summary.accounting.latestIcsExport.exportedCount ?? '-'}`
                : '-'}
            </div>
            <div style={{ marginTop: 6 }}>
              staging: total={summary.accounting.staging.totalCount} / ready=
              {summary.accounting.staging.readyCount} / pending_mapping=
              {summary.accounting.staging.pendingMappingCount} / blocked=
              {summary.accounting.staging.blockedCount}
            </div>
            <div>
              invalidReady={summary.accounting.staging.invalidReadyCount} /
              amount={summary.accounting.staging.readyAmountTotal}
            </div>
            <div>
              debit={summary.accounting.staging.readyDebitTotal} / credit=
              {summary.accounting.staging.readyCreditTotal} / balanced=
              {summary.accounting.staging.debitCreditBalanced ? 'yes' : 'no'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
