import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

function resolveLeaveRequestId(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { leaveRequestId?: unknown }).leaveRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveLeaveRange(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const startDate = (payload as { startDate?: unknown }).startDate;
  const endDate = (payload as { endDate?: unknown }).endDate;
  const leaveType = (payload as { leaveType?: unknown }).leaveType;
  const start =
    typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null;
  const end =
    typeof endDate === 'string' && endDate.trim() ? endDate.trim() : null;
  const type =
    typeof leaveType === 'string' && leaveType.trim() ? leaveType.trim() : null;
  if (!start) return null;
  return { startDate: start, endDate: end, leaveType: type };
}

function resolveDueAt(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { dueAt?: unknown }).dueAt;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveEscalation(payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  return Boolean((payload as { escalation?: unknown }).escalation);
}

function resolveRoomId(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { roomId?: unknown }).roomId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveRoomName(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { roomName?: unknown }).roomName;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveProjectStatusChange(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const beforeStatus = (payload as { beforeStatus?: unknown }).beforeStatus;
  const afterStatus = (payload as { afterStatus?: unknown }).afterStatus;
  if (
    typeof beforeStatus !== 'string' ||
    typeof afterStatus !== 'string' ||
    !beforeStatus.trim() ||
    !afterStatus.trim()
  ) {
    return null;
  }
  return {
    beforeStatus: beforeStatus.trim(),
    afterStatus: afterStatus.trim(),
  };
}

function formatProjectStatusLabel(value: string | null) {
  if (!value) return '-';
  switch (value) {
    case 'draft':
      return '起案中';
    case 'active':
      return '進行中';
    case 'on_hold':
      return '保留';
    case 'closed':
      return '完了';
    default:
      return value;
  }
}

const FLOW_TYPE_LABEL_MAP: Record<string, string> = {
  estimate: '見積',
  invoice: '請求',
  purchase_order: '発注',
  vendor_quote: '仕入見積',
  vendor_invoice: '仕入請求',
  expense: '経費',
  leave: '休暇',
  time: '工数',
};

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
  return FLOW_TYPE_LABEL_MAP[flowType] ?? flowType;
}

function formatLeaveRange(range: {
  startDate: string;
  endDate: string | null;
}) {
  if (!range.endDate || range.endDate === range.startDate) {
    return range.startDate;
  }
  return `${range.startDate}〜${range.endDate}`;
}

