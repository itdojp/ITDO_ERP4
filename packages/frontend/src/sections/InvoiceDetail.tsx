import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, EmptyState } from '../ui';

type SendLog = {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
  error?: string | null;
};

type InvoiceDetailProps = {
  id: string;
  invoiceNo?: string;
  projectId: string;
  status: string;
  totalAmount: number;
  lines?: { description: string; quantity: number; unitPrice: number }[];
  approval?: { step: number; total: number; status: string };
  onSend?: () => void;
};

export const InvoiceDetail: React.FC<InvoiceDetailProps> = ({
  id,
  invoiceNo,
  projectId,
  status,
  totalAmount,
  lines = [],
  approval,
  onSend,
}) => {
  const [sendLogs, setSendLogs] = useState<SendLog[]>([]);
  const [sendLogError, setSendLogError] = useState('');
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const loadSendLogs = useCallback(async () => {
    try {
      setIsLoadingLogs(true);
      setSendLogError('');
      const sendLogsResponse = await api<{ items: SendLog[] }>(
        `/invoices/${id}/send-logs`,
      );
      setSendLogs(sendLogsResponse.items || []);
    } catch (error) {
      console.error('送信履歴の取得に失敗しました', id, error);
      setSendLogError('送信履歴の取得に失敗しました');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [id]);

  useEffect(() => {
    void loadSendLogs();
  }, [loadSendLogs]);

  return (
    <div>
      <h3>請求詳細</h3>
      <div>ID: {id}</div>
      <div>No: {invoiceNo || '(draft)'}</div>
      <div>Project: {projectId}</div>
      <div>Status: {status}</div>
      <div>Amount: ¥{totalAmount.toLocaleString()}</div>
      {lines.length > 0 && (
        <table className="table" style={{ width: '100%', marginTop: 8 }}>
          <thead>
            <tr>
              <th>明細</th>
              <th>数量</th>
              <th>単価</th>
              <th>小計</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>¥{l.unitPrice.toLocaleString()}</td>
                <td>¥{(l.quantity * l.unitPrice).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {approval && (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          承認 {approval.step}/{approval.total} : {approval.status}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <strong>送信履歴</strong>
          <Button
            variant="secondary"
            onClick={loadSendLogs}
            loading={isLoadingLogs}
          >
            更新
          </Button>
        </div>
        {sendLogError && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{sendLogError}</Alert>
          </div>
        )}
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {sendLogs.map((log) => (
            <Card key={log.id} padding="small">
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <span className="badge">{log.status}</span>
                <span>{log.channel}</span>
                <span>/ {new Date(log.createdAt).toLocaleString()}</span>
              </div>
              {log.error && (
                <div style={{ marginTop: 8 }}>
                  <Alert variant="error">Error: {log.error}</Alert>
                </div>
              )}
            </Card>
          ))}
          {sendLogs.length === 0 && !sendLogError && (
            <EmptyState title="履歴なし" />
          )}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button onClick={onSend}>送信 (Stub)</Button>
      </div>
    </div>
  );
};
