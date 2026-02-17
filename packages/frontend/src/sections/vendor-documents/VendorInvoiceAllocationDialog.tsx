import React from 'react';
import { Button, Dialog, StatusBadge, erpStatusDictionary } from '../../ui';
import type {
  MessageState,
  ProjectOption,
  PurchaseOrderDetail,
  VendorInvoice,
  VendorInvoiceAllocation,
} from './vendorDocumentsShared';

type InvoiceAllocationDialogState = {
  invoice: VendorInvoice;
} | null;

type AllocationTotals = {
  amountTotal: number;
  taxTotal: number;
  grossTotal: number;
  invoiceTotal: number | null;
  diff: number | null;
};

type AllocationTaxRateSummaryEntry = {
  key: string;
  amount: number;
  tax: number;
};

type VendorInvoiceAllocationDialogProps = {
  open: boolean;
  dialog: InvoiceAllocationDialogState;
  saving: boolean;
  loading: boolean;
  expanded: boolean;
  allocations: VendorInvoiceAllocation[];
  projects: ProjectOption[];
  purchaseOrderDetails: Record<string, PurchaseOrderDetail>;
  missingNumberLabel: string;
  allocationTotals: AllocationTotals | null;
  allocationTaxRateSummary: AllocationTaxRateSummaryEntry[];
  reason: string;
  message: MessageState;
  onClose: () => void;
  onSave: () => void;
  onToggleExpanded: () => void;
  onAddRow: () => void;
  onUpdateAllocation: (
    index: number,
    update: Partial<VendorInvoiceAllocation>,
  ) => void;
  onRemoveAllocation: (index: number) => void;
  onChangeReason: (value: string) => void;
  renderProject: (projectId: string) => string;
  renderVendor: (vendorId: string) => string;
  formatAmount: (value: number | string, currency: string) => string;
  parseNumberValue: (
    value: number | string | null | undefined,
  ) => number | null;
  isPdfUrl: (value?: string | null) => boolean;
  isReasonRequiredStatus: (status: string) => boolean;
};

export const VendorInvoiceAllocationDialog = ({
  open,
  dialog,
  saving,
  loading,
  expanded,
  allocations,
  projects,
  purchaseOrderDetails,
  missingNumberLabel,
  allocationTotals,
  allocationTaxRateSummary,
  reason,
  message,
  onClose,
  onSave,
  onToggleExpanded,
  onAddRow,
  onUpdateAllocation,
  onRemoveAllocation,
  onChangeReason,
  renderProject,
  renderVendor,
  formatAmount,
  parseNumberValue,
  isPdfUrl,
  isReasonRequiredStatus,
}: VendorInvoiceAllocationDialogProps) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="仕入請求: 配賦明細"
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
                  title="vendor-invoice-pdf"
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
            {expanded ? '配賦明細を隠す' : '配賦明細を入力'}
          </Button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            配賦明細は必要時のみ入力（未入力でも保存可）
          </span>
        </div>
        {loading && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            配賦明細を読み込み中...
          </div>
        )}
        {expanded && !loading && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <button className="button secondary" onClick={onAddRow}>
                明細追加
              </button>
            </div>
            {allocations.length === 0 && (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                配賦明細は未入力です
              </div>
            )}
            {allocations.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>案件</th>
                      <th>金額</th>
                      <th>税率</th>
                      <th>税額</th>
                      {dialog.invoice.purchaseOrderId && <th>PO明細</th>}
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((entry, index) => {
                      const amountValue = parseNumberValue(entry.amount);
                      const taxRateValue = parseNumberValue(entry.taxRate);
                      const computedTax =
                        amountValue != null && taxRateValue != null
                          ? Math.round((amountValue * taxRateValue) / 100)
                          : null;
                      const poDetail = dialog.invoice.purchaseOrderId
                        ? purchaseOrderDetails[dialog.invoice.purchaseOrderId]
                        : null;
                      return (
                        <tr key={`alloc-${index}`}>
                          <td>
                            <select
                              value={entry.projectId}
                              onChange={(e) =>
                                onUpdateAllocation(index, {
                                  projectId: e.target.value,
                                })
                              }
                            >
                              <option value="">案件を選択</option>
                              {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.code} / {project.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={entry.amount}
                              onChange={(e) =>
                                onUpdateAllocation(index, {
                                  amount: e.target.value,
                                })
                              }
                              style={{ width: 120 }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={entry.taxRate ?? ''}
                              onChange={(e) =>
                                onUpdateAllocation(index, {
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
                                onUpdateAllocation(index, {
                                  taxAmount: e.target.value,
                                })
                              }
                              style={{ width: 120 }}
                            />
                            {computedTax != null && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#94a3b8',
                                }}
                              >
                                自動計算: {computedTax}
                              </div>
                            )}
                          </td>
                          {dialog.invoice.purchaseOrderId && (
                            <td>
                              <select
                                value={entry.purchaseOrderLineId ?? ''}
                                onChange={(e) =>
                                  onUpdateAllocation(index, {
                                    purchaseOrderLineId: e.target.value,
                                  })
                                }
                              >
                                <option value="">紐づけなし</option>
                                {(poDetail?.lines || []).map((line) => (
                                  <option key={line.id} value={line.id}>
                                    {line.description} / {line.quantity} x{' '}
                                    {line.unitPrice}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td>
                            <button
                              className="button secondary"
                              onClick={() => onRemoveAllocation(index)}
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
        {allocationTotals && (
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
                  allocationTotals.amountTotal,
                  dialog.invoice.currency,
                )}
              </div>
              <div>
                税額合計:{' '}
                {formatAmount(
                  allocationTotals.taxTotal,
                  dialog.invoice.currency,
                )}
              </div>
              <div>
                配賦合計:{' '}
                {formatAmount(
                  allocationTotals.grossTotal,
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
              {allocationTotals.diff != null && (
                <div
                  style={{
                    color:
                      Math.abs(allocationTotals.diff) > 0.00001
                        ? '#dc2626'
                        : '#16a34a',
                  }}
                >
                  差分: {allocationTotals.diff.toLocaleString()}{' '}
                  {dialog.invoice.currency}
                </div>
              )}
            </div>
            {allocationTaxRateSummary.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: '#64748b' }}>税率別合計</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {allocationTaxRateSummary.map((entry) => (
                    <div key={entry.key}>
                      {entry.key}:{' '}
                      {formatAmount(
                        entry.amount + entry.tax,
                        dialog.invoice.currency,
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {allocationTotals.diff != null &&
              Math.abs(allocationTotals.diff) > 0.00001 && (
                <div style={{ marginTop: 8, color: '#dc2626' }}>
                  差分が解消できない場合は理由を添えて管理者へエスカレーションしてください
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
