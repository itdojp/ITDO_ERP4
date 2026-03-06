import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, apiResponse } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  CrudList,
  DataTable,
  DateRangePicker,
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
import {
  downloadResponseAsFile,
  formatDateForFilename,
} from '../utils/download';

type AuditLogItem = {
  id: string;
  action: string;
  userId?: string | null;
  actorRole?: string | null;
  actorGroupId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  source?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  targetTable?: string | null;
  targetId?: string | null;
  agentRunId?: string | null;
  agentRunPath?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type AgentRunDetail = {
  id: string;
  status?: string | null;
  httpStatus?: number | null;
  method?: string | null;
  path?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  steps?: unknown[];
  decisionRequests?: unknown[];
  metadata?: Record<string, unknown> | null;
};

type FilterState = {
  from: string;
  to: string;
  userId: string;
  action: string;
  sendLogId: string;
  targetTable: string;
  targetId: string;
  reasonCode: string;
  reasonText: string;
  source: string;
  actorRole: string;
  actorGroupId: string;
  requestId: string;
  limit: string;
  format: 'json' | 'csv';
};

type SavedFilterPayload = Omit<FilterState, 'format'>;

const defaultFilters: FilterState = {
  from: '',
  to: '',
  userId: '',
  action: '',
  sendLogId: '',
  targetTable: '',
  targetId: '',
  reasonCode: '',
  reasonText: '',
  source: '',
  actorRole: '',
  actorGroupId: '',
  requestId: '',
  limit: '200',
  format: 'json',
};

const toSavedFilterPayload = (filters: FilterState): SavedFilterPayload => ({
  from: filters.from,
  to: filters.to,
  userId: filters.userId,
  action: filters.action,
  sendLogId: filters.sendLogId,
  targetTable: filters.targetTable,
  targetId: filters.targetId,
  reasonCode: filters.reasonCode,
  reasonText: filters.reasonText,
  source: filters.source,
  actorRole: filters.actorRole,
  actorGroupId: filters.actorGroupId,
  requestId: filters.requestId,
  limit: filters.limit,
});

const buildQuery = (filters: FilterState) => {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.sendLogId) params.set('sendLogId', filters.sendLogId);
  if (filters.targetTable) params.set('targetTable', filters.targetTable);
  if (filters.targetId) params.set('targetId', filters.targetId);
  if (filters.reasonCode) params.set('reasonCode', filters.reasonCode);
  if (filters.reasonText) params.set('reasonText', filters.reasonText);
  if (filters.source) params.set('source', filters.source);
  if (filters.actorRole) params.set('actorRole', filters.actorRole);
  if (filters.actorGroupId) params.set('actorGroupId', filters.actorGroupId);
  if (filters.requestId) params.set('requestId', filters.requestId);
  if (filters.limit) params.set('limit', filters.limit);
  params.set('format', filters.format);
  return params.toString();
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatMetadata = (value: Record<string, unknown> | null | undefined) => {
  if (!value) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return '-';
  }
};

const DETAIL_SENSITIVE_KEYS = [
  'token',
  'authorization',
  'password',
  'secret',
  'cookie',
];

const DETAIL_MASKED_ID_KEYS = [
  'userid',
  'actoruserid',
  'principaluserid',
  'requestid',
  'runid',
];

const maskIdentifier = (value: string) => {
  if (value.length <= 4) return '*'.repeat(value.length || 4);
  const keep = Math.min(4, Math.max(2, Math.ceil(value.length / 3)));
  return `${value.slice(0, keep)}${'*'.repeat(Math.max(value.length - keep, 4))}`;
};

const sanitizeAgentRunDetail = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeAgentRunDetail);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (DETAIL_SENSITIVE_KEYS.some((item) => normalizedKey.includes(item))) {
      output[key] = '[REDACTED]';
      continue;
    }
    if (
      typeof child === 'string' &&
      DETAIL_MASKED_ID_KEYS.some((item) => normalizedKey.includes(item))
    ) {
      output[key] = maskIdentifier(child);
      continue;
    }
    output[key] = sanitizeAgentRunDetail(child);
  }
  return output;
};

