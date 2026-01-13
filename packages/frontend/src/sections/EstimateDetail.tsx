import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type SendLog = {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
  error?: string | null;
};

type EstimateDetailProps = {
  id: string;
  estimateNo?: string;
  projectId: string;
  status: string;
  totalAmount: unknown;
  currency: string;
  validUntil?: string | null;
  notes?: string | null;
  lines?: { description: string; quantity: unknown; unitPrice: unknown }[];
  approval?: { step: number; total: number; status: string };
  onSend?: () => void;
};

export const EstimateDetail: React.FC<EstimateDetailProps> = ({
  id,
  estimateNo,
  projectId,
  status,
  totalAmount,
  currency,
  validUntil,
  notes,
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
        `/estimates/${id}/send-logs`,
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
      <h3>見積詳細</h3>
      <div>ID: {id}</div>
      <div>No: {estimateNo || '(draft)'}</div>
      <div>Project: {projectId}</div>
      <div>Status: {status}</div>
      <div>
        Amount: {String(totalAmount)} {currency}
      </div>
      {validUntil && <div>Valid until: {validUntil.slice(0, 10)}</div>}
      {notes && <div>Notes: {notes}</div>}
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
                <td>{String(l.quantity)}</td>
                <td>{String(l.unitPrice)}</td>
                <td>{Number(l.quantity) * Number(l.unitPrice)}</td>
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
          <button
            className="button secondary"
            onClick={loadSendLogs}
            disabled={isLoadingLogs}
          >
            {isLoadingLogs ? '更新中...' : '更新'}
          </button>
        </div>
        {sendLogError && (
          <div style={{ color: '#dc2626', marginTop: 4 }}>{sendLogError}</div>
        )}
        <ul className="list">
          {sendLogs.map((log) => (
            <li key={log.id}>
              <span className="badge">{log.status}</span> {log.channel} /{' '}
              {new Date(log.createdAt).toLocaleString()}
              {log.error && (
                <div style={{ color: '#dc2626' }}>Error: {log.error}</div>
              )}
            </li>
          ))}
          {sendLogs.length === 0 && !sendLogError && <li>履歴なし</li>}
        </ul>
      </div>
      <button className="button" onClick={onSend}>
        送信 (Stub)
      </button>
    </div>
  );
};
