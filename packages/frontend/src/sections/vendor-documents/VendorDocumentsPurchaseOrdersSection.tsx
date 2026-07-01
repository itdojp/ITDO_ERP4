import React from 'react';
import { Button, CrudList, FilterBar, Input, Select, Toast } from '../../ui';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

type VendorOption = {
  id: string;
  code: string;
  name: string;
};

type PurchaseOrderForm = {
  projectId: string;
  vendorId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalAmount: number;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;

type VendorDocumentsPurchaseOrdersSectionProps = {
  active: boolean;
  poForm: PurchaseOrderForm;
  projects: ProjectOption[];
  vendors: VendorOption[];
  isPoSaving: boolean;
  onChangePoForm: (next: PurchaseOrderForm) => void;
  onCreatePurchaseOrder: () => void;
  poResult: MessageState;
  onDismissPoResult: () => void;
  onReloadPurchaseOrders: () => void;
  poSearch: string;
  onChangePoSearch: (value: string) => void;
  poStatusFilter: string;
  onChangePoStatusFilter: (value: string) => void;
  poStatusOptions: string[];
  onClearPoFilters: () => void;
  purchaseOrderListContent: React.ReactNode;
  normalizeCurrency: (value: string) => string;
};

export const VendorDocumentsPurchaseOrdersSection: React.FC<
  VendorDocumentsPurchaseOrdersSectionProps
> = ({
  active,
  poForm,
  projects,
  vendors,
  isPoSaving,
  onChangePoForm,
  onCreatePurchaseOrder,
  poResult,
  onDismissPoResult,
  onReloadPurchaseOrders,
  poSearch,
  onChangePoSearch,
  poStatusFilter,
  onChangePoStatusFilter,
  poStatusOptions,
  onClearPoFilters,
  purchaseOrderListContent,
  normalizeCurrency,
}) => (
  <section
    hidden={!active}
    style={{
      display: active ? 'block' : 'none',
    }}
  >
    <h3>発注書</h3>
    <p style={{ color: 'var(--color-text-muted, #475569)', marginTop: 0 }}>
      案件・業者・金額・発行/期限を揃えて、承認依頼や送信ログ確認の起点になる発注書を登録します。
    </p>
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        className="row workflow-control-grid"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <label>
          案件
          <select
            value={poForm.projectId}
            onChange={(e) =>
              onChangePoForm({ ...poForm, projectId: e.target.value })
            }
          >
            <option value="">案件を選択</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} / {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          業者
          <select
            value={poForm.vendorId}
            onChange={(e) =>
              onChangePoForm({ ...poForm, vendorId: e.target.value })
            }
          >
            <option value="">業者を選択</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.code} / {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          金額
          <input
            type="number"
            min={0}
            value={poForm.totalAmount}
            onChange={(e) =>
              onChangePoForm({
                ...poForm,
                totalAmount: Number(e.target.value),
              })
            }
            placeholder="金額"
            style={{ width: 120 }}
          />
        </label>
        <label>
          通貨
          <input
            type="text"
            value={poForm.currency}
            onChange={(e) =>
              onChangePoForm({
                ...poForm,
                currency: normalizeCurrency(e.target.value),
              })
            }
            placeholder="通貨"
            style={{ width: 80 }}
            maxLength={3}
          />
        </label>
        <label>
          発行日
          <input
            type="date"
            value={poForm.issueDate}
            onChange={(e) =>
              onChangePoForm({ ...poForm, issueDate: e.target.value })
            }
          />
        </label>
        <label>
          納期
          <input
            type="date"
            value={poForm.dueDate}
            onChange={(e) =>
              onChangePoForm({ ...poForm, dueDate: e.target.value })
            }
          />
        </label>
        <Button onClick={onCreatePurchaseOrder} disabled={isPoSaving}>
          {isPoSaving ? '登録中' : '登録'}
        </Button>
      </div>
    </div>
    {poResult && (
      <div style={{ marginBottom: 12 }}>
        <Toast
          variant={poResult.type}
          title={poResult.type === 'error' ? 'エラー' : '完了'}
          description={poResult.text}
          dismissible
          onClose={onDismissPoResult}
        />
      </div>
    )}
    <CrudList
      title="発注書一覧"
      description="発注書の検索・状態絞り込みと主要操作を実行できます。"
      filters={
        <FilterBar
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                onReloadPurchaseOrders();
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
              value={poSearch}
              onChange={(e) => onChangePoSearch(e.target.value)}
              placeholder="発注番号 / 案件 / 業者 / 請求番号で検索"
              aria-label="発注書検索"
            />
            <Select
              value={poStatusFilter}
              onChange={(e) => onChangePoStatusFilter(e.target.value)}
              aria-label="発注書状態フィルタ"
            >
              <option value="all">状態: 全て</option>
              {poStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
            {(poSearch || poStatusFilter !== 'all') && (
              <Button variant="ghost" onClick={onClearPoFilters}>
                条件クリア
              </Button>
            )}
          </div>
        </FilterBar>
      }
      table={purchaseOrderListContent}
    />
  </section>
);
