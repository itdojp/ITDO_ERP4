import React, { useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { Alert, Button, Card, EmptyState } from '../ui';
import { navigateToOpen } from '../utils/deepLink';

type AlertItem = {
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

type AppNotification = {
  id: string;
  userId: string;
  kind: string;
  projectId?: string | null;
  messageId?: string | null;
  payload?: unknown;
  readAt?: string | null;
  createdAt: string;
  project?: {
    id: string;
    code: string;
    name: string;
    deletedAt?: string | null;
  } | null;
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

function resolveFromUserId(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { fromUserId?: unknown }).fromUserId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveExcerpt(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { excerpt?: unknown }).excerpt;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveReportDate(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { reportDate?: unknown }).reportDate;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveFlowType(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { flowType?: unknown }).flowType;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveApprovalTarget(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as { targetTable?: unknown; targetId?: unknown };
  const targetTable =
    typeof obj.targetTable === 'string' && obj.targetTable.trim()
      ? obj.targetTable.trim()
      : null;
  const targetId =
    typeof obj.targetId === 'string' && obj.targetId.trim()
      ? obj.targetId.trim()
      : null;
  if (!targetTable || !targetId) return null;
  return { targetTable, targetId };
}

function formatFlowTypeLabel(flowType: string) {
  switch (flowType) {
    case 'estimate':
      return '見積';
    case 'invoice':
      return '請求';
    case 'purchase_order':
      return '発注';
    case 'vendor_quote':
      return '仕入見積';
    case 'vendor_invoice':
      return '仕入請求';
    case 'expense':
      return '経費';
    case 'leave':
      return '休暇';
    case 'time':
      return '工数';
    default:
      return flowType;
  }
}

function resolveApprovalTargetDeepLink(target: { targetTable: string; targetId: string }) {
  switch (target.targetTable) {
    case 'estimates':
      return { kind: 'estimate', id: target.targetId };
    case 'invoices':
      return { kind: 'invoice', id: target.targetId };
    case 'expenses':
      return { kind: 'expense', id: target.targetId };
    case 'purchase_orders':
      return { kind: 'purchase_order', id: target.targetId };
    case 'vendor_invoices':
      return { kind: 'vendor_invoice', id: target.targetId };
    case 'vendor_quotes':
      return { kind: 'vendor_quote', id: target.targetId };
    case 'leave_requests':
      return { kind: 'leave_request', id: target.targetId };
    case 'time_entries':
      return { kind: 'time_entry', id: target.targetId };
    default:
      return null;
  }
}

function formatNotificationLabel(item: AppNotification) {
  if (item.kind === 'chat_mention') {
    const fromUserId = resolveFromUserId(item.payload);
    if (fromUserId) return `${fromUserId} からメンション`;
    return 'チャットでメンション';
  }
  if (item.kind === 'chat_ack_required') {
    const fromUserId = resolveFromUserId(item.payload);
    if (fromUserId) return `${fromUserId} から確認依頼`;
    return '確認依頼';
  }
  if (item.kind === 'daily_report_missing') {
    const reportDate = resolveReportDate(item.payload);
    return reportDate ? `日報未提出 (${reportDate})` : '日報未提出';
  }
  if (item.kind === 'project_member_added') {
    const fromUserId = resolveFromUserId(item.payload);
    if (fromUserId) return `${fromUserId} により案件メンバーに追加されました`;
    return '案件メンバーに追加されました';
  }
  if (item.kind === 'approval_pending') {
    const fromUserId = resolveFromUserId(item.payload);
    const flowType = resolveFlowType(item.payload);
    const flowLabel = flowType ? formatFlowTypeLabel(flowType) : '申請';
    if (fromUserId) return `${fromUserId} から${flowLabel}の承認依頼`;
    return `${flowLabel}の承認依頼`;
  }
  if (item.kind === 'approval_approved') {
    const fromUserId = resolveFromUserId(item.payload);
    const flowType = resolveFlowType(item.payload);
    const flowLabel = flowType ? formatFlowTypeLabel(flowType) : '申請';
    if (fromUserId) return `${fromUserId} により${flowLabel}が承認されました`;
    return `${flowLabel}が承認されました`;
  }
  if (item.kind === 'approval_rejected') {
    const fromUserId = resolveFromUserId(item.payload);
    const flowType = resolveFlowType(item.payload);
    const flowLabel = flowType ? formatFlowTypeLabel(flowType) : '申請';
    if (fromUserId) return `${fromUserId} により${flowLabel}が差戻しされました`;
    return `${flowLabel}が差戻しされました`;
  }
  return item.kind;
}

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
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalInstance[]>([]);
  const [approvalMessage, setApprovalMessage] = useState('');
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationMessage, setNotificationMessage] = useState('');
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
    api<{ items: AlertItem[] }>('/alerts')
      .then((data) => setAlerts(data.items))
      .catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadNotifications = async () => {
      try {
        const [countRes, listRes] = await Promise.all([
          api<{ unreadCount?: number }>('/notifications/unread-count'),
          api<{ items?: AppNotification[] }>('/notifications?unread=1&limit=5'),
        ]);
        if (cancelled) return;
        setNotificationCount(
          typeof countRes.unreadCount === 'number' ? countRes.unreadCount : 0,
        );
        setNotifications(Array.isArray(listRes.items) ? listRes.items : []);
        setNotificationMessage('');
      } catch (err) {
        if (cancelled) return;
        setNotificationCount(0);
        setNotifications([]);
        setNotificationMessage('通知の取得に失敗しました');
      }
    };
    loadNotifications().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const markNotificationRead = async (id: string) => {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) => prev.filter((item) => item.id !== id));
      setNotificationCount((prev) => Math.max(prev - 1, 0));
    } catch (err) {
      console.error('通知の既読化に失敗しました', err);
      setNotificationMessage('通知の既読化に失敗しました');
    }
  };

  const openNotificationTarget = (item: AppNotification) => {
    if (item.kind === 'chat_mention' || item.kind === 'chat_ack_required') {
      if (!item.messageId) return;
      navigateToOpen({ kind: 'chat_message', id: item.messageId });
      return;
    }
    if (item.kind === 'daily_report_missing') {
      const reportDate = resolveReportDate(item.payload);
      if (!reportDate) return;
      navigateToOpen({ kind: 'daily_report', id: reportDate });
    }
    if (item.kind === 'approval_pending') {
      navigateToOpen({ kind: 'approvals', id: 'inbox' });
      return;
    }
    if (item.kind === 'approval_approved' || item.kind === 'approval_rejected') {
      const target = resolveApprovalTarget(item.payload);
      const deepLink = target ? resolveApprovalTargetDeepLink(target) : null;
      if (deepLink) {
        navigateToOpen(deepLink);
        return;
      }
      navigateToOpen({ kind: 'approvals', id: 'inbox' });
    }
  };

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
      <Card padding="small" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>承認状況</strong>
          <span className="badge">Pending</span>
        </div>
        <div style={{ marginTop: 8 }}>
          承認待ち: {approvals.length}件 / 自分の承認待ち: {myPendingApprovals}
          件
        </div>
        {approvalMessage && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{approvalMessage}</Alert>
          </div>
        )}
      </Card>
      <Card padding="small" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>通知</strong>
          <span className="badge">Unread {notificationCount}</span>
        </div>
        {notificationMessage && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{notificationMessage}</Alert>
          </div>
        )}
        <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {notifications.map((item) => {
            const projectLabel = item.project
              ? `${item.project.code} / ${item.project.name}`
              : item.projectId || 'N/A';
            const excerpt = resolveExcerpt(item.payload);
            const canOpen =
              ((item.kind === 'chat_mention' ||
                item.kind === 'chat_ack_required') &&
                Boolean(item.messageId)) ||
              (item.kind === 'daily_report_missing' &&
                Boolean(resolveReportDate(item.payload))) ||
              item.kind === 'approval_pending' ||
              item.kind === 'approval_approved' ||
              item.kind === 'approval_rejected';
            return (
              <Card key={item.id} padding="small">
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{formatNotificationLabel(item)}</strong>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      {projectLabel} / {formatDateTime(item.createdAt)}
                    </div>
                    {excerpt && (
                      <div style={{ fontSize: 12, color: '#475569' }}>
                        {excerpt}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {canOpen && (
                      <Button
                        variant="secondary"
                        onClick={() => openNotificationTarget(item)}
                      >
                        開く
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => markNotificationRead(item.id)}
                    >
                      既読
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {notifications.length === 0 && <EmptyState title="通知なし" />}
        </div>
      </Card>
      <div className="row" style={{ alignItems: 'center' }}>
        <p className="badge">
          Alerts{' '}
          {showAll
            ? `(全${alerts.length}件)`
            : `(最新${Math.min(alerts.length, 5)}件)`}
        </p>
        {hasMore && (
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '最新のみ' : 'すべて表示'}
            </Button>
          </div>
        )}
      </div>
      <div className="list" style={{ display: 'grid', gap: 8 }}>
        {visibleAlerts.map((a) => (
          <Card key={a.id} padding="small">
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
          </Card>
        ))}
        {alerts.length === 0 && <EmptyState title="アラートなし" />}
      </div>
      {canViewInsights && (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <p className="badge">Insights</p>
          </div>
          {insightMessage && (
            <div style={{ marginBottom: 8 }}>
              <Alert variant="error">{insightMessage}</Alert>
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
                  : (item.evidence.targets ?? []);
              return (
                <Card key={item.id} padding="small">
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
                </Card>
              );
            })}
            {insights.length === 0 && <EmptyState title="インサイトなし" />}
          </div>
        </div>
      )}
    </div>
  );
};
