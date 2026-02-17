import React from 'react';
import { Button, Dialog, StatusBadge, erpStatusDictionary } from '../../ui';
import type {
  MessageState,
  PurchaseOrderDetail,
  VendorInvoice,
  VendorInvoiceLine,
  VendorInvoicePoLineUsage,
} from './vendorDocumentsShared';

type InvoiceLineDialogState = {
  invoice: VendorInvoice;
} | null;

type InvoiceLineTotals = {
  amountTotal: number;
  taxTotal: number;
  grossTotal: number;
  invoiceTotal: number | null;
  diff: number | null;
};

type VendorInvoiceLineDialogProps = {
  open: boolean;
  dialog: InvoiceLineDialogState;
  saving: boolean;
  loading: boolean;
  expanded: boolean;
  lines: VendorInvoiceLine[];
  invoiceLinePurchaseOrderDetail: PurchaseOrderDetail | null;
  invoiceLinePoUsageByPoLineId: Record<string, VendorInvoicePoLineUsage>;
  invoiceLineRequestedQuantityByPoLine: Map<string, number>;
  invoiceLineTotals: InvoiceLineTotals | null;
  reason: string;
  message: MessageState;
  missingNumberLabel: string;
  onClose: () => void;
  onSave: () => void;
  onToggleExpanded: () => void;
  onAddRow: () => void;
  onUpdateLine: (index: number, update: Partial<VendorInvoiceLine>) => void;
  onRemoveLine: (index: number) => void;
  onChangeReason: (value: string) => void;
  onOpenAllocation: (invoice: VendorInvoice) => void;
  renderProject: (projectId: string) => string;
  renderVendor: (vendorId: string) => string;
  formatAmount: (value: number | string, currency: string) => string;
  parseNumberValue: (
    value: number | string | null | undefined,
  ) => number | null;
  isPdfUrl: (value?: string | null) => boolean;
  isReasonRequiredStatus: (status: string) => boolean;
};

