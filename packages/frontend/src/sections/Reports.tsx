import React, { useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';

type ProjectEffort = {
  projectId: string;
  planHours?: number | null;
  planMinutes?: number | null;
  totalMinutes: number;
  varianceMinutes?: number | null;
  totalExpenses: number;
};
type ProjectProfit = {
  projectId: string;
  currency?: string | null;
  revenue: number;
  budgetRevenue: number;
  varianceRevenue: number;
  directCost: number;
  costBreakdown: {
    vendorCost: number;
    expenseCost: number;
    laborCost: number;
  };
  grossProfit: number;
  grossMargin: number;
  totalMinutes: number;
};
type GroupEffort = { userId: string; totalMinutes: number };
type Overtime = { userId: string; totalMinutes: number; dailyHours: number };

type ProjectBaseline = {
  id: string;
  name: string;
  createdAt?: string | null;
};

type BurndownItem = {
  date: string;
  burnedMinutes: number;
  cumulativeBurnedMinutes: number;
  remainingMinutes: number;
};

type BurndownReport = {
  projectId: string;
  baselineId: string;
  planMinutes: number;
  from: string;
  to: string;
  items: BurndownItem[];
};

type EvmItem = {
  date: string;
  pv: number;
  ev: number;
  ac: number;
  spi: number | null;
  cpi: number | null;
};

type EvmReport = {
  projectId: string;
  currency?: string | null;
  planMinutes: number;
  budgetCost: number;
  from: string;
  to: string;
  items: EvmItem[];
};

type ManagementAccountingSummary = {
  from: string;
  to: string;
  projectCount: number;
  currency?: string | null;
  mixedCurrency: boolean;
  currencyBreakdown: Array<{
    currency?: string | null;
    projectCount: number;
    revenue: number;
    directCost: number;
    laborCost: number;
    vendorCost: number;
    expenseCost: number;
    grossProfit: number;
    grossMargin: number;
    totalMinutes: number;
    deliveryDueCount: number;
    deliveryDueAmount: number;
    redProjectCount: number;
    topRedProjects: Array<{
      projectId: string;
      projectCode?: string | null;
      projectName?: string | null;
      currency?: string | null;
      revenue: number;
      directCost: number;
      laborCost: number;
      vendorCost: number;
      expenseCost: number;
      grossProfit: number;
      grossMargin: number;
      totalMinutes: number;
    }>;
  }>;
  revenue: number | null;
  directCost: number | null;
  laborCost: number | null;
  vendorCost: number | null;
  expenseCost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  totalMinutes: number;
  overtimeTotalMinutes: number;
  deliveryDueCount: number;
  deliveryDueAmount: number | null;
  redProjectCount: number;
  topRedProjects: Array<{
    projectId: string;
    projectCode?: string | null;
    projectName?: string | null;
    currency?: string | null;
    revenue: number;
    directCost: number;
    laborCost: number;
    vendorCost: number;
    expenseCost: number;
    grossProfit: number;
    grossMargin: number;
    totalMinutes: number;
  }>;
};

function buildQuery(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const Reports: React.FC = () => {
  const auth = getAuthState();
  const defaultProjectId = auth?.projectIds?.[0] || 'demo-project';
  const defaultUserId = auth?.userId || 'demo-user';
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [baselines, setBaselines] = useState<ProjectBaseline[]>([]);
  const [baselineId, setBaselineId] = useState('');
  const [groupUserIds, setGroupUserIds] = useState(defaultUserId);
  const [overtimeUserId, setOvertimeUserId] = useState(defaultUserId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectReport, setProjectReport] = useState<ProjectEffort | null>(
    null,
  );
  const [projectProfitReport, setProjectProfitReport] =
    useState<ProjectProfit | null>(null);
  const [groupReport, setGroupReport] = useState<GroupEffort[]>([]);
  const [overtimeReport, setOvertimeReport] = useState<Overtime | null>(null);
  const [burndownReport, setBurndownReport] = useState<BurndownReport | null>(
    null,
  );
  const [evmReport, setEvmReport] = useState<EvmReport | null>(null);
  const [managementReport, setManagementReport] =
    useState<ManagementAccountingSummary | null>(null);
  const [message, setMessage] = useState('');

  const { projects, projectMessage } = useProjects({
    selectedProjectId: projectId,
    onSelect: setProjectId,
  });
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  useEffect(() => {
    if (!projectId) {
      setBaselines([]);
      setBaselineId('');
      return;
    }
    const run = async () => {
      try {
        const res = await api<{ items: ProjectBaseline[] }>(
          `/projects/${projectId}/baselines`,
        );
        const items = Array.isArray(res.items) ? res.items : [];
        setBaselines(items);
        setBaselineId((prev) => {
          if (items.some((baseline) => baseline.id === prev)) return prev;
          return items[0]?.id || '';
        });
      } catch (err) {
        setBaselines([]);
        setBaselineId('');
      }
    };
    void run();
  }, [projectId]);

  const loadBurndown = async () => {
    if (!projectId) {
      setMessage('案件を選択してください');
      return;
    }
    if (!baselineId) {
      setMessage('ベースラインを選択してください');
      return;
    }
    if (!from || !to) {
      setMessage('from/to を入力してください');
      return;
    }
    const params = new URLSearchParams();
    params.set('baselineId', baselineId);
    params.set('from', from);
    params.set('to', to);
    try {
      const res = await api<BurndownReport>(
        `/reports/burndown/${projectId}?${params.toString()}`,
      );
      setBurndownReport(res);
      setMessage('バーンダウンを取得しました');
    } catch (err) {
      setBurndownReport(null);
      setMessage('取得に失敗しました');
    }
  };

  const loadEvm = async () => {
    if (!projectId) {
      setMessage('案件を選択してください');
      return;
    }
    if (!from || !to) {
      setMessage('from/to を入力してください');
      return;
    }
    try {
      const res = await api<EvmReport>(
        `/reports/project-evm/${projectId}${buildQuery(from, to)}`,
      );
      setEvmReport(res);
      setMessage('EVMを取得しました');
    } catch (err) {
      setEvmReport(null);
      setMessage('取得に失敗しました');
    }
  };

  const loadProject = async () => {
    if (!projectId) {
      setMessage('案件を選択してください');
      return;
    }
    try {
      const res = await api<ProjectEffort>(
        `/reports/project-effort/${projectId}${buildQuery(from, to)}`,
      );
      setProjectReport(res);
      setMessage('プロジェクト別工数を取得しました');
    } catch (err) {
      setMessage('取得に失敗しました');
    }
  };

  const projectProfitCurrency = projectProfitReport?.currency || 'N/A';

  const loadGroup = async () => {
    try {
      const qs = buildQuery(from, to);
      const joined = groupUserIds
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .join(',');
      const res = await api<{ items: GroupEffort[] }>(
        `/reports/group-effort?userIds=${encodeURIComponent(joined)}${qs ? `&${qs.slice(1)}` : ''}`,
      );
      setGroupReport(res.items);
      setMessage('グループ別工数を取得しました');
    } catch (err) {
      setMessage('取得に失敗しました');
    }
  };

  const loadProjectProfit = async () => {
    if (!projectId) {
      setMessage('案件を選択してください');
      return;
    }
    try {
      const res = await api<ProjectProfit>(
        `/reports/project-profit/${projectId}${buildQuery(from, to)}`,
      );
      setProjectProfitReport(res);
      setMessage('PJ別採算を取得しました');
    } catch (err) {
      setProjectProfitReport(null);
      setMessage('取得に失敗しました');
    }
  };

  const loadOvertime = async () => {
    try {
      const res = await api<Overtime>(
        `/reports/overtime/${overtimeUserId}${buildQuery(from, to)}`,
      );
      setOvertimeReport(res);
      setMessage('個人別残業を取得しました');
    } catch (err) {
      setMessage('取得に失敗しました');
    }
  };

  const loadManagementAccounting = async () => {
    if (!from || !to) {
      setMessage('from/to を入力してください');
      return;
    }
    try {
      const res = await api<ManagementAccountingSummary>(
        `/reports/management-accounting/summary${buildQuery(from, to)}`,
      );
      setManagementReport(res);
      setMessage('管理会計サマリを取得しました');
    } catch (err) {
      setManagementReport(null);
      setMessage('取得に失敗しました');
    }
  };

  const renderProject = (id: string) => {
    const project = projectMap.get(id);
    return project ? `${project.code} / ${project.name}` : id;
  };

  return (
    <div>
      <h2>Reports</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="from (YYYY-MM-DD)"
        />
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="to (YYYY-MM-DD)"
        />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select
          aria-label="案件選択"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">案件を選択</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </select>
        <button className="button" onClick={loadProject}>
          PJ別工数
        </button>
        <button className="button" onClick={loadProjectProfit}>
          PJ別採算
        </button>
        <input
          type="text"
          value={groupUserIds}
          onChange={(e) => setGroupUserIds(e.target.value)}
          placeholder="userIds (a,b,c)"
        />
        <button className="button" onClick={loadGroup}>
          グループ別工数
        </button>
        <input
          type="text"
          value={overtimeUserId}
          onChange={(e) => setOvertimeUserId(e.target.value)}
          placeholder="userId"
        />
        <button className="button" onClick={loadOvertime}>
          個人別残業
        </button>
        <button className="button" onClick={loadManagementAccounting}>
          管理会計サマリ
        </button>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select
          aria-label="ベースライン選択"
          value={baselineId}
          onChange={(e) => setBaselineId(e.target.value)}
        >
          <option value="">ベースラインを選択</option>
          {baselines.map((baseline) => (
            <option key={baseline.id} value={baseline.id}>
              {baseline.name}
            </option>
          ))}
        </select>
        <button className="button" onClick={loadBurndown}>
          バーンダウン
        </button>
        <button className="button" onClick={loadEvm}>
          EVM
        </button>
      </div>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      {message && <p>{message}</p>}
      <div className="list" style={{ display: 'grid', gap: 8 }}>
        {projectReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>プロジェクト別工数</strong>
            <div>Project: {renderProject(projectReport.projectId)}</div>
            <div>Minutes: {projectReport.totalMinutes}</div>
            {projectReport.planHours != null && (
              <div>
                {(() => {
                  const planHours = Number(projectReport.planHours);
                  const actualHours = projectReport.totalMinutes / 60;
                  const varianceHours =
                    projectReport.varianceMinutes != null
                      ? projectReport.varianceMinutes / 60
                      : actualHours - planHours;
                  const sign = varianceHours > 0 ? '+' : '';
                  const label =
                    varianceHours > 0
                      ? '超過'
                      : varianceHours < 0
                        ? '未達'
                        : '予定通り';
                  return (
                    <>
                      Plan: {planHours.toFixed(2)}h / Actual:{' '}
                      {actualHours.toFixed(2)}h / Var: {sign}
                      {varianceHours.toFixed(2)}h（{label}）
                    </>
                  );
                })()}
              </div>
            )}
            <div>
              Expenses: ¥
              {Number(projectReport.totalExpenses || 0).toLocaleString()}
            </div>
          </div>
        )}
        {projectProfitReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>PJ別採算</strong>
            <div>Project: {renderProject(projectProfitReport.projectId)}</div>
            <div>
              Revenue ({projectProfitCurrency}):{' '}
              {projectProfitReport.revenue.toLocaleString()} / Budget:{' '}
              {projectProfitReport.budgetRevenue.toLocaleString()} / Variance:{' '}
              {projectProfitReport.varianceRevenue.toLocaleString()}
            </div>
            <div>
              Direct Cost ({projectProfitCurrency}):{' '}
              {projectProfitReport.directCost.toLocaleString()} / Gross Profit:{' '}
              {projectProfitReport.grossProfit.toLocaleString()}
            </div>
            <div>
              Vendor:{' '}
              {projectProfitReport.costBreakdown.vendorCost.toLocaleString()}
              {' / '}
              Expense:{' '}
              {projectProfitReport.costBreakdown.expenseCost.toLocaleString()}
              {' / '}
              Labor:{' '}
              {projectProfitReport.costBreakdown.laborCost.toLocaleString()}
            </div>
            <div>
              Margin: {(projectProfitReport.grossMargin * 100).toFixed(2)}% /
              Minutes: {projectProfitReport.totalMinutes}
            </div>
          </div>
        )}
        {burndownReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>バーンダウン</strong>
            <div>Project: {renderProject(burndownReport.projectId)}</div>
            <div>Plan: {burndownReport.planMinutes} min</div>
            <div>
              Period: {burndownReport.from}〜{burndownReport.to}
            </div>
            <div style={{ marginTop: 8 }}>
              {burndownReport.items.map((item) => (
                <div key={item.date}>
                  {item.date}: burned {item.burnedMinutes} / remaining{' '}
                  {item.remainingMinutes}
                </div>
              ))}
            </div>
          </div>
        )}
        {evmReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>EVM</strong>
            <div>Project: {renderProject(evmReport.projectId)}</div>
            <div>
              Budget Cost: {Math.round(evmReport.budgetCost * 100) / 100}
              {evmReport.currency ? ` ${evmReport.currency}` : ''}
            </div>
            <div>Plan: {evmReport.planMinutes} min</div>
            <div>
              Period: {evmReport.from}〜{evmReport.to}
            </div>
            <div style={{ marginTop: 8 }}>
              {evmReport.items.map((item) => (
                <div key={item.date}>
                  {item.date}: PV {Math.round(item.pv * 100) / 100} / EV{' '}
                  {Math.round(item.ev * 100) / 100} / AC{' '}
                  {Math.round(item.ac * 100) / 100} / SPI{' '}
                  {item.spi == null ? '-' : Math.round(item.spi * 1000) / 1000}{' '}
                  / CPI{' '}
                  {item.cpi == null ? '-' : Math.round(item.cpi * 1000) / 1000}
                </div>
              ))}
            </div>
          </div>
        )}
        {groupReport.length > 0 && (
          <div className="card" style={{ padding: 12 }}>
            <strong>グループ別工数</strong>
            {groupReport.map((item) => (
              <div key={item.userId}>
                {item.userId}: {item.totalMinutes} min
              </div>
            ))}
          </div>
        )}
        {overtimeReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>個人別残業</strong>
            <div>User: {overtimeReport.userId}</div>
            <div>Minutes: {overtimeReport.totalMinutes}</div>
            <div>Hours (avg/day): {overtimeReport.dailyHours.toFixed(2)}</div>
          </div>
        )}
        {managementReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>管理会計サマリ</strong>
            <div>
              Period: {managementReport.from}〜{managementReport.to}
            </div>
            <div>Projects: {managementReport.projectCount}</div>
            {managementReport.mixedCurrency ? (
              <div style={{ marginTop: 8 }}>
                <div>
                  複数通貨を含むため、金額系 KPI は通貨別に表示しています。
                </div>
                <div style={{ marginTop: 8 }}>
                  {managementReport.currencyBreakdown.map((item) => (
                    <div
                      key={item.currency || 'none'}
                      style={{
                        borderTop: '1px solid #e5e7eb',
                        marginTop: 8,
                        paddingTop: 8,
                      }}
                    >
                      <div>
                        Currency: {item.currency || '未設定'} / Projects:{' '}
                        {item.projectCount}
                      </div>
                      <div>
                        Revenue: {item.revenue.toLocaleString()} / Direct Cost:{' '}
                        {item.directCost.toLocaleString()}
                      </div>
                      <div>
                        Gross Profit: {item.grossProfit.toLocaleString()} /
                        Margin: {(item.grossMargin * 100).toFixed(2)}%
                      </div>
                      <div>
                        Labor: {item.laborCost.toLocaleString()} / Vendor:{' '}
                        {item.vendorCost.toLocaleString()} / Expense:{' '}
                        {item.expenseCost.toLocaleString()}
                      </div>
                      <div>
                        Delivery due: {item.deliveryDueCount}件 /{' '}
                        {item.deliveryDueAmount.toLocaleString()}
                      </div>
                      <div>Red projects: {item.redProjectCount}</div>
                      {item.topRedProjects.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {item.topRedProjects.map((project) => (
                            <div
                              key={`${item.currency || 'none'}:${project.projectId}`}
                            >
                              {(project.projectCode || project.projectId) +
                                (project.projectName
                                  ? ` / ${project.projectName}`
                                  : '')}
                              : {project.grossProfit.toLocaleString()} / Margin{' '}
                              {(project.grossMargin * 100).toFixed(2)}%
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div>
                  Revenue:{' '}
                  {managementReport.revenue == null
                    ? '-'
                    : managementReport.revenue.toLocaleString()}
                  {' / '}
                  Direct Cost:{' '}
                  {managementReport.directCost == null
                    ? '-'
                    : managementReport.directCost.toLocaleString()}
                  {managementReport.currency
                    ? ` ${managementReport.currency}`
                    : ''}
                </div>
                <div>
                  Gross Profit:{' '}
                  {managementReport.grossProfit == null
                    ? '-'
                    : managementReport.grossProfit.toLocaleString()}
                  {' / '}
                  Margin:{' '}
                  {managementReport.grossMargin == null
                    ? '-'
                    : `${(managementReport.grossMargin * 100).toFixed(2)}%`}
                </div>
                <div>
                  Labor:{' '}
                  {managementReport.laborCost == null
                    ? '-'
                    : managementReport.laborCost.toLocaleString()}
                  {' / '}
                  Vendor:{' '}
                  {managementReport.vendorCost == null
                    ? '-'
                    : managementReport.vendorCost.toLocaleString()}
                  {' / '}
                  Expense:{' '}
                  {managementReport.expenseCost == null
                    ? '-'
                    : managementReport.expenseCost.toLocaleString()}
                </div>
              </>
            )}
            <div>
              Minutes: {managementReport.totalMinutes} / Overtime:{' '}
              {managementReport.overtimeTotalMinutes}
            </div>
            <div>
              Delivery due: {managementReport.deliveryDueCount}件 /{' '}
              {managementReport.deliveryDueAmount == null
                ? '通貨別表示を参照'
                : managementReport.deliveryDueAmount.toLocaleString()}
            </div>
            <div>Red projects: {managementReport.redProjectCount}</div>
            {managementReport.topRedProjects.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {managementReport.topRedProjects.map((item) => (
                  <div key={item.projectId}>
                    {(item.projectCode || item.projectId) +
                      (item.projectName ? ` / ${item.projectName}` : '')}
                    : ¥{item.grossProfit.toLocaleString()} / Margin{' '}
                    {(item.grossMargin * 100).toFixed(2)}%
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!projectReport &&
          !projectProfitReport &&
          groupReport.length === 0 &&
          !overtimeReport &&
          !managementReport &&
          !burndownReport &&
          !evmReport && <div className="card">レポート未取得</div>}
      </div>
    </div>
  );
};
