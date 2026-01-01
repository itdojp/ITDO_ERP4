import React, { useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type Alert = {
  id: string;
  type: string;
  targetRef?: string;
  status: string;
  triggeredAt?: string;
  sentChannels?: string[];
};

type ApprovalStep = {
  id: string;
  stepOrder: number;
  approverGroupId?: string | null;
  approverUserId?: string | null;
  status: string;
};

type ApprovalInstance = {
  id: string;
  status: string;
  currentStep?: number | null;
  steps: ApprovalStep[];
};

export const Dashboard: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId ?? '';
  const userGroupIds = auth?.groupIds ?? [];
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [approvals, setApprovals] = useState<ApprovalInstance[]>([]);
  const [approvalMessage, setApprovalMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const hasMore = alerts.length > 5;
  const visibleAlerts = showAll ? alerts : alerts.slice(0, 5);
  const myPendingApprovals = useMemo(() => {
    if (!approvals.length) return 0;
    return approvals.filter((item) => {
      if (!item.currentStep) return false;
      const currentSteps = item.steps.filter(
        (step) =>
          step.stepOrder === item.currentStep && step.status === 'pending_qa',
      );
      if (!currentSteps.length) return false;
      return currentSteps.some((step) => {
        if (step.approverUserId) return step.approverUserId === userId;
        if (step.approverGroupId) {
          return userGroupIds.includes(step.approverGroupId);
        }
        return true;
      });
    }).length;
  }, [approvals, userGroupIds, userId]);

  useEffect(() => {
    api<{ items: Alert[] }>('/alerts')
      .then((data) => setAlerts(data.items))
      .catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    const loadApprovals = async () => {
      try {
        const [pendingQa, pendingExec] = await Promise.all([
          api<{ items: ApprovalInstance[] }>(
            '/approval-instances?status=pending_qa',
          ),
          api<{ items: ApprovalInstance[] }>(
            '/approval-instances?status=pending_exec',
          ),
        ]);
        const all = [...(pendingQa.items || []), ...(pendingExec.items || [])];
        const unique = Array.from(
          new Map(all.map((item) => [item.id, item])).values(),
        );
        setApprovals(unique);
        setApprovalMessage('');
      } catch (err) {
        console.error('Failed to load approvals.', err);
        setApprovals([]);
        setApprovalMessage('承認状況の取得に失敗しました');
      }
    };
    loadApprovals();
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>承認状況</strong>
          <span className="badge">Pending</span>
        </div>
        <div style={{ marginTop: 8 }}>
          承認待ち: {approvals.length}件 / 自分の承認待ち: {myPendingApprovals}
          件
        </div>
        {approvalMessage && (
          <div style={{ color: '#dc2626', marginTop: 6 }}>
            {approvalMessage}
          </div>
        )}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <p className="badge">
          Alerts{' '}
          {showAll
            ? `(全${alerts.length}件)`
            : `(最新${Math.min(alerts.length, 5)}件)`}
        </p>
        {hasMore && (
          <button
            className="button secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? '最新のみ' : 'すべて表示'}
          </button>
        )}
      </div>
      <div className="list" style={{ display: 'grid', gap: 8 }}>
        {visibleAlerts.map((a) => (
          <div key={a.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{a.type}</strong> / {a.targetRef || 'N/A'}
              </div>
              <span className="badge">{a.status}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              送信: {(a.sentChannels || []).join(', ') || '未送信'} /{' '}
              {a.triggeredAt?.slice(0, 16) || ''}
            </div>
          </div>
        ))}
        {alerts.length === 0 && <div className="card">アラートなし</div>}
      </div>
    </div>
  );
};
