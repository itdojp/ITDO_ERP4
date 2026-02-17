import React from 'react';
import { Button, CrudList, FilterBar, Input, Select, Toast } from '../../ui';
import type {
  MessageState,
  ProjectOption,
  PurchaseOrder,
  VendorInvoiceForm,
  VendorOption,
} from './vendorDocumentsShared';

type VendorDocumentsVendorInvoicesSectionProps = {
  active: boolean;
  invoiceForm: VendorInvoiceForm;
  projects: ProjectOption[];
  vendors: VendorOption[];
  availablePurchaseOrders: PurchaseOrder[];
  missingNumberLabel: string;
  isInvoiceSaving: boolean;
  onChangeInvoiceForm: (next: VendorInvoiceForm) => void;
  onCreateVendorInvoice: () => void;
  invoiceResult: MessageState;
  onDismissInvoiceResult: () => void;
  invoiceSavedViewBar: React.ReactNode;
  onReloadVendorInvoices: () => void;
  invoiceSearch: string;
  onChangeInvoiceSearch: (value: string) => void;
  invoiceStatusFilter: string;
  onChangeInvoiceStatusFilter: (value: string) => void;
  invoiceStatusOptions: string[];
  onClearInvoiceFilters: () => void;
  vendorInvoiceListContent: React.ReactNode;
  normalizeCurrency: (value: string) => string;
};

export const VendorDocumentsVendorInvoicesSection: React.FC<
  VendorDocumentsVendorInvoicesSectionProps
> = ({
  active,
  invoiceForm,
  projects,
  vendors,
  availablePurchaseOrders,
  missingNumberLabel,
  isInvoiceSaving,
  onChangeInvoiceForm,
  onCreateVendorInvoice,
  invoiceResult,
  onDismissInvoiceResult,
  invoiceSavedViewBar,
  onReloadVendorInvoices,
  invoiceSearch,
  onChangeInvoiceSearch,
  invoiceStatusFilter,
  onChangeInvoiceStatusFilter,
  invoiceStatusOptions,
  onClearInvoiceFilters,
  vendorInvoiceListContent,
  normalizeCurrency,
}) => (
  <section
    hidden={!active}
    style={{
      display: active ? 'block' : 'none',
    }}
  >
    <h3>仕入請求</h3>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select
          value={invoiceForm.projectId}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
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
        <select
          value={invoiceForm.vendorId}
          onChange={(e) =>
            onChangeInvoiceForm({ ...invoiceForm, vendorId: e.target.value })
          }
        >
          <option value="">業者を選択</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.code} / {vendor.name}
            </option>
          ))}
        </select>
        <select
          value={invoiceForm.purchaseOrderId}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
              purchaseOrderId: e.target.value,
            })
          }
        >
          <option value="">関連発注書 (任意)</option>
          {availablePurchaseOrders.map((po) => (
            <option key={po.id} value={po.id}>
              {po.poNo || missingNumberLabel}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={invoiceForm.vendorInvoiceNo}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
              vendorInvoiceNo: e.target.value,
            })
          }
          placeholder="請求番号"
        />
        <input
          type="number"
          min={0}
          value={invoiceForm.totalAmount}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
              totalAmount: Number(e.target.value),
            })
          }
          placeholder="金額"
          style={{ width: 120 }}
        />
        <input
          type="text"
          value={invoiceForm.currency}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
              currency: normalizeCurrency(e.target.value),
            })
          }
          placeholder="通貨"
          style={{ width: 80 }}
          maxLength={3}
        />
        <input
          type="date"
          value={invoiceForm.receivedDate}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
              receivedDate: e.target.value,
            })
          }
        />
        <input
          type="date"
          value={invoiceForm.dueDate}
          onChange={(e) =>
            onChangeInvoiceForm({ ...invoiceForm, dueDate: e.target.value })
          }
        />
        <input
          type="text"
          value={invoiceForm.documentUrl}
          onChange={(e) =>
            onChangeInvoiceForm({
              ...invoiceForm,
              documentUrl: e.target.value,
            })
          }
          placeholder="書類URL"
          style={{ minWidth: 180 }}
        />
        <Button onClick={onCreateVendorInvoice} disabled={isInvoiceSaving}>
          {isInvoiceSaving ? '登録中' : '登録'}
        </Button>
      </div>
    </div>
    {invoiceResult && (
      <div style={{ marginBottom: 12 }}>
        <Toast
          variant={invoiceResult.type}
          title={invoiceResult.type === 'error' ? 'エラー' : '完了'}
          description={invoiceResult.text}
          dismissible
          onClose={onDismissInvoiceResult}
        />
      </div>
    )}
    {invoiceSavedViewBar}
    <CrudList
      title="仕入請求一覧"
      description="承認依頼・PO紐づけ・配賦明細編集・請求明細編集を一覧から実行できます。"
      filters={
        <FilterBar
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                onReloadVendorInvoices();
              }}
            >
              再取得
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
              value={invoiceSearch}
              onChange={(e) => onChangeInvoiceSearch(e.target.value)}
              placeholder="請求番号 / 案件 / 業者 / PO番号で検索"
              aria-label="仕入請求検索"
            />
            <Select
              value={invoiceStatusFilter}
              onChange={(e) => onChangeInvoiceStatusFilter(e.target.value)}
              aria-label="仕入請求状態フィルタ"
            >
              <option value="all">状態: 全て</option>
              {invoiceStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
            {(invoiceSearch || invoiceStatusFilter !== 'all') && (
              <Button variant="ghost" onClick={onClearInvoiceFilters}>
                条件クリア
              </Button>
            )}
          </div>
        </FilterBar>
      }
      table={vendorInvoiceListContent}
    />
  </section>
);
