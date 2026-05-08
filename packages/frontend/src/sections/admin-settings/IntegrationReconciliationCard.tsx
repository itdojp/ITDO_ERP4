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
    statutoryActuals?: {
      latestImportBatchKey?: string | null;
      latestAccountingSystem?: string | null;
      latestImportedAt?: string | null;
      importedCount: number;
      amountTotal: string;
      internalReadyDebitTotal: string;
      varianceAmount?: string | null;
      comparisonStatus: string;
    } | null;
  };
  hasBlockingDifferences: boolean;
};

export type IntegrationReconciliationBreakdownRow = {
  key: string;
  totalCount: number;
  readyCount: number;
  pendingMappingCount: number;
  blockedCount: number;
  invalidReadyCount: number;
  readyAmountTotal: string;
  statutoryActualAmountTotal?: string;
  varianceAmount?: string;
};

export type IntegrationReconciliationSampleRow = {
  id: string;
  eventId: string;
  sourceTable: string;
  sourceId: string;
  status: string;
  mappingKey?: string | null;
  description?: string | null;
  projectCode?: string | null;
  departmentCode?: string | null;
  debitAccountCode?: string | null;
  creditAccountCode?: string | null;
  taxCode?: string | null;
  amount: string;
};

export type IntegrationReconciliationDetails = {
  periodKey: string;
  payroll: {
    latestClosingId?: string | null;
    latestEmployeeMasterFullExportId?: string | null;
    attendanceOnlyEmployeeCodes: string[];
    employeeMasterOnlyEmployeeCodes: string[];
  };
  accounting: {
    byProject: IntegrationReconciliationBreakdownRow[];
    byDepartment: IntegrationReconciliationBreakdownRow[];
    pendingMappingSamples: IntegrationReconciliationSampleRow[];
    blockedSamples: IntegrationReconciliationSampleRow[];
    invalidReadySamples: IntegrationReconciliationSampleRow[];
  };
};

type IntegrationReconciliationCardProps = {
  periodKey: string;
  setPeriodKey: (value: string) => void;
  summary: IntegrationReconciliationSummary | null;
  details: IntegrationReconciliationDetails | null;
  detailsLoading: boolean;
  detailsError: string | null;
  onLoad: () => void;
  onLoadDetails: () => void;
  formatDateTime: (value?: string | null) => string;
};

const mutedStyle: React.CSSProperties = { fontSize: 12, color: '#475569' };
const tableWrapperStyle: React.CSSProperties = {
  overflowX: 'auto',
  marginTop: 6,
};
const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  minWidth: 760,
  width: '100%',
};
const numericCellStyle: React.CSSProperties = { textAlign: 'right' };

function renderCodes(values: string[]) {
  if (!values.length) return '-';
  return values.join(', ');
}

function renderCountsAligned(value?: boolean | null) {
  if (value === null || value === undefined) return '-';
  return value ? '一致' : '不一致';
}

function renderNullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || '-';
}

function hasAnyDetail(details: IntegrationReconciliationDetails) {
  return (
    details.payroll.attendanceOnlyEmployeeCodes.length > 0 ||
    details.payroll.employeeMasterOnlyEmployeeCodes.length > 0 ||
    details.accounting.byProject.length > 0 ||
    details.accounting.byDepartment.length > 0 ||
    details.accounting.pendingMappingSamples.length > 0 ||
    details.accounting.blockedSamples.length > 0 ||
    details.accounting.invalidReadySamples.length > 0
  );
}