function resolveApprovalTargetDeepLink(target: {
  targetTable: string;
  targetId: string;
}) {
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
  if (item.kind === 'chat_message') {
    const fromUserId = resolveFromUserId(item.payload);
    if (fromUserId) return `${fromUserId} から投稿`;
    return 'チャット投稿';
  }
  if (
    item.kind === 'chat_ack_required' ||
    item.kind === 'chat_ack_escalation'
  ) {
    const fromUserId = resolveFromUserId(item.payload);
    const escalation =
      item.kind === 'chat_ack_escalation' || resolveEscalation(item.payload);
    const suffix = escalation ? '確認依頼（エスカレーション）' : '確認依頼';
    if (fromUserId) return `${fromUserId} から${suffix}`;
    return suffix;
  }
  if (item.kind === 'chat_room_acl_mismatch') {
    const roomName = resolveRoomName(item.payload);
    return roomName
      ? `チャット権限の不整合 (${roomName})`
      : 'チャット権限の不整合';
  }
  if (item.kind === 'daily_report_missing') {
    const reportDate = resolveReportDate(item.payload);
    return reportDate ? `日報未提出 (${reportDate})` : '日報未提出';
  }
  if (item.kind === 'leave_upcoming') {
    const range = resolveLeaveRange(item.payload);
    const label = range ? formatLeaveRange(range) : '';
    return label ? `休暇予定 (${label})` : '休暇予定';
  }
  if (item.kind === 'daily_report_submitted') {
    const reportDate = resolveReportDate(item.payload);
    return reportDate ? `日報提出 (${reportDate})` : '日報提出';
  }
  if (item.kind === 'daily_report_updated') {
    const reportDate = resolveReportDate(item.payload);
    return reportDate ? `日報修正 (${reportDate})` : '日報修正';
  }
  if (item.kind === 'project_member_added') {
    const fromUserId = resolveFromUserId(item.payload);
    if (fromUserId) return `${fromUserId} により案件メンバーに追加されました`;
    return '案件メンバーに追加されました';
  }
  if (item.kind === 'project_created') {
    const fromUserId = resolveFromUserId(item.payload);
    if (fromUserId) return `${fromUserId} が案件を作成しました`;
    return '案件が作成されました';
  }
  if (item.kind === 'project_status_changed') {
    const fromUserId = resolveFromUserId(item.payload);
    const statusChange = resolveProjectStatusChange(item.payload);
    const statusLabel = statusChange
      ? `${formatProjectStatusLabel(
          statusChange.beforeStatus,
        )} → ${formatProjectStatusLabel(statusChange.afterStatus)}`
      : '';
    const base = fromUserId
      ? `${fromUserId} が案件ステータスを更新しました`
      : '案件ステータスが更新されました';
    return statusLabel ? `${base} (${statusLabel})` : base;
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
    if (fromUserId)
      return `${fromUserId} により${flowLabel}が差戻しとなりました`;
    return `${flowLabel}が差戻しとなりました`;
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
  const [notificationMuteUntil, setNotificationMuteUntil] = useState<
    string | null
  >(null);
  const [notificationMuteMessage, setNotificationMuteMessage] = useState('');
  const [notificationMuteError, setNotificationMuteError] = useState('');
  const [notificationMuteLoading, setNotificationMuteLoading] = useState(false);
  const [roomMuteFeedback, setRoomMuteFeedback] = useState<{
    roomId: string;
    message: string;
    error: string;
  } | null>(null);
  const [roomMuteLoadingId, setRoomMuteLoadingId] = useState<string | null>(
    null,
  );
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightMessage, setInsightMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const hasMore = alerts.length > 5;
  const visibleAlerts = showAll ? alerts : alerts.slice(0, 5);
  const myPendingApprovals = useMemo(() => {
    const groupIds = auth?.groupIds ?? [];
    const groupAccountIds = auth?.groupAccountIds ?? [];
    const actorGroupIds = new Set([...groupIds, ...groupAccountIds]);
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
          return actorGroupIds.has(step.approverGroupId);
        }
        return true;
      });
    }).length;
  }, [approvals, auth?.groupIds, auth?.groupAccountIds, userId]);

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

  const loadNotificationMute = useCallback(async () => {
    setNotificationMuteError('');
    try {
      const res = await api<{ muteAllUntil?: string | null }>(
        '/notification-preferences',
      );
      setNotificationMuteUntil(
        typeof res.muteAllUntil === 'string' ? res.muteAllUntil : null,
      );
    } catch (err) {
      console.error('通知設定の取得に失敗しました', err);
      setNotificationMuteError('通知設定の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    loadNotificationMute().catch(() => undefined);
  }, [loadNotificationMute]);

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

  const updateNotificationMuteUntil = useCallback(
    async (minutes: number | null) => {
      setNotificationMuteLoading(true);
      setNotificationMuteMessage('');
      setNotificationMuteError('');
      const muteAllUntil =
        minutes === null
          ? null
          : new Date(Date.now() + minutes * 60 * 1000).toISOString();
      try {
        const res = await api<{ muteAllUntil?: string | null }>(
          '/notification-preferences',
          {
            method: 'PATCH',
            body: JSON.stringify({ muteAllUntil }),
          },
        );
        setNotificationMuteUntil(
          typeof res.muteAllUntil === 'string' ? res.muteAllUntil : null,
        );
        setNotificationMuteMessage(
          minutes === null
            ? '通知ミュートを解除しました'
            : '通知ミュートを更新しました',
        );
      } catch (err) {
        console.error('通知ミュートの更新に失敗しました', err);
        setNotificationMuteError('通知ミュートの更新に失敗しました');
      } finally {
        setNotificationMuteLoading(false);
      }
    },
    [],
  );

  const updateRoomMuteUntil = useCallback(
    async (roomId: string, minutes: number | null) => {
      setRoomMuteLoadingId(roomId);
      setRoomMuteFeedback(null);
      const muteUntil =
        minutes === null
          ? null
          : new Date(Date.now() + minutes * 60 * 1000).toISOString();
      try {
        await api(`/chat-rooms/${roomId}/notification-setting`, {
          method: 'PATCH',
          body: JSON.stringify({ muteUntil }),
        });
        setRoomMuteFeedback({
          roomId,
          message:
            minutes === null
              ? 'ルーム通知ミュートを解除しました'
              : 'ルーム通知をミュートしました',
          error: '',
        });
      } catch (err) {
        console.error('ルーム通知ミュートの更新に失敗しました', err);
        setRoomMuteFeedback({
          roomId,
          message: '',
          error: 'ルーム通知ミュートの更新に失敗しました',
        });
      } finally {
        setRoomMuteLoadingId(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!roomMuteFeedback?.message && !roomMuteFeedback?.error) return;
    const timeoutId = window.setTimeout(() => {
      setRoomMuteFeedback(null);
    }, 4000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [roomMuteFeedback]);

  const openNotificationTarget = (item: AppNotification) => {
    if (
      item.kind === 'chat_mention' ||
      item.kind === 'chat_message' ||
      item.kind === 'chat_ack_required' ||
      item.kind === 'chat_ack_escalation'
    ) {
      if (!item.messageId) return;
      navigateToOpen({ kind: 'chat_message', id: item.messageId });
      return;
    }
    if (item.kind === 'chat_room_acl_mismatch') {
      const roomId = resolveRoomId(item.payload);
      if (!roomId) return;
      navigateToOpen({ kind: 'room_chat', id: roomId });
      return;
    }
    if (
      item.kind === 'daily_report_missing' ||
      item.kind === 'daily_report_submitted' ||
      item.kind === 'daily_report_updated'
    ) {
      const reportDate = resolveReportDate(item.payload);
      if (!reportDate) return;
      navigateToOpen({ kind: 'daily_report', id: reportDate });
      return;
    }
    if (item.kind === 'leave_upcoming') {
      const leaveRequestId =
        resolveLeaveRequestId(item.payload) || item.messageId;
      if (!leaveRequestId) return;
      navigateToOpen({ kind: 'leave_request', id: leaveRequestId });
      return;
    }
    if (item.kind === 'approval_pending') {
      navigateToOpen({ kind: 'approvals', id: 'inbox' });
      return;
    }
    if (
      item.kind === 'approval_approved' ||
      item.kind === 'approval_rejected'
    ) {
      const target = resolveApprovalTarget(item.payload);
      const deepLink = target ? resolveApprovalTargetDeepLink(target) : null;
      if (deepLink) {
        navigateToOpen(deepLink);
        return;
      }
      navigateToOpen({ kind: 'approvals', id: 'inbox' });
    }
    if (
      item.kind === 'project_created' ||
      item.kind === 'project_status_changed'
    ) {
      if (!item.projectId) return;
      navigateToOpen({ kind: 'project', id: item.projectId });
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
        <div
          className="row"
          style={{
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 8,
            alignItems: 'center',
          }}
        >
          <span className="badge">ミュート</span>
          <span style={{ fontSize: 12, color: '#475569' }}>
            全体:{' '}
            {notificationMuteUntil
              ? formatDateTime(notificationMuteUntil)
              : '未設定'}
          </span>
          <Button
            variant="secondary"
            onClick={() => updateNotificationMuteUntil(10)}
            disabled={notificationMuteLoading}
          >
            10分
          </Button>
          <Button
            variant="secondary"
            onClick={() => updateNotificationMuteUntil(60)}
            disabled={notificationMuteLoading}
          >
            1時間
          </Button>
          <Button
            variant="secondary"
            onClick={() => updateNotificationMuteUntil(1440)}
            disabled={notificationMuteLoading}
          >
            1日
          </Button>
          <Button
            variant="secondary"
            onClick={() => updateNotificationMuteUntil(null)}
            disabled={notificationMuteLoading}
          >
            解除
          </Button>
        </div>
        {notificationMuteMessage && (
          <div style={{ marginTop: 6, color: '#16a34a' }}>
            {notificationMuteMessage}
          </div>
        )}
        {notificationMuteError && (
          <div style={{ marginTop: 6 }}>
            <Alert variant="error">{notificationMuteError}</Alert>
          </div>
        )}
        <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {notifications.map((item) => {
            const projectLabel = item.project
              ? `${item.project.code} / ${item.project.name}`
              : item.projectId || 'N/A';
            const excerpt = resolveExcerpt(item.payload);
            const dueAt = resolveDueAt(item.payload);
            const escalation =
              item.kind === 'chat_ack_escalation' ||
              resolveEscalation(item.payload);
            const roomId = resolveRoomId(item.payload);
            const leaveRange = resolveLeaveRange(item.payload);
            const canOpen =
              ((item.kind === 'chat_mention' ||
                item.kind === 'chat_message' ||
                item.kind === 'chat_ack_required' ||
                item.kind === 'chat_ack_escalation') &&
                Boolean(item.messageId)) ||
              ((item.kind === 'daily_report_missing' ||
                item.kind === 'daily_report_submitted' ||
                item.kind === 'daily_report_updated') &&
                Boolean(resolveReportDate(item.payload))) ||
              (item.kind === 'leave_upcoming' &&
                Boolean(
                  resolveLeaveRequestId(item.payload) || item.messageId,
                )) ||
              ((item.kind === 'project_created' ||
                item.kind === 'project_status_changed') &&
                Boolean(item.projectId)) ||
              item.kind === 'approval_pending' ||
              item.kind === 'approval_approved' ||
              item.kind === 'approval_rejected';
            const statusChange = resolveProjectStatusChange(item.payload);
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
                    {(item.kind === 'chat_ack_required' ||
                      item.kind === 'chat_ack_escalation') && (
                      <div
                        style={{
                          fontSize: 12,
                          color: '#475569',
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        {dueAt && <span>期限: {formatDateTime(dueAt)}</span>}
                        {escalation && (
                          <span className="badge">エスカレーション</span>
                        )}
                      </div>
                    )}
                    {item.kind === 'project_status_changed' && statusChange && (
                      <div style={{ fontSize: 12, color: '#475569' }}>
                        ステータス:{' '}
                        {formatProjectStatusLabel(statusChange.beforeStatus)} →
                        {formatProjectStatusLabel(statusChange.afterStatus)}
                      </div>
                    )}
                    {item.kind === 'leave_upcoming' && leaveRange && (
                      <div style={{ fontSize: 12, color: '#475569' }}>
                        期間: {formatLeaveRange(leaveRange)}
                        {leaveRange.leaveType
                          ? ` / 種別: ${leaveRange.leaveType}`
                          : ''}
                      </div>
                    )}
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
                {roomId &&
                  (item.kind === 'chat_mention' ||
                    item.kind === 'chat_message' ||
                    item.kind === 'chat_ack_required' ||
                    item.kind === 'chat_ack_escalation') && (
                    <div
                      className="row"
                      style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}
                    >
                      <span className="badge">ルームミュート</span>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => updateRoomMuteUntil(roomId, 10)}
                        disabled={roomMuteLoadingId === roomId}
                      >
                        10分
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => updateRoomMuteUntil(roomId, 60)}
                        disabled={roomMuteLoadingId === roomId}
                      >
                        1時間
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => updateRoomMuteUntil(roomId, 1440)}
                        disabled={roomMuteLoadingId === roomId}
                      >
                        1日
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => updateRoomMuteUntil(roomId, null)}
                        disabled={roomMuteLoadingId === roomId}
                      >
                        解除
                      </Button>
                    </div>
                  )}
                {roomId &&
                  roomMuteFeedback?.roomId === roomId &&
                  (roomMuteFeedback.message || roomMuteFeedback.error) && (
                    <div style={{ marginTop: 6 }}>
                      {roomMuteFeedback.message && (
                        <div style={{ color: '#16a34a' }}>
                          {roomMuteFeedback.message}
                        </div>
                      )}
                      {roomMuteFeedback.error && (
                        <Alert variant="error">{roomMuteFeedback.error}</Alert>
                      )}
                    </div>
                  )}
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