export const AuditLogs: React.FC = () => {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [listStatus, setListStatus] = useState<
    'idle' | 'loading' | 'error' | 'success'
  >('idle');
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [agentRunDetail, setAgentRunDetail] = useState<AgentRunDetail | null>(
    null,
  );
  const [agentRunLoading, setAgentRunLoading] = useState(false);
  const [agentRunError, setAgentRunError] = useState('');
  const [activeAgentRunId, setActiveAgentRunId] = useState('');
  const agentRunRequestSeqRef = useRef(0);
  const initialSavedViewTimestamp = useMemo(() => new Date().toISOString(), []);
  const savedViews = useSavedViews<SavedFilterPayload>({
    initialViews: [
      {
        id: 'default',
        name: '既定',
        payload: toSavedFilterPayload(defaultFilters),
        createdAt: initialSavedViewTimestamp,
        updatedAt: initialSavedViewTimestamp,
      },
    ],
    initialActiveViewId: 'default',
    storageAdapter: createLocalStorageSavedViewsAdapter<SavedFilterPayload>(
      'erp4-audit-log-saved-views',
    ),
  });

  const query = useMemo(() => buildQuery(filters), [filters]);

  const loadLogsWithFilters = useCallback(async (nextFilters: FilterState) => {
    try {
      setListStatus('loading');
      setListError('');
      setMessage('');
      const res = await api<{ items: AuditLogItem[] }>(
        `/audit-logs?${buildQuery(nextFilters)}`,
      );
      setItems(res.items || []);
      setListStatus('success');
    } catch (err) {
      setItems([]);
      setListStatus('error');
      setListError('監査ログの取得に失敗しました');
    }
  }, []);

  const loadLogs = useCallback(async () => {
    await loadLogsWithFilters(filters);
  }, [filters, loadLogsWithFilters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: Event) => {
      const detail =
        event instanceof CustomEvent &&
        event.detail &&
        typeof event.detail === 'object'
          ? (event.detail as { sendLogId?: unknown })
          : {};
      const nextSendLogId =
        typeof detail.sendLogId === 'string' ? detail.sendLogId.trim() : '';
      if (!nextSendLogId) return;
      const nextFilters: FilterState = {
        ...defaultFilters,
        sendLogId: nextSendLogId,
        format: 'json',
      };
      setFilters(nextFilters);
      loadLogsWithFilters(nextFilters).catch(() => undefined);
    };
    window.addEventListener('erp4_open_audit_logs', handler as EventListener);
    return () => {
      window.removeEventListener(
        'erp4_open_audit_logs',
        handler as EventListener,
      );
    };
  }, [loadLogsWithFilters]);

  const downloadCsv = async () => {
    try {
      setIsDownloading(true);
      setMessage('');
      const csvQuery = buildQuery({ ...filters, format: 'csv' });
      const res = await apiResponse(`/audit-logs?${csvQuery}`);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const fallbackName = `audit-logs-${formatDateForFilename()}.csv`;
      await downloadResponseAsFile(res, fallbackName);
    } catch (err) {
      setMessage('CSV出力に失敗しました');
    } finally {
      setIsDownloading(false);
    }
  };

  const loadAgentRun = useCallback(async (runId: string) => {
    const normalizedId = String(runId || '').trim();
    if (!normalizedId) return;
    const requestSeq = agentRunRequestSeqRef.current + 1;
    agentRunRequestSeqRef.current = requestSeq;
    setActiveAgentRunId(normalizedId);
    try {
      setAgentRunLoading(true);
      setAgentRunError('');
      const detail = await api<AgentRunDetail>(
        `/agent-runs/${encodeURIComponent(normalizedId)}`,
      );
      if (agentRunRequestSeqRef.current !== requestSeq) return;
      setAgentRunDetail(detail);
    } catch (err) {
      if (agentRunRequestSeqRef.current !== requestSeq) return;
      setAgentRunDetail(null);
      setAgentRunError('AgentRun詳細の取得に失敗しました');
    } finally {
      if (agentRunRequestSeqRef.current === requestSeq) {
        setAgentRunLoading(false);
      }
    }
  }, []);

  const closeAgentRunPanel = useCallback(() => {
    agentRunRequestSeqRef.current += 1;
    setAgentRunLoading(false);
    setAgentRunError('');
    setAgentRunDetail(null);
    setActiveAgentRunId('');
  }, []);

  const rows = useMemo<DataTableRow[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        createdAt: formatDateTime(item.createdAt),
        action: item.action,
        user: item.userId || '-',
        target: `${item.targetTable || '-'} / ${item.targetId || '-'}`,
        roleGroup: `${item.actorRole || '-'} / ${item.actorGroupId || '-'}`,
        reason: `${item.reasonCode || '-'} ${item.reasonText || ''}`.trim(),
        sourceRequest: `${item.source || '-'} / ${item.requestId || '-'}`,
        agentRunId: item.agentRunId || '',
        agentRun: item.agentRunId || '-',
        metadata: formatMetadata(item.metadata),
      })),
    [items],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'createdAt', header: '日時' },
      {
        key: 'action',
        header: '操作',
        cell: (row) => (
          <StatusBadge
            status={String(row.action || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      { key: 'user', header: 'ユーザー' },
      { key: 'target', header: '対象' },
      { key: 'roleGroup', header: 'ロール/グループ' },
      { key: 'reason', header: '理由' },
      { key: 'sourceRequest', header: 'ソース/RequestID' },
      {
        key: 'agentRun',
        header: 'AgentRun',
        cell: (row) => {
          const runId = String(row.agentRunId || '').trim();
          if (!runId) return '-';
          const isActive =
            runId === activeAgentRunId &&
            (agentRunLoading || Boolean(agentRunDetail));
          return (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code>{runId.slice(0, 12)}</code>
              <Button
                size="small"
                variant={isActive ? 'primary' : 'secondary'}
                onClick={() => {
                  void loadAgentRun(runId);
                }}
              >
                {isActive ? '表示中' : '詳細'}
              </Button>
            </div>
          );
        },
      },
      { key: 'metadata', header: 'metadata' },
    ],
    [activeAgentRunId, agentRunDetail, agentRunLoading, loadAgentRun],
  );

  const listContent = (() => {
    if (listStatus === 'idle' || listStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="監査ログを取得中" />;
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '監査ログの取得に失敗しました',
            detail: listError,
            onRetry: () => {
              void loadLogs();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '監査ログなし',
            description: '条件を変更して再検索してください',
          }}
        />
      );
    }
    return <DataTable columns={columns} rows={rows} />;
  })();

  const agentRunPanel = (() => {
    if (agentRunLoading) {
      return (
        <div style={{ marginTop: 12 }}>
          <AsyncStatePanel state="loading" loadingText="AgentRun詳細を取得中" />
        </div>
      );
    }
    if (agentRunError) {
      return (
        <div style={{ marginTop: 12 }}>
          <Alert variant="error">{agentRunError}</Alert>
        </div>
      );
    }
    if (!agentRunDetail) return null;
    return (
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 8,
          }}
        >
          <Button size="small" variant="ghost" onClick={closeAgentRunPanel}>
            閉じる
          </Button>
        </div>
        <CrudList
          title={`AgentRun ${agentRunDetail.id}`}
          description="監査ログからドリルダウンした実行詳細"
          table={
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(sanitizeAgentRunDetail(agentRunDetail), null, 2)}
            </pre>
          }
        />
      </div>
    );
  })();

  return (
    <div>
      <h2>監査ログ</h2>
      {message && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="error">{message}</Alert>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <SavedViewBar
          views={savedViews.views}
          activeViewId={savedViews.activeViewId}
          onSelectView={(viewId) => {
            savedViews.selectView(viewId);
            const selected = savedViews.views.find(
              (view) => view.id === viewId,
            );
            if (!selected) return;
            setFilters((prev) => ({
              ...prev,
              ...selected.payload,
              format: 'json',
            }));
          }}
          onSaveAs={(name) => {
            savedViews.createView(name, toSavedFilterPayload(filters));
          }}
          onUpdateView={(viewId) => {
            savedViews.updateView(viewId, {
              payload: toSavedFilterPayload(filters),
            });
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
          title="監査ログ一覧"
          description="条件を指定して監査ログを検索し、CSVを出力できます。"
          filters={
            <FilterBar
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFilters(defaultFilters);
                    }}
                  >
                    条件クリア
                  </Button>
                  <Button onClick={loadLogs} loading={listStatus === 'loading'}>
                    検索
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={downloadCsv}
                    loading={isDownloading}
                  >
                    CSV出力
                  </Button>
                </div>
              }
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'flex-end',
                }}
              >
                <DateRangePicker
                  label="期間"
                  fromLabel="from"
                  toLabel="to"
                  value={{ from: filters.from, to: filters.to }}
                  onChange={(next) => {
                    setFilters({
                      ...filters,
                      from: next.from ?? '',
                      to: next.to ?? '',
                    });
                  }}
                />
                <Input
                  label="userId"
                  value={filters.userId}
                  onChange={(e) =>
                    setFilters({ ...filters, userId: e.target.value })
                  }
                />
                <Input
                  label="action"
                  value={filters.action}
                  onChange={(e) =>
                    setFilters({ ...filters, action: e.target.value })
                  }
                />
                <Input
                  label="sendLogId"
                  value={filters.sendLogId}
                  onChange={(e) =>
                    setFilters({ ...filters, sendLogId: e.target.value })
                  }
                />
                <Input
                  label="targetTable"
                  value={filters.targetTable}
                  onChange={(e) =>
                    setFilters({ ...filters, targetTable: e.target.value })
                  }
                />
                <Input
                  label="targetId"
                  value={filters.targetId}
                  onChange={(e) =>
                    setFilters({ ...filters, targetId: e.target.value })
                  }
                />
                <Input
                  label="reasonCode"
                  value={filters.reasonCode}
                  onChange={(e) =>
                    setFilters({ ...filters, reasonCode: e.target.value })
                  }
                />
                <Input
                  label="reasonText"
                  value={filters.reasonText}
                  onChange={(e) =>
                    setFilters({ ...filters, reasonText: e.target.value })
                  }
                />
                <Input
                  label="source"
                  value={filters.source}
                  onChange={(e) =>
                    setFilters({ ...filters, source: e.target.value })
                  }
                />
                <Input
                  label="actorRole"
                  value={filters.actorRole}
                  onChange={(e) =>
                    setFilters({ ...filters, actorRole: e.target.value })
                  }
                />
                <Input
                  label="actorGroupId"
                  value={filters.actorGroupId}
                  onChange={(e) =>
                    setFilters({ ...filters, actorGroupId: e.target.value })
                  }
                />
                <Input
                  label="requestId"
                  value={filters.requestId}
                  onChange={(e) =>
                    setFilters({ ...filters, requestId: e.target.value })
                  }
                />
                <Select
                  label="limit"
                  value={filters.limit}
                  onChange={(e) =>
                    setFilters({ ...filters, limit: e.target.value })
                  }
                >
                  {['50', '100', '200', '500', '1000'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </div>
            </FilterBar>
          }
          table={
            <div>
              {listContent}
              {agentRunPanel}
            </div>
          }
        />
      </div>
    </div>
  );
};
