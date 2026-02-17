import React from 'react';
import { Button, Dialog, StatusBadge, erpStatusDictionary } from '../../ui';
import type {
  MessageState,
  PurchaseOrder,
  PurchaseOrderDetail,
  VendorInvoice,
} from './vendorDocumentsShared';

type InvoicePoLinkDialogState = {
  invoice: VendorInvoice;
  purchaseOrderId: string;
  reasonText: string;
} | null;

type VendorInvoicePoLinkDialogProps = {
  open: boolean;
  dialog: InvoicePoLinkDialogState;
  busy: boolean;
  result: MessageState;
  missingNumberLabel: string;
  availablePurchaseOrders: PurchaseOrder[];
  selectedPurchaseOrderId: string | undefined;
  selectedPurchaseOrder: PurchaseOrderDetail | null;
  purchaseOrderDetailLoading: boolean;
  purchaseOrderDetailMessage: string;
  onClose: () => void;
  onSave: () => void;
  onChangePurchaseOrderId: (purchaseOrderId: string) => void;
  onChangeReasonText: (reasonText: string) => void;
  renderProject: (projectId: string) => string;
  renderVendor: (vendorId: string) => string;
  isReasonRequiredStatus: (status: string) => boolean;
  parseNumberValue: (
    value: number | string | null | undefined,
  ) => number | null;
  formatAmount: (value: number | string, currency: string) => string;
};

export const VendorInvoicePoLinkDialog = ({
  open,
  dialog,
  busy,
  result,
  missingNumberLabel,
  availablePurchaseOrders,
  selectedPurchaseOrderId,
  selectedPurchaseOrder,
  purchaseOrderDetailLoading,
  purchaseOrderDetailMessage,
  onClose,
  onSave,
  onChangePurchaseOrderId,
  onChangeReasonText,
  renderProject,
  renderVendor,
  isReasonRequiredStatus,
  parseNumberValue,
  formatAmount,
}: VendorInvoicePoLinkDialogProps) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="仕入請求: 関連発注書（PO）"
    size="large"
    footer={
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          閉じる
        </Button>
        <Button onClick={onSave} disabled={busy}>
          {busy ? '更新中' : '更新'}
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
        </div>
        <select
          value={dialog.purchaseOrderId}
          onChange={(e) => onChangePurchaseOrderId(e.target.value)}
        >
          <option value="">紐づけなし</option>
          {availablePurchaseOrders.map((po) => (
            <option key={po.id} value={po.id}>
              {po.poNo || missingNumberLabel}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={dialog.reasonText}
          onChange={(e) => onChangeReasonText(e.target.value)}
          placeholder={
            isReasonRequiredStatus(dialog.invoice.status)
              ? '変更理由（必須）'
              : '変更理由（任意）'
          }
        />
        {selectedPurchaseOrderId && (
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              background: '#f8fafc',
            }}
          >
            {purchaseOrderDetailLoading && (
              <div style={{ fontSize: 12, color: '#64748b' }}>
                発注書明細を読み込み中...
              </div>
            )}
            {!purchaseOrderDetailLoading && purchaseOrderDetailMessage && (
              <div style={{ fontSize: 12, color: '#dc2626' }}>
                {purchaseOrderDetailMessage}
              </div>
            )}
            {!purchaseOrderDetailLoading && selectedPurchaseOrder && (
              <>
                {(() => {
                  const poCurrency = selectedPurchaseOrder.currency;
                  const viCurrency = dialog.invoice.currency;
                  const sameCurrency = viCurrency === poCurrency;
                  const poTotal = parseNumberValue(
                    selectedPurchaseOrder.totalAmount,
                  );
                  const viTotal = parseNumberValue(dialog.invoice.totalAmount);
                  const diff =
                    sameCurrency && poTotal !== null && viTotal !== null
                      ? viTotal - poTotal
                      : null;
                  const hasDiff = diff !== null && Math.abs(diff) > 0.00001;

                  return (
                    <div
                      className="row"
                      style={{ gap: 12, flexWrap: 'wrap', fontSize: 12 }}
                    >
                      <div style={{ color: '#64748b' }}>
                        PO合計:{' '}
                        {formatAmount(
                          selectedPurchaseOrder.totalAmount,
                          poCurrency,
                        )}
                      </div>
                      <div style={{ color: '#64748b' }}>
                        仕入請求合計:{' '}
                        {formatAmount(dialog.invoice.totalAmount, viCurrency)}
                      </div>
                      {!sameCurrency && (
                        <div style={{ color: '#dc2626' }}>
                          通貨が異なるため合計差分は算出しません
                        </div>
                      )}
                      {hasDiff && (
                        <div style={{ color: '#dc2626' }}>
                          合計差分: {formatAmount(diff, viCurrency)}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    発注書明細（read-only）
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        marginTop: 6,
                        fontSize: 12,
                      }}
                    >
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: 6 }}>
                            内容
                          </th>
                          <th style={{ textAlign: 'right', padding: 6 }}>
                            数量
                          </th>
                          <th style={{ textAlign: 'right', padding: 6 }}>
                            単価
                          </th>
                          <th style={{ textAlign: 'right', padding: 6 }}>
                            小計
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedPurchaseOrder.lines ?? []).map((line) => {
                          const qty = parseNumberValue(line.quantity);
                          const unit = parseNumberValue(line.unitPrice);
                          const lineTotal =
                            qty !== null && unit !== null ? qty * unit : null;
                          return (
                            <tr key={line.id}>
                              <td style={{ padding: 6 }}>{line.description}</td>
                              <td style={{ padding: 6, textAlign: 'right' }}>
                                {String(line.quantity)}
                              </td>
                              <td style={{ padding: 6, textAlign: 'right' }}>
                                {formatAmount(
                                  line.unitPrice,
                                  selectedPurchaseOrder.currency,
                                )}
                              </td>
                              <td style={{ padding: 6, textAlign: 'right' }}>
                                {lineTotal === null
                                  ? '-'
                                  : formatAmount(
                                      lineTotal,
                                      selectedPurchaseOrder.currency,
                                    )}
                              </td>
                            </tr>
                          );
                        })}
                        {(selectedPurchaseOrder.lines ?? []).length === 0 && (
                          <tr>
                            <td
                              colSpan={4}
                              style={{ padding: 6, color: '#64748b' }}
                            >
                              明細なし
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {result && (
          <p
            style={{
              color: result.type === 'error' ? '#dc2626' : '#16a34a',
              margin: 0,
            }}
          >
            {result.text}
          </p>
        )}
      </div>
    )}
  </Dialog>
);
