import React, { useState } from 'react';
import { api, getAuthState } from '../api';

type ProjectEffort = {
  projectId: string;
  totalMinutes: number;
  totalExpenses: number;
};
type GroupEffort = { userId: string; totalMinutes: number };
type Overtime = { userId: string; totalMinutes: number; dailyHours: number };

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
  const [groupUserIds, setGroupUserIds] = useState(defaultUserId);
  const [overtimeUserId, setOvertimeUserId] = useState(defaultUserId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectReport, setProjectReport] = useState<ProjectEffort | null>(
    null,
  );
  const [groupReport, setGroupReport] = useState<GroupEffort[]>([]);
  const [overtimeReport, setOvertimeReport] = useState<Overtime | null>(null);
  const [message, setMessage] = useState('');

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
        <input
          type="text"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="projectId"
        />
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
      {message && <p>{message}</p>}
      <div className="list" style={{ display: 'grid', gap: 8 }}>
        {projectReport && (
          <div className="card" style={{ padding: 12 }}>
            <strong>プロジェクト別工数</strong>
            <div>Project: {projectReport.projectId}</div>
            <div>Minutes: {projectReport.totalMinutes}</div>
            <div>
              Expenses: ¥
              {Number(projectReport.totalExpenses || 0).toLocaleString()}
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
        {!projectReport && groupReport.length === 0 && !overtimeReport && (
          <div className="card">レポート未取得</div>
        )}
      </div>
    </div>
  );
};
