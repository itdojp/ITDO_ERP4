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

type InsightSettingSummary = {
  id: string;
  threshold: number | null;
  period: string;
  scopeProjectId?: string | null;
};

type InsightEvidence = {
  period: { from: string | null; to: string | null };
  calculation: string;
  targets: string[];
  settings: InsightSettingSummary[];
};

type Insight = {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  count: number;
  latestAt: string | null;
  sampleTargets: string[];
  evidence: InsightEvidence;
};

const INSIGHT_LABELS: Record<string, { title: string; hint: string }> = {
  budget_overrun: {
    title: '予算超過の兆候',
    hint: '見積/マイルストーンの予算と実績の差分を確認してください。',
  },
  overtime: {
    title: '残業超過の兆候',
    hint: '対象メンバーの稼働状況を確認してください。',
  },
  approval_delay: {
    title: '承認遅延の兆候',
    hint: '未承認の申請を確認してください。',
  },
  approval_escalation: {
    title: '承認エスカレーション',
    hint: '期限超過の承認が発生しています。',
  },
  delivery_due: {
    title: '未請求の納期超過',
    hint: '納品済みの請求タイミングを確認してください。',
  },
  integration_failure: {
    title: '外部連携の失敗',
    hint: '連携ログと再実行の状況を確認してください。',
  },
};

const formatDateTime = (value: string | null) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const formatPeriod = (period: { from: string | null; to: string | null }) => {
  const fromLabel = period.from ? formatDateTime(period.from) : '指定なし';
  const toLabel = period.to ? formatDateTime(period.to) : '指定なし';
  if (fromLabel === '指定なし' && toLabel === '指定なし') return '指定なし';
  return `${fromLabel} 〜 ${toLabel}`;
};

export const Dashboard: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId ?? '';
  const roles = auth?.roles ?? [];
  const canViewInsights = roles.some((role) =>
    ['admin', 'mgmt', 'exec'].includes(role),
  );
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [approvals, setApprovals] = useState<ApprovalInstance[]>([]);
  const [approvalMessage, setApprovalMessage] = useState('');
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightMessage, setInsightMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const hasMore = alerts.length > 5;
  const visibleAlerts = showAll ? alerts : alerts.slice(0, 5);
  const myPendingApprovals = useMemo(() => {
    const groupIds = auth?.groupIds ?? [];
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
          return groupIds.includes(step.approverGroupId);
        }
        return true;
      });
    }).length;
  }, [approvals, auth?.groupIds, userId]);

  useEffect(() => {
    api<{ items: Alert[] }>('/alerts')
      .then((data) => setAlerts(data.items))
      .catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    if (!canViewInsights) return;
    api<{ items: Insight[] }>('/insights')
      .then((data) => {
        setInsights(data.items || []);
        setInsightMessage('');
      })
      .catch(() => {
        setInsights([]);
        setInsightMessage('インサイトの取得に失敗しました');
      });
  }, [canViewInsights]);

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
      {canViewInsights && (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <p className="badge">Insights</p>
          </div>
          {insightMessage && (
            <div style={{ color: '#dc2626', marginBottom: 8 }}>
              {insightMessage}
            </div>
          )}
          <div className="list" style={{ display: 'grid', gap: 8 }}>
            {insights.map((item) => {
              const label = INSIGHT_LABELS[item.type] || {
                title: item.type,
                hint: '',
              };
              const sampleTargets =
                item.sampleTargets.length > 0
                  ? item.sampleTargets
                  : item.evidence.targets ?? [];
              return (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>{label.title}</strong>
                    </div>
                    <span className="badge">{item.severity}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    件数: {item.count} / 最新: {formatDateTime(item.latestAt)}
                  </div>
                  {sampleTargets.length > 0 && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      対象例: {sampleTargets.join(', ')}
                    </div>
                  )}
                  {item.evidence?.period && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      期間: {formatPeriod(item.evidence.period)}
                    </div>
                  )}
                  {item.evidence?.calculation && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      根拠: {item.evidence.calculation}
                    </div>
                  )}
                  {label.hint && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      {label.hint}
                    </div>
                  )}
                </div>
              );
            })}
            {insights.length === 0 && (
              <div className="card">インサイトなし</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