export const VendorInvoiceLineDialog = ({
  open,
  dialog,
  saving,
  loading,
  expanded,
  lines,
  invoiceLinePurchaseOrderDetail,
  invoiceLinePoUsageByPoLineId,
  invoiceLineRequestedQuantityByPoLine,
  invoiceLineTotals,
  reason,
  message,
  missingNumberLabel,
  onClose,
  onSave,
  onToggleExpanded,
  onAddRow,
  onUpdateLine,
  onRemoveLine,
  onChangeReason,
  onOpenAllocation,
  renderProject,
  renderVendor,
  formatAmount,
  parseNumberValue,
  isPdfUrl,
  isReasonRequiredStatus,
}: VendorInvoiceLineDialogProps) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="仕入請求: 請求明細"
    size="large"
    footer={
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          閉じる
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? '更新中' : '更新'}
        </Button>
      </div>
    }
  >
    {dialog && (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          <StatusBadge
            status={dialog.invoice.status}
            dictionary={erpStatusDictionary}
            size="sm"
          />{' '}
          {dialog.invoice.vendorInvoiceNo || missingNumberLabel}
          {' / '}
          {renderProject(dialog.invoice.projectId)}
          {' / '}
          {renderVendor(dialog.invoice.vendorId)}
          {' / '}
          {formatAmount(dialog.invoice.totalAmount, dialog.invoice.currency)}
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#64748b' }}>請求書PDF</div>
          {!dialog.invoice.documentUrl && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>PDF未登録</div>
          )}
          {dialog.invoice.documentUrl && (
            <div style={{ display: 'grid', gap: 8 }}>
              <a
                href={dialog.invoice.documentUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12 }}
              >
                PDFを開く
              </a>
              {isPdfUrl(dialog.invoice.documentUrl) && (
                <iframe
                  title="vendor-invoice-line-pdf"
                  src={dialog.invoice.documentUrl}
                  sandbox="allow-scripts allow-same-origin"
                  style={{
                    width: '100%',
                    height: 320,
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                  }}
                />
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="secondary" onClick={onToggleExpanded}>
            {expanded ? '請求明細を隠す' : '請求明細を入力'}
          </Button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            請求明細は必要時のみ入力（未入力でも保存可）
          </span>
        </div>
        {loading && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            請求明細を読み込み中...
          </div>
        )}
        {expanded && !loading && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <button className="button secondary" onClick={onAddRow}>
                明細追加
              </button>
            </div>
            {lines.length === 0 && (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                請求明細は未入力です
              </div>
            )}
            {lines.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>行</th>
                      <th>内容</th>
                      <th>数量</th>
                      <th>単価</th>
                      <th>金額</th>
                      <th>税率</th>
                      <th>税額</th>
                      {dialog.invoice.purchaseOrderId && <th>PO明細</th>}
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((entry, index) => {
                      const quantity = parseNumberValue(entry.quantity);
                      const unitPrice = parseNumberValue(entry.unitPrice);
                      const calculatedAmount =
                        quantity != null && unitPrice != null
                          ? Math.round(quantity * unitPrice)
                          : null;
                      const amount = parseNumberValue(entry.amount);
                      const amountBase = amount ?? calculatedAmount ?? 0;
                      const taxRate = parseNumberValue(entry.taxRate);
                      const calculatedTax =
                        taxRate != null
                          ? Math.round((amountBase * taxRate) / 100)
                          : null;
                      const selectedPoLineId =
                        entry.purchaseOrderLineId?.trim() || '';
                      const selectedPoLine = selectedPoLineId
                        ? (invoiceLinePurchaseOrderDetail?.lines || []).find(
                            (line) => line.id === selectedPoLineId,
                          )
                        : null;
                      const poQuantity = selectedPoLine
                        ? parseNumberValue(selectedPoLine.quantity)
                        : null;
                      const usage = selectedPoLineId
                        ? invoiceLinePoUsageByPoLineId[selectedPoLineId]
                        : null;
                      const existingQuantity =
                        parseNumberValue(usage?.existingQuantity) ?? 0;
                      const requestedQuantity = selectedPoLineId
                        ? invoiceLineRequestedQuantityByPoLine.get(
                            selectedPoLineId,
                          ) || 0
                        : null;
                      const remainingQuantity =
                        poQuantity != null && requestedQuantity != null
                          ? poQuantity - existingQuantity - requestedQuantity
                          : null;
                      const exceedsPoQuantity =
                        remainingQuantity != null &&
                        remainingQuantity < -0.00001;
                      const hasAmountDiff =
                        amount != null &&
                        calculatedAmount != null &&
                        Math.abs(amount - calculatedAmount) > 0.00001;
                      return (
                        <tr key={`line-${entry.id ?? entry.tempId ?? index}`}>
                          <td>
                            <input
                              type="number"
                              min={1}
                              value={entry.lineNo ?? index + 1}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  lineNo: e.target.value,
                                })
                              }
                              style={{ width: 72 }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={entry.description}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  description: e.target.value,
                                })
                              }
                              placeholder="内容"
                              style={{ minWidth: 200 }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0.000001}
                              step="any"
                              value={entry.quantity}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  quantity: e.target.value,
                                })
                              }
                              style={{ width: 96 }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={entry.unitPrice}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  unitPrice: e.target.value,
                                })
                              }
                              style={{ width: 110 }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={entry.amount ?? ''}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  amount: e.target.value,
                                })
                              }
                              style={{ width: 120 }}
                            />
                            {hasAmountDiff && (
                              <div style={{ fontSize: 11, color: '#dc2626' }}>
                                自動計算との差分あり
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={entry.taxRate ?? ''}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  taxRate: e.target.value,
                                })
                              }
                              style={{ width: 80 }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={entry.taxAmount ?? ''}
                              onChange={(e) =>
                                onUpdateLine(index, {
                                  taxAmount: e.target.value,
                                })
                              }
                              style={{ width: 120 }}
                            />
                            {calculatedTax != null && (
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                自動計算: {calculatedTax}
                              </div>
                            )}
                          </td>
                          {dialog.invoice.purchaseOrderId && (
                            <td>
                              <select
                                value={entry.purchaseOrderLineId ?? ''}
                                onChange={(e) =>
                                  onUpdateLine(index, {
                                    purchaseOrderLineId: e.target.value,
                                  })
                                }
                              >
                                <option value="">紐づけなし</option>
                                {(
                                  invoiceLinePurchaseOrderDetail?.lines || []
                                ).map((line) => (
                                  <option key={line.id} value={line.id}>
                                    {line.description} / {line.quantity} x{' '}
                                    {line.unitPrice}
                                  </option>
                                ))}
                              </select>
                              {selectedPoLineId && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: exceedsPoQuantity
                                      ? '#dc2626'
                                      : '#64748b',
                                  }}
                                >
                                  他VI利用: {existingQuantity.toLocaleString()}{' '}
                                  / 入力合計:{' '}
                                  {(requestedQuantity ?? 0).toLocaleString()} /
                                  入力後残:{' '}
                                  {remainingQuantity != null
                                    ? remainingQuantity.toLocaleString()
                                    : '-'}
                                </div>
                              )}
                            </td>
                          )}
                          <td>
                            <button
                              className="button secondary"
                              onClick={() => onRemoveLine(index)}
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {invoiceLineTotals && (
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              background: '#f8fafc',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div>
                税抜合計:{' '}
                {formatAmount(
                  invoiceLineTotals.amountTotal,
                  dialog.invoice.currency,
                )}
              </div>
              <div>
                税額合計:{' '}
                {formatAmount(
                  invoiceLineTotals.taxTotal,
                  dialog.invoice.currency,
                )}
              </div>
              <div>
                明細合計:{' '}
                {formatAmount(
                  invoiceLineTotals.grossTotal,
                  dialog.invoice.currency,
                )}
              </div>
              <div>
                請求合計:{' '}
                {formatAmount(
                  dialog.invoice.totalAmount,
                  dialog.invoice.currency,
                )}
              </div>
              {invoiceLineTotals.diff != null && (
                <div
                  style={{
                    color:
                      Math.abs(invoiceLineTotals.diff) > 0.00001
                        ? '#dc2626'
                        : '#16a34a',
                  }}
                >
                  差分: {invoiceLineTotals.diff.toLocaleString()}{' '}
                  {dialog.invoice.currency}
                </div>
              )}
            </div>
            {invoiceLineTotals.diff != null &&
              Math.abs(invoiceLineTotals.diff) > 0.00001 && (
                <div
                  style={{
                    marginTop: 8,
                    color: '#dc2626',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    差分が残っています。数量/単価/税額を見直してください。
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => onOpenAllocation(dialog.invoice)}
                  >
                    配賦明細を開く
                  </Button>
                </div>
              )}
          </div>
        )}
        <input
          type="text"
          value={reason}
          onChange={(e) => onChangeReason(e.target.value)}
          placeholder={
            isReasonRequiredStatus(dialog.invoice.status)
              ? '変更理由（必須）'
              : '変更理由（任意）'
          }
        />
        {message && (
          <p
            style={{ color: message.type === 'error' ? '#dc2626' : '#16a34a' }}
          >
            {message.text}
          </p>
        )}
      </div>
    )}
  </Dialog>
);
