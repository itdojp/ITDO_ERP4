import React, { useCallback, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  CrudList,
  DataTable,
  Dialog,
  FilterBar,
  Input,
  SavedViewBar,
  Select,
  StatusBadge,
  createLocalStorageSavedViewsAdapter,
  erpStatusDictionary,
  useSavedViews,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';

type JobResult = Record<string, unknown> | null;

type JobState = {
  result: JobResult;
  error: string;
  loading: boolean;
};

type JobKey =
  | 'alerts'
  | 'approvalEscalations'
  | 'dataQuality'
  | 'reportSubscriptions'
  | 'reportDeliveries'
  | 'notificationDeliveries'
  | 'chatAckReminders'
  | 'leaveUpcoming'
  | 'chatRoomAclAlerts'
  | 'dailyReportMissing'
  | 'recurringProjects'
  | 'integrations';

type JobGroup = '運用' | 'レポート' | '通知' | '定期/連携';

type JobDescriptor = {
  key: JobKey;
  group: JobGroup;
  label: string;
};

type SavedFilterPayload = {
  search: string;
  groupFilter: 'all' | JobGroup;
};

const JOB_DEFINITIONS: JobDescriptor[] = [
  { key: 'alerts', group: '運用', label: 'アラート計算' },
  { key: 'approvalEscalations', group: '運用', label: '承認エスカレーション' },
  { key: 'dataQuality', group: '運用', label: 'データ品質チェック' },
  { key: 'dailyReportMissing', group: '運用', label: '日報未提出通知' },
  { key: 'reportSubscriptions', group: 'レポート', label: '予約レポート実行' },
  { key: 'reportDeliveries', group: 'レポート', label: '配信リトライ' },
  { key: 'notificationDeliveries', group: '通知', label: '通知配信' },
  { key: 'leaveUpcoming', group: '通知', label: '休暇予定通知' },
  { key: 'chatAckReminders', group: '通知', label: '確認依頼リマインド' },
  { key: 'chatRoomAclAlerts', group: '通知', label: 'ACL不整合通知' },
  { key: 'recurringProjects', group: '定期/連携', label: '定期案件生成' },
  { key: 'integrations', group: '定期/連携', label: '連携ジョブ実行' },
];

const JOB_KEY_SET = new Set<JobKey>(JOB_DEFINITIONS.map((item) => item.key));
const JOB_GROUP_SET = new Set<JobGroup>([
  '運用',
  'レポート',
  '通知',
  '定期/連携',
]);

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildInitialState = (): Record<JobKey, JobState> => ({
  alerts: { result: null, error: '', loading: false },
  approvalEscalations: { result: null, error: '', loading: false },
  dataQuality: { result: null, error: '', loading: false },
  reportSubscriptions: { result: null, error: '', loading: false },
  reportDeliveries: { result: null, error: '', loading: false },
  notificationDeliveries: { result: null, error: '', loading: false },
  chatAckReminders: { result: null, error: '', loading: false },
  leaveUpcoming: { result: null, error: '', loading: false },
  chatRoomAclAlerts: { result: null, error: '', loading: false },
  dailyReportMissing: { result: null, error: '', loading: false },
  recurringProjects: { result: null, error: '', loading: false },
  integrations: { result: null, error: '', loading: false },
});

const toJobKey = (value: string): JobKey | null => {
  if (!JOB_KEY_SET.has(value as JobKey)) return null;
  return value as JobKey;
};

const resolveJobStatus = (state: JobState) => {
  if (state.loading) return 'running';
  if (state.error) return 'failed';
  if (state.result) return 'done';
  return 'pending';
};

const summarizeResult = (state: JobState) => {
  if (state.loading) return '実行中';
  if (state.error) return state.error;
  if (!state.result) return '-';
  const compact = JSON.stringify(state.result);
  if (!compact) return '-';
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
};

const normalizeGroupFilter = (value: string): 'all' | JobGroup => {
  if (value === 'all') return 'all';
  if (JOB_GROUP_SET.has(value as JobGroup)) return value as JobGroup;
  return 'all';
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#334155',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '4px 8px',
};

export const AdminJobs: React.FC = () => {
  const [jobs, setJobs] = useState<Record<JobKey, JobState>>(buildInitialState);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | JobGroup>('all');
  const [detailJobKey, setDetailJobKey] = useState<JobKey | null>(null);

  const [reportDryRun, setReportDryRun] = useState(false);
  const [reportRetryDryRun, setReportRetryDryRun] = useState(false);
  const [notificationDryRun, setNotificationDryRun] = useState(false);
  const [notificationLimit, setNotificationLimit] = useState('50');
  const [chatAckReminderDryRun, setChatAckReminderDryRun] = useState(false);
  const [chatAckReminderLimit, setChatAckReminderLimit] = useState('200');
  const [leaveUpcomingDryRun, setLeaveUpcomingDryRun] = useState(false);
  const [leaveUpcomingTargetDate, setLeaveUpcomingTargetDate] = useState('');
  const [chatRoomAclDryRun, setChatRoomAclDryRun] = useState(false);
  const [chatRoomAclLimit, setChatRoomAclLimit] = useState('200');
  const [dailyReportDryRun, setDailyReportDryRun] = useState(false);
  const [dailyReportTargetDate, setDailyReportTargetDate] = useState('');
  const savedViews = useSavedViews<SavedFilterPayload>({
    initialViews: [
      {
        id: 'default',
        name: '既定',
        payload: { search: '', groupFilter: 'all' },
        createdAt: '2026-02-11T00:00:00.000Z',
        updatedAt: '2026-02-11T00:00:00.000Z',
      },
    ],
    initialActiveViewId: 'default',
    storageAdapter: createLocalStorageSavedViewsAdapter<SavedFilterPayload>(
      'erp4-admin-jobs-saved-views',
    ),
  });

  const notificationLimitError = useMemo(() => {
    if (!notificationLimit.trim()) return '';
    const parsed = Number(notificationLimit);
    if (!Number.isFinite(parsed)) return 'limit は有効な数値で入力してください';
    if (parsed < 1 || parsed > 200) return 'limit は 1-200 で入力してください';
    return '';
  }, [notificationLimit]);

  const chatAckReminderLimitError = useMemo(() => {
    if (!chatAckReminderLimit.trim()) return '';
    const parsed = Number(chatAckReminderLimit);
    if (!Number.isFinite(parsed)) return 'limit は有効な数値で入力してください';
    if (parsed < 1 || parsed > 500) return 'limit は 1-500 で入力してください';
    return '';
  }, [chatAckReminderLimit]);

  const updateJob = useCallback((key: JobKey, next: Partial<JobState>) => {
    setJobs((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...next },
    }));
  }, []);

  const runJob = useCallback(
    async (key: JobKey, path: string, body?: Record<string, unknown>) => {
      try {
        updateJob(key, { loading: true, error: '' });
        const result = await api<JobResult>(path, {
          method: 'POST',
          body: body ? JSON.stringify(body) : undefined,
        });
        updateJob(key, { result, loading: false });
      } catch {
        updateJob(key, {
          error: 'ジョブ実行に失敗しました',
          loading: false,
        });
      }
    },
    [updateJob],
  );

  const executeJob = useCallback(
    (key: JobKey) => {
      switch (key) {
        case 'alerts':
          void runJob('alerts', '/jobs/alerts/run');
          return;
        case 'approvalEscalations':
          void runJob('approvalEscalations', '/jobs/approval-escalations/run');
          return;
        case 'dataQuality':
          void runJob('dataQuality', '/jobs/data-quality/run');
          return;
        case 'reportSubscriptions':
          void runJob('reportSubscriptions', '/jobs/report-subscriptions/run', {
            dryRun: reportDryRun,
          });
          return;
        case 'reportDeliveries':
          void runJob('reportDeliveries', '/jobs/report-deliveries/retry', {
            dryRun: reportRetryDryRun,
          });
          return;
        case 'notificationDeliveries': {
          if (notificationLimitError) {
            updateJob('notificationDeliveries', {
              error: notificationLimitError,
            });
            return;
          }
          const limit = notificationLimit.trim()
            ? Number(notificationLimit)
            : undefined;
          void runJob(
            'notificationDeliveries',
            '/jobs/notification-deliveries/run',
            {
              dryRun: notificationDryRun,
              ...(limit ? { limit } : {}),
            },
          );
          return;
        }
        case 'chatAckReminders': {
          if (chatAckReminderLimitError) {
            updateJob('chatAckReminders', { error: chatAckReminderLimitError });
            return;
          }
          const limit = chatAckReminderLimit.trim()
            ? Number(chatAckReminderLimit)
            : undefined;
          void runJob('chatAckReminders', '/jobs/chat-ack-reminders/run', {
            dryRun: chatAckReminderDryRun,
            ...(limit ? { limit } : {}),
          });
          return;
        }
        case 'leaveUpcoming':
          void runJob('leaveUpcoming', '/jobs/leave-upcoming/run', {
            ...(leaveUpcomingTargetDate.trim()
              ? { targetDate: leaveUpcomingTargetDate.trim() }
              : {}),
            dryRun: leaveUpcomingDryRun,
          });
          return;
        case 'chatRoomAclAlerts': {
          const limitRaw = chatRoomAclLimit.trim();
          const limit = limitRaw ? Number(limitRaw) : undefined;
          if (limitRaw && !Number.isFinite(limit)) {
            updateJob('chatRoomAclAlerts', {
              error: 'limit は有効な数値で入力してください',
            });
            return;
          }
          if (limit !== undefined && (limit < 1 || limit > 500)) {
            updateJob('chatRoomAclAlerts', {
              error: 'limit は 1-500 で入力してください',
            });
            return;
          }
          void runJob('chatRoomAclAlerts', '/jobs/chat-room-acl-alerts/run', {
            dryRun: chatRoomAclDryRun,
            ...(limit !== undefined ? { limit } : {}),
          });
          return;
        }
        case 'dailyReportMissing':
          void runJob('dailyReportMissing', '/jobs/daily-report-missing/run', {
            ...(dailyReportTargetDate.trim()
              ? { targetDate: dailyReportTargetDate.trim() }
              : {}),
            dryRun: dailyReportDryRun,
          });
          return;
        case 'recurringProjects':
          void runJob('recurringProjects', '/jobs/recurring-projects/run');
          return;
        case 'integrations':
          void runJob('integrations', '/jobs/integrations/run');
          return;
        default:
          return;
      }
    },
    [
      chatAckReminderDryRun,
      chatAckReminderLimit,
      chatAckReminderLimitError,
      chatRoomAclDryRun,
      chatRoomAclLimit,
      dailyReportDryRun,
      dailyReportTargetDate,
      leaveUpcomingDryRun,
      leaveUpcomingTargetDate,
      notificationDryRun,
      notificationLimit,
      notificationLimitError,
      reportDryRun,
      reportRetryDryRun,
      runJob,
      updateJob,
    ],
  );

  const buildParameterSummary = useCallback(
    (key: JobKey) => {
      switch (key) {
        case 'reportSubscriptions':
          return `dryRun=${reportDryRun}`;
        case 'reportDeliveries':
          return `dryRun=${reportRetryDryRun}`;
        case 'notificationDeliveries':
          return `dryRun=${notificationDryRun}, limit=${notificationLimit || '-'}`;
        case 'chatAckReminders':
          return `dryRun=${chatAckReminderDryRun}, limit=${chatAckReminderLimit || '-'}`;
        case 'leaveUpcoming':
          return `dryRun=${leaveUpcomingDryRun}, targetDate=${leaveUpcomingTargetDate || '-'}`;
        case 'chatRoomAclAlerts':
          return `dryRun=${chatRoomAclDryRun}, limit=${chatRoomAclLimit || '-'}`;
        case 'dailyReportMissing':
          return `dryRun=${dailyReportDryRun}, targetDate=${dailyReportTargetDate || '-'}`;
        default:
          return '-';
      }
    },
    [
      chatAckReminderDryRun,
      chatAckReminderLimit,
      chatRoomAclDryRun,
      chatRoomAclLimit,
      dailyReportDryRun,
      dailyReportTargetDate,
      leaveUpcomingDryRun,
      leaveUpcomingTargetDate,
      notificationDryRun,
      notificationLimit,
      reportDryRun,
      reportRetryDryRun,
    ],
  );

  const filteredDefinitions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return JOB_DEFINITIONS.filter((job) => {
      if (groupFilter !== 'all' && job.group !== groupFilter) {
        return false;
      }
      if (!needle) return true;
      return `${job.label} ${job.group}`.toLowerCase().includes(needle);
    });
  }, [groupFilter, search]);

  const rows = useMemo<DataTableRow[]>(
    () =>
      filteredDefinitions.map((job) => ({
        id: job.key,
        group: job.group,
        job: job.label,
        params: buildParameterSummary(job.key),
        status: resolveJobStatus(jobs[job.key]),
        summary: summarizeResult(jobs[job.key]),
      })),
    [buildParameterSummary, filteredDefinitions, jobs],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'group', header: '分類' },
      { key: 'job', header: 'ジョブ' },
      { key: 'params', header: 'パラメータ' },
      {
        key: 'status',
        header: '状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.status || '')}
            dictionary={{
              ...erpStatusDictionary,
              pending: { label: '未実行', tone: 'neutral' },
              running: { label: '実行中', tone: 'warning' },
              failed: { label: '失敗', tone: 'danger' },
              done: { label: '完了', tone: 'success' },
            }}
            size="sm"
          />
        ),
      },
      { key: 'summary', header: '結果サマリ' },
    ],
    [],
  );

  const listContent = (() => {
    if (rows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'ジョブがありません',
            description: '検索条件を変更してください',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={columns}
        rows={rows}
        rowActions={[
          {
            key: 'run',
            label: '実行',
            onSelect: (row) => {
              const key = toJobKey(row.id);
              if (!key) return;
              if (jobs[key].loading) return;
              executeJob(key);
            },
          },
          {
            key: 'detail',
            label: '詳細',
            onSelect: (row) => {
              const key = toJobKey(row.id);
              if (!key) return;
              setDetailJobKey(key);
            },
          },
        ]}
      />
    );
  })();

  const detailState = detailJobKey ? jobs[detailJobKey] : null;
  const detailLabel = detailJobKey
    ? JOB_DEFINITIONS.find((item) => item.key === detailJobKey)?.label || ''
    : '';

  return (
    <div>
      <h2>運用ジョブ</h2>
      <Card padding="small">
        <h3 style={{ marginTop: 0 }}>実行パラメータ</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          <div
            className="row"
            style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={dailyReportDryRun}
                onChange={(e) => setDailyReportDryRun(e.target.checked)}
              />
              日報未提出通知 dryRun
            </label>
            <Input
              value={dailyReportTargetDate}
              onChange={(e) => setDailyReportTargetDate(e.target.value)}
              placeholder="日報対象日 YYYY-MM-DD"
              style={{ width: 180 }}
            />
          </div>
          <div
            className="row"
            style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={reportDryRun}
                onChange={(e) => setReportDryRun(e.target.checked)}
              />
              予約レポート dryRun
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={reportRetryDryRun}
                onChange={(e) => setReportRetryDryRun(e.target.checked)}
              />
              配信リトライ dryRun
            </label>
          </div>
          <div
            className="row"
            style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={notificationDryRun}
                onChange={(e) => setNotificationDryRun(e.target.checked)}
              />
              通知配信 dryRun
            </label>
            <Input
              label="通知 limit"
              type="number"
              min={1}
              max={200}
              value={notificationLimit}
              onChange={(e) => setNotificationLimit(e.target.value)}
              error={notificationLimitError || undefined}
              style={{ width: 120 }}
            />
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={leaveUpcomingDryRun}
                onChange={(e) => setLeaveUpcomingDryRun(e.target.checked)}
              />
              休暇予定通知 dryRun
            </label>
            <Input
              value={leaveUpcomingTargetDate}
              onChange={(e) => setLeaveUpcomingTargetDate(e.target.value)}
              placeholder="休暇対象日 YYYY-MM-DD"
              style={{ width: 180 }}
            />
          </div>
          <div
            className="row"
            style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={chatAckReminderDryRun}
                onChange={(e) => setChatAckReminderDryRun(e.target.checked)}
              />
              確認依頼リマインド dryRun
            </label>
            <Input
              label="ack limit"
              type="number"
              min={1}
              max={500}
              value={chatAckReminderLimit}
              onChange={(e) => setChatAckReminderLimit(e.target.value)}
              error={chatAckReminderLimitError || undefined}
              style={{ width: 120 }}
            />
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={chatRoomAclDryRun}
                onChange={(e) => setChatRoomAclDryRun(e.target.checked)}
              />
              ACL不整合通知 dryRun
            </label>
            <Input
              label="acl limit"
              type="number"
              min={1}
              max={500}
              value={chatRoomAclLimit}
              onChange={(e) => setChatRoomAclLimit(e.target.value)}
              style={{ width: 120 }}
            />
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        <SavedViewBar
          views={savedViews.views}
          activeViewId={savedViews.activeViewId}
          onSelectView={(viewId) => {
            savedViews.selectView(viewId);
            const selected = savedViews.views.find((view) => view.id === viewId);
            if (!selected) return;
            setSearch(selected.payload.search);
            setGroupFilter(normalizeGroupFilter(selected.payload.groupFilter));
          }}
          onSaveAs={(name) => {
            savedViews.createView(name, { search, groupFilter });
          }}
          onUpdateView={(viewId) => {
            savedViews.updateView(viewId, { payload: { search, groupFilter } });
          }}
          onDuplicateView={(viewId) => {
            savedViews.duplicateView(viewId);
          }}
          onShareView={(viewId) => {
            savedViews.toggleShared(viewId, true);
          }}
          onDeleteView={(viewId) => {
            savedViews.deleteView(viewId);
          }}
          labels={{
            title: '保存ビュー',
            saveAsPlaceholder: 'ビュー名',
            saveAsButton: '保存',
            update: '更新',
            duplicate: '複製',
            share: '共有',
            delete: '削除',
            active: '現在のビュー',
          }}
        />
        <CrudList
          title="ジョブ一覧"
          description="ジョブ実行・状態確認・結果詳細を一元管理します。"
          filters={
            <FilterBar
              actions={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch('');
                    setGroupFilter('all');
                  }}
                >
                  条件クリア
                </Button>
              }
            >
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ジョブ名 / 分類で検索"
                  aria-label="ジョブ検索"
                />
                <Select
                  value={groupFilter}
                  onChange={(e) =>
                    setGroupFilter(e.target.value as 'all' | JobGroup)
                  }
                  aria-label="ジョブ分類フィルタ"
                >
                  <option value="all">分類: 全て</option>
                  <option value="運用">運用</option>
                  <option value="レポート">レポート</option>
                  <option value="通知">通知</option>
                  <option value="定期/連携">定期/連携</option>
                </Select>
              </div>
            </FilterBar>
          }
          table={listContent}
        />
      </div>

      <Dialog
        open={Boolean(detailJobKey)}
        onClose={() => setDetailJobKey(null)}
        title={detailLabel ? `ジョブ結果: ${detailLabel}` : 'ジョブ結果'}
        size="large"
        footer={
          <Button variant="secondary" onClick={() => setDetailJobKey(null)}>
            閉じる
          </Button>
        }
      >
        {detailState && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              <StatusBadge
                status={resolveJobStatus(detailState)}
                dictionary={{
                  ...erpStatusDictionary,
                  pending: { label: '未実行', tone: 'neutral' },
                  running: { label: '実行中', tone: 'warning' },
                  failed: { label: '失敗', tone: 'danger' },
                  done: { label: '完了', tone: 'success' },
                }}
                size="sm"
              />
            </div>
            {detailState.error && (
              <Alert variant="error">{detailState.error}</Alert>
            )}
            {!detailState.error &&
              !detailState.result &&
              !detailState.loading && (
                <AsyncStatePanel
                  state="empty"
                  empty={{
                    title: '結果がありません',
                    description: 'ジョブ未実行です',
                  }}
                />
              )}
            {detailState.loading && (
              <AsyncStatePanel state="loading" loadingText="ジョブ実行中" />
            )}
            {detailState.result && (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 12,
                  color: '#0f172a',
                }}
              >
                {formatJson(detailState.result)}
              </pre>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
};