function renderBreakdownTable(
  title: string,
  rows: IntegrationReconciliationBreakdownRow[],
  testId: string,
) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>{title}</strong>
      {rows.length === 0 ? (
        <div style={{ marginTop: 6 }}>集計なし</div>
      ) : (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} data-testid={testId}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>key</th>
                <th style={numericCellStyle}>total</th>
                <th style={numericCellStyle}>ready</th>
                <th style={numericCellStyle}>pending_mapping</th>
                <th style={numericCellStyle}>blocked</th>
                <th style={numericCellStyle}>invalid ready</th>
                <th style={numericCellStyle}>ready amount</th>
                <th style={numericCellStyle}>statutory actual</th>
                <th style={numericCellStyle}>variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${testId}:${row.key}`}>
                  <td>{row.key}</td>
                  <td style={numericCellStyle}>{row.totalCount}</td>
                  <td style={numericCellStyle}>{row.readyCount}</td>
                  <td style={numericCellStyle}>{row.pendingMappingCount}</td>
                  <td style={numericCellStyle}>{row.blockedCount}</td>
                  <td style={numericCellStyle}>{row.invalidReadyCount}</td>
                  <td style={numericCellStyle}>{row.readyAmountTotal}</td>
                  <td style={numericCellStyle}>
                    {row.statutoryActualAmountTotal ?? '0'}
                  </td>
                  <td style={numericCellStyle}>{row.varianceAmount ?? '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function renderSampleRows(
  title: string,
  rows: IntegrationReconciliationSampleRow[],
  testId: string,
) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>{title}</strong>
      {rows.length === 0 ? (
        <div style={{ marginTop: 6 }}>サンプルなし</div>
      ) : (
        <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {rows.map((row) => (
            <div
              key={`${testId}:${row.id}`}
              className="card"
              style={{ padding: 10 }}
              data-testid={`${testId}-${row.id}`}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{row.id}</strong>
                <span className="badge">{row.status}</span>
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                source: {renderNullable(row.sourceTable)}/
                {renderNullable(row.sourceId)} / eventId:{' '}
                {renderNullable(row.eventId)}
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                mappingKey: {renderNullable(row.mappingKey)} / amount:{' '}
                {row.amount}
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                project: {renderNullable(row.projectCode)} / department:{' '}
                {renderNullable(row.departmentCode)}
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                debit: {renderNullable(row.debitAccountCode)} / credit:{' '}
                {renderNullable(row.creditAccountCode)} / tax:{' '}
                {renderNullable(row.taxCode)}
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                description: {renderNullable(row.description)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const IntegrationReconciliationCard = ({
  periodKey,
  setPeriodKey,
  summary,
  details,
  detailsLoading,
  detailsError,
  onLoad,
  onLoadDetails,
  formatDateTime,
}: IntegrationReconciliationCardProps) => {
  const badgeLabel =
    summary === null
      ? '未取得'
      : summary.hasBlockingDifferences
        ? 'blocking'
        : 'ok';
  const shouldShowDetailsPanel =
    Boolean(summary) ||
    Boolean(details) ||
    detailsLoading ||
    Boolean(detailsError);

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
        <button
          className="button secondary"
          type="button"
          onClick={onLoadDetails}
          disabled={detailsLoading}
          data-testid="integration-reconciliation-details-load"
        >
          {detailsLoading ? '照合詳細取得中...' : '照合詳細取得'}
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
            <div style={{ marginTop: 6 }}>
              {`statutoryActuals: status=${
                summary.accounting.statutoryActuals?.comparisonStatus ??
                'not_imported'
              } / imported=${
                summary.accounting.statutoryActuals?.importedCount ?? 0
              } / amount=${
                summary.accounting.statutoryActuals?.amountTotal ?? '0'
              } / variance=${
                summary.accounting.statutoryActuals?.varianceAmount ?? '-'
              }`}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              latestStatutoryImport:{' '}
              {summary.accounting.statutoryActuals?.latestImportBatchKey
                ? `${summary.accounting.statutoryActuals.latestImportBatchKey} / ${summary.accounting.statutoryActuals.latestAccountingSystem || '-'} / importedAt=${formatDateTime(summary.accounting.statutoryActuals.latestImportedAt || null)}`
                : '-'}
            </div>
          </div>
        </div>
      )}

      {shouldShowDetailsPanel && (
        <div
          className="card"
          style={{ marginTop: 8, padding: 12 }}
          data-testid="integration-reconciliation-details-panel"
        >
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>照合詳細</strong>
            <span className="badge">
              {detailsLoading ? 'loading' : details ? 'loaded' : '未取得'}
            </span>
          </div>
          {detailsError && (
            <div role="alert" style={{ marginTop: 8 }}>
              {detailsError}
            </div>
          )}
          {detailsLoading && (
            <div style={{ marginTop: 8 }}>照合詳細を取得中...</div>
          )}
          {!detailsLoading && !details && !detailsError && (
            <div style={{ marginTop: 8 }}>
              照合詳細は未取得です。照合詳細取得を実行してください。
            </div>
          )}
          {details && (
            <div
              className="list"
              style={{ display: 'grid', gap: 8, marginTop: 8 }}
            >
              {!hasAnyDetail(details) && (
                <div className="card" style={{ padding: 12 }}>
                  照合詳細差異なし
                </div>
              )}
              <div className="card" style={{ padding: 12 }}>
                <strong>給与連携詳細</strong>
                <div>periodKey: {details.periodKey}</div>
                <div>
                  latestClosingId:{' '}
                  {renderNullable(details.payroll.latestClosingId)}
                </div>
                <div>
                  latestEmployeeMasterFullExportId:{' '}
                  {renderNullable(
                    details.payroll.latestEmployeeMasterFullExportId,
                  )}
                </div>
                <div>
                  attendanceOnly (
                  {details.payroll.attendanceOnlyEmployeeCodes.length}):{' '}
                  {renderCodes(details.payroll.attendanceOnlyEmployeeCodes)}
                </div>
                <div>
                  employeeMasterOnly (
                  {details.payroll.employeeMasterOnlyEmployeeCodes.length}):{' '}
                  {renderCodes(details.payroll.employeeMasterOnlyEmployeeCodes)}
                </div>
              </div>
              {renderBreakdownTable(
                'PJ別 breakdown',
                details.accounting.byProject,
                'integration-reconciliation-project-breakdown',
              )}
              {renderBreakdownTable(
                '部門別 breakdown',
                details.accounting.byDepartment,
                'integration-reconciliation-department-breakdown',
              )}
              {renderSampleRows(
                'pending_mapping サンプル',
                details.accounting.pendingMappingSamples,
                'integration-reconciliation-pending-mapping-sample',
              )}
              {renderSampleRows(
                'blocked サンプル',
                details.accounting.blockedSamples,
                'integration-reconciliation-blocked-sample',
              )}
              {renderSampleRows(
                'invalid ready サンプル',
                details.accounting.invalidReadySamples,
                'integration-reconciliation-invalid-ready-sample',
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
