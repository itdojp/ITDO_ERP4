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
  const [groupReport, setGroupReport] = useState<GroupEffort[]>([]);
  const [overtimeReport, setOvertimeReport] = useState<Overtime | null>(null);
  const [burndownReport, setBurndownReport] = useState<BurndownReport | null>(
    null,
  );
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
      setMessage('取得に失敗しました');
    }
  };

  const loadProject = async () => {
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
        {!projectReport &&
          groupReport.length === 0 &&
          !overtimeReport &&
          !burndownReport && <div className="card">レポート未取得</div>}
      </div>
    </div>
  );
};
