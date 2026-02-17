import React from 'react';
import {
  Alert,
  AsyncStatePanel,
  Button,
  DataTable,
  Dialog,
  StatusBadge,
  erpStatusDictionary,
} from '../../ui';
import type { DataTableRow } from '../../ui';
import type { DocumentSendLog } from './vendorDocumentsShared';

type PurchaseOrderSendLogsDialogProps = {
  open: boolean;
  purchaseOrderId: string | null;
  purchaseOrderStatus?: string;
  purchaseOrderNo?: string | null;
  missingNumberLabel: string;
  message: string;
  loading: boolean;
  logs: DocumentSendLog[];
  onClose: () => void;
  onOpenPdf: (purchaseOrderId: string, pdfUrl: string) => void;
};

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export const PurchaseOrderSendLogsDialog: React.FC<
  PurchaseOrderSendLogsDialogProps
> = ({
  open,
  purchaseOrderId,
  purchaseOrderStatus,
  purchaseOrderNo,
  missingNumberLabel,
  message,
  loading,
  logs,
  onClose,
  onOpenPdf,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="発注書: 送信履歴"
      size="large"
      footer={
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      }
    >
      {purchaseOrderId && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            <StatusBadge
              status={purchaseOrderStatus || 'draft'}
              dictionary={erpStatusDictionary}
              size="sm"
            />{' '}
            {purchaseOrderNo || missingNumberLabel}
          </div>
          {message && <Alert variant="error">{message}</Alert>}
          {loading && (
            <AsyncStatePanel state="loading" loadingText="送信履歴を取得中" />
          )}
          {!loading && logs.length === 0 && (
            <AsyncStatePanel
              state="empty"
              empty={{
                title: '履歴なし',
                description: '送信履歴がありません',
              }}
            />
          )}
          {!loading && logs.length > 0 && (
            <DataTable
              columns={[
                { key: 'status', header: '状態' },
                { key: 'channel', header: 'チャネル' },
                { key: 'createdAt', header: '送信日時' },
                { key: 'error', header: 'エラー' },
                { key: 'logId', header: 'ログID' },
              ]}
              rows={logs.map((log) => ({
                id: log.id,
                status: (
                  <StatusBadge
                    status={log.status}
                    dictionary={erpStatusDictionary}
                    size="sm"
                  />
                ),
                channel: log.channel,
                createdAt: formatDateTime(log.createdAt),
                error: log.error || '-',
                logId: log.id,
                pdfUrl: log.pdfUrl || '',
              }))}
              rowActions={[
                {
                  key: 'open-pdf',
                  label: 'PDFを開く',
                  onSelect: (row: DataTableRow) => {
                    const pdfUrl = String(row.pdfUrl || '');
                    if (!purchaseOrderId) return;
                    onOpenPdf(purchaseOrderId, pdfUrl);
                  },
                },
              ]}
            />
          )}
        </div>
      )}
    </Dialog>
  );
};
