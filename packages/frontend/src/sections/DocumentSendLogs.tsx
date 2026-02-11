import React, { useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  ConfirmActionDialog,
  CrudList,
  DataTable,
  FilterBar,
  Input,
  SavedViewBar,
  StatusBadge,
  createLocalStorageSavedViewsAdapter,
  erpStatusDictionary,
  useSavedViews,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import { formatDateForFilename, openResponseInNewTab } from '../utils/download';

type DocumentSendLog = {
  id: string;
  kind: string;
  targetTable: string;
  targetId: string;
  channel: string;
  status: string;
  recipients?: unknown;
  templateId?: string | null;
  pdfUrl?: string | null;
  providerMessageId?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
};

type DocumentSendEvent = {
  id: string;
  provider: string;
  eventType: string;
  eventAt?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
};

type ListStatus = 'idle' | 'loading' | 'error' | 'success';
type SavedFilterPayload = { logId: string };

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatRecipients = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }
  if (!value) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatPayload = (value: Record<string, unknown> | null | undefined) => {
  if (!value) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const DocumentSendLogs: React.FC = () => {
  const [logId, setLogId] = useState('');
  const [log, setLog] = useState<DocumentSendLog | null>(null);
  const [events, setEvents] = useState<DocumentSendEvent[]>([]);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [logStatus, setLogStatus] = useState<ListStatus>('idle');
  const [logError, setLogError] = useState('');
  const [eventsStatus, setEventsStatus] = useState<ListStatus>('idle');
  const [eventsError, setEventsError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);
  const [retryTargetLogId, setRetryTargetLogId] = useState<string | null>(null);

  const trimmedLogId = logId.trim();
  const savedViews = useSavedViews<SavedFilterPayload>({
    initialViews: [
      {
        id: 'default',
        name: '既定',
        payload: { logId: '' },
        createdAt: '2026-02-11T00:00:00.000Z',
        updatedAt: '2026-02-11T00:00:00.000Z',
      },
    ],
    initialActiveViewId: 'default',
    storageAdapter: createLocalStorageSavedViewsAdapter<SavedFilterPayload>(
      'erp4-document-send-log-saved-views',
    ),
  });

  const canRetry = useMemo(() => {
    if (!log) return false;
    const blocked = new Set([
      'success',
      'stub',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'processed',
    ]);
    return !blocked.has(log.status);
  }, [log]);

  const logRows = useMemo<DataTableRow[]>(
    () =>
      log
        ? [
            {
              id: log.id,
              status: log.status,
              kind: log.kind,
              channel: log.channel,
              target: `${log.targetTable} / ${log.targetId}`,
              createdAt: formatDateTime(log.createdAt),
              updatedAt: formatDateTime(log.updatedAt),
              recipients: formatRecipients(log.recipients),
              templateId: log.templateId || '-',
              providerMessageId: log.providerMessageId || '-',
              error: log.error || '-',
              metadata: formatPayload(log.metadata),
            },
          ]
        : [],
    [log],
  );

  const eventRows = useMemo<DataTableRow[]>(
    () =>
      events.map((event) => ({
        id: event.id,
        provider: event.provider,
        eventType: event.eventType,
        eventAt: formatDateTime(event.eventAt || event.createdAt),
        payload: formatPayload(event.payload),
      })),
    [events],
  );

  const logColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'id', header: '送信ログID' },
      {
        key: 'status',
        header: '状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.status || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      { key: 'kind', header: '種別' },
      { key: 'channel', header: 'チャネル' },
      { key: 'target', header: '対象' },
      { key: 'createdAt', header: '作成日時' },
      { key: 'updatedAt', header: '更新日時' },
      { key: 'recipients', header: '宛先' },
      { key: 'templateId', header: 'テンプレートID' },
      { key: 'providerMessageId', header: '送信プロバイダID' },
      {
        key: 'error',
        header: 'エラー',
        cell: (row) => (
          <span
            style={{
              color: row.error && row.error !== '-' ? '#dc2626' : '#475569',
              fontSize: 12,
            }}
          >
            {String(row.error || '-')}
          </span>
        ),
      },
      {
        key: 'metadata',
        header: 'metadata',
        cell: (row) => (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              color: '#475569',
            }}
          >
            {String(row.metadata || '-')}
          </pre>
        ),
      },
    ],
    [],
  );

  const eventColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'provider', header: 'provider' },
      { key: 'eventType', header: 'eventType' },
      { key: 'eventAt', header: 'eventAt' },
      {
        key: 'payload',
        header: 'payload',
        cell: (row) => (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              color: '#475569',
            }}
          >
            {String(row.payload || '-')}
          </pre>
        ),
      },
    ],
    [],
  );

  const loadLog = async () => {
    if (!trimmedLogId) {
      setMessage({ text: '送信ログIDを入力してください', type: 'error' });
      return;
    }
    try {
      setLogStatus('loading');
      setLogError('');
      setMessage(null);
      const res = await api<DocumentSendLog>(
        `/document-send-logs/${trimmedLogId}`,
      );
      setLog(res);
      setLogStatus('success');
    } catch (err) {
      setLog(null);
      setLogStatus('error');
      setLogError('送信ログの取得に失敗しました');
      setMessage({ text: '送信ログの取得に失敗しました', type: 'error' });
      console.error('Failed to load document send log.', err);
    }
  };

  const loadEvents = async () => {
    if (!trimmedLogId) {
      setMessage({ text: '送信ログIDを入力してください', type: 'error' });
      return;
    }
    try {
      setEventsStatus('loading');
      setEventsError('');
      setMessage(null);
      const res = await api<{ items: DocumentSendEvent[] }>(
        `/document-send-logs/${trimmedLogId}/events`,
      );
      setEvents(res.items || []);
      setEventsStatus('success');
    } catch (err) {
      setEvents([]);
      setEventsStatus('error');
      setEventsError('送信イベントの取得に失敗しました');
      setMessage({ text: '送信イベントの取得に失敗しました', type: 'error' });
      console.error('Failed to load document send events.', err);
    }
  };

  const loadAll = async () => {
    if (!trimmedLogId) {
      setMessage({ text: '送信ログIDを入力してください', type: 'error' });
      return;
    }
    await Promise.all([loadLog(), loadEvents()]);
  };

  const retrySend = async (targetLogId: string) => {
    const normalizedTarget = targetLogId.trim();
    if (!normalizedTarget) {
      setMessage({ text: '送信ログIDを入力してください', type: 'error' });
      return;
    }
    try {
      setIsRetrying(true);
      setMessage(null);
      const res = await api<{ status: string; retryLogId?: string }>(
        `/document-send-logs/${normalizedTarget}/retry`,
        { method: 'POST' },
      );
      setMessage({
        text: res.retryLogId
          ? `再送を開始しました（retryLogId: ${res.retryLogId}）`
          : '再送を開始しました',
        type: 'success',
      });
      await loadAll();
    } catch (err) {
      setMessage({ text: '再送に失敗しました', type: 'error' });
      console.error('Failed to retry document send.', err);
    } finally {
      setIsRetrying(false);
    }
  };

  const openPdf = async () => {
    if (!log?.pdfUrl) {
      setMessage({ text: 'PDF URL がありません', type: 'error' });
      return;
    }
    if (log.pdfUrl.startsWith('stub://')) {
      setMessage({ text: 'PDF は stub です', type: 'info' });
      return;
    }
    try {
      setIsOpeningPdf(true);
      setMessage(null);
      const res = await apiResponse(log.pdfUrl);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const filename = `document-${formatDateForFilename()}.pdf`;
      await openResponseInNewTab(res, filename);
    } catch (err) {
      setMessage({ text: 'PDFの取得に失敗しました', type: 'error' });
      console.error('Failed to open PDF.', err);
    } finally {
      setIsOpeningPdf(false);
    }
  };

  const logTable = (() => {
    if (logStatus === 'idle') {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '送信ログIDを入力して取得してください',
          }}
        />
      );
    }
    if (logStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="送信ログを取得中" />;
    }
    if (logStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '送信ログの取得に失敗しました',
            detail: logError,
            onRetry: () => {
              void loadLog();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (logRows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '送信ログがありません',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={logColumns}
        rows={logRows}
        rowActions={[
          {
            key: 'open-pdf',
            label: 'PDFを開く',
            onSelect: () => {
              if (!log?.pdfUrl) {
                setMessage({ text: 'PDF URL がありません', type: 'error' });
                return;
              }
              if (isOpeningPdf) return;
              void openPdf();
            },
          },
          {
            key: 'retry',
            label: '再送',
            onSelect: (row) => {
              if (!canRetry) {
                setMessage({
                  text: 'このステータスのログは再送できません',
                  type: 'error',
                });
                return;
              }
              if (isRetrying) return;
              setRetryTargetLogId(row.id);
            },
          },
        ]}
      />
    );
  })();

  const eventTable = (() => {
    if (eventsStatus === 'idle') {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '送信イベントを取得してください',
          }}
        />
      );
    }
    if (eventsStatus === 'loading') {
      return (
        <AsyncStatePanel state="loading" loadingText="送信イベントを取得中" />
      );
    }
    if (eventsStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '送信イベントの取得に失敗しました',
            detail: eventsError,
            onRetry: () => {
              void loadEvents();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (eventRows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '送信イベントがありません',
          }}
        />
      );
    }
    return <DataTable columns={eventColumns} rows={eventRows} />;
  })();

  return (
    <div>
      <h2>ドキュメント送信ログ</h2>
      <Card padding="small">
        <SavedViewBar
          views={savedViews.views}
          activeViewId={savedViews.activeViewId}
          onSelectView={(viewId) => {
            savedViews.selectView(viewId);
            const selected = savedViews.views.find((view) => view.id === viewId);
            if (!selected) return;
            setLogId(selected.payload.logId);
          }}
          onSaveAs={(name) => {
            savedViews.createView(name, { logId });
          }}
          onUpdateView={(viewId) => {
            savedViews.updateView(viewId, { payload: { logId } });
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
        <FilterBar
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="ghost"
                onClick={() => {
                  setLogId('');
                  setLog(null);
                  setEvents([]);
                  setLogStatus('idle');
                  setEventsStatus('idle');
                  setLogError('');
                  setEventsError('');
                  setMessage(null);
                  setRetryTargetLogId(null);
                }}
              >
                クリア
              </Button>
              <Button onClick={loadLog} loading={logStatus === 'loading'}>
                送信ログ取得
              </Button>
              <Button
                variant="secondary"
                onClick={loadEvents}
                loading={eventsStatus === 'loading'}
              >
                イベント取得
              </Button>
              <Button
                variant="secondary"
                onClick={loadAll}
                loading={logStatus === 'loading' || eventsStatus === 'loading'}
              >
                まとめて取得
              </Button>
            </div>
          }
        >
          <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
            <Input
              label="sendLogId"
              value={logId}
              onChange={(e) => setLogId(e.target.value)}
              placeholder="送信ログID"
            />
          </div>
        </FilterBar>
        {message && (
          <div style={{ marginTop: 8 }}>
            <Alert
              variant={
                message.type === 'error'
                  ? 'error'
                  : message.type === 'success'
                    ? 'success'
                    : 'info'
              }
            >
              {message.text}
            </Alert>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        <Card padding="small">
          <CrudList
            title="送信ログ"
            description="送信ログの状態と宛先を確認し、必要に応じて再送できます。"
            table={logTable}
          />
        </Card>
        <Card padding="small">
          <CrudList
            title="送信イベント"
            description="配信プロバイダから受信したイベント履歴を確認できます。"
            table={eventTable}
          />
        </Card>
      </div>
      <ConfirmActionDialog
        open={Boolean(retryTargetLogId)}
        title="この送信ログを再送しますか？"
        description={
          retryTargetLogId ? `送信ログID: ${retryTargetLogId}` : undefined
        }
        confirmLabel="再送する"
        cancelLabel="キャンセル"
        confirmDisabled={isRetrying}
        onConfirm={() => {
          if (!retryTargetLogId) return;
          void retrySend(retryTargetLogId);
          setRetryTargetLogId(null);
        }}
        onCancel={() => setRetryTargetLogId(null)}
      />
    </div>
  );
};
