import React, { useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import { Alert, Button, Card, EmptyState, Input } from '../ui';
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
  const [message, setMessage] = useState('');
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);

  const trimmedLogId = logId.trim();

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

  const loadLog = async () => {
    if (!trimmedLogId) {
      setMessage('送信ログIDを入力してください');
      return;
    }
    try {
      setIsLoadingLog(true);
      setMessage('');
      const res = await api<DocumentSendLog>(
        `/document-send-logs/${trimmedLogId}`,
      );
      setLog(res);
    } catch (err) {
      setLog(null);
      setMessage('送信ログの取得に失敗しました');
    } finally {
      setIsLoadingLog(false);
    }
  };

  const loadEvents = async () => {
    if (!trimmedLogId) {
      setMessage('送信ログIDを入力してください');
      return;
    }
    try {
      setIsLoadingEvents(true);
      setMessage('');
      const res = await api<{ items: DocumentSendEvent[] }>(
        `/document-send-logs/${trimmedLogId}/events`,
      );
      setEvents(res.items || []);
    } catch (err) {
      setEvents([]);
      setMessage('送信イベントの取得に失敗しました');
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const loadAll = async () => {
    await Promise.all([loadLog(), loadEvents()]);
  };

  const retrySend = async () => {
    if (!trimmedLogId) {
      setMessage('送信ログIDを入力してください');
      return;
    }
    try {
      setIsRetrying(true);
      setMessage('');
      const res = await api<{ status: string; retryLogId?: string }>(
        `/document-send-logs/${trimmedLogId}/retry`,
        { method: 'POST' },
      );
      setMessage(
        res.retryLogId
          ? `再送を開始しました（retryLogId: ${res.retryLogId}）`
          : '再送を開始しました',
      );
      await loadAll();
    } catch (err) {
      setMessage('再送に失敗しました');
    } finally {
      setIsRetrying(false);
    }
  };

  const openPdf = async () => {
    if (!log?.pdfUrl) {
      setMessage('PDF URL がありません');
      return;
    }
    if (log.pdfUrl.startsWith('stub://')) {
      setMessage('PDF は stub です');
      return;
    }
    try {
      setIsOpeningPdf(true);
      const res = await apiResponse(log.pdfUrl);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const filename = `document-${formatDateForFilename()}.pdf`;
      await openResponseInNewTab(res, filename);
    } catch (err) {
      setMessage('PDFの取得に失敗しました');
    } finally {
      setIsOpeningPdf(false);
    }
  };

  return (
    <div>
      <h2>ドキュメント送信ログ</h2>
      <Card padding="small">
        <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <Input
            label="sendLogId"
            value={logId}
            onChange={(e) => setLogId(e.target.value)}
            placeholder="送信ログID"
          />
          <Button onClick={loadLog} loading={isLoadingLog}>
            送信ログ取得
          </Button>
          <Button
            variant="secondary"
            onClick={loadEvents}
            loading={isLoadingEvents}
          >
            イベント取得
          </Button>
          <Button variant="secondary" onClick={loadAll}>
            まとめて取得
          </Button>
        </div>
        {message && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{message}</Alert>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        <Card padding="small">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>送信ログ</strong>
            <div className="row" style={{ gap: 8 }}>
              {log?.pdfUrl && (
                <Button
                  variant="secondary"
                  onClick={openPdf}
                  loading={isOpeningPdf}
                >
                  PDFを開く
                </Button>
              )}
              <Button
                onClick={retrySend}
                disabled={!canRetry}
                loading={isRetrying}
              >
                再送
              </Button>
            </div>
          </div>
          {!log && <EmptyState title="送信ログなし" />}
          {log && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <div>
                <span className="badge">{log.status}</span> {log.kind} /
                {log.channel}
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                target: {log.targetTable} / {log.targetId}
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                created: {formatDateTime(log.createdAt)} / updated:{' '}
                {formatDateTime(log.updatedAt)}
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                recipients: {formatRecipients(log.recipients)}
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                providerMessageId: {log.providerMessageId || '-'}
              </div>
              {log.error && (
                <div style={{ fontSize: 12, color: '#dc2626' }}>
                  error: {log.error}
                </div>
              )}
              {log.metadata && (
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 12,
                    color: '#475569',
                  }}
                >
                  {formatPayload(log.metadata)}
                </pre>
              )}
            </div>
          )}
        </Card>

        <Card padding="small">
          <strong>送信イベント</strong>
          {events.length === 0 && <EmptyState title="イベントなし" />}
          {events.length > 0 && (
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              {events.map((event) => (
                <Card key={event.id} padding="small">
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>{event.provider}</strong> / {event.eventType}
                    </div>
                    <span className="badge">
                      {formatDateTime(event.eventAt || event.createdAt)}
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: '6px 0 0',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12,
                      color: '#475569',
                    }}
                  >
                    {formatPayload(event.payload)}
                  </pre>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
