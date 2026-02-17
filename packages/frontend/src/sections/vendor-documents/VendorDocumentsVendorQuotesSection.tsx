import React from 'react';
import { Button, CrudList, FilterBar, Input, Select, Toast } from '../../ui';
import type {
  MessageState,
  ProjectOption,
  VendorOption,
  VendorQuoteForm,
} from './vendorDocumentsShared';

type VendorDocumentsVendorQuotesSectionProps = {
  active: boolean;
  quoteForm: VendorQuoteForm;
  projects: ProjectOption[];
  vendors: VendorOption[];
  isQuoteSaving: boolean;
  onChangeQuoteForm: (next: VendorQuoteForm) => void;
  onCreateVendorQuote: () => void;
  quoteResult: MessageState;
  onDismissQuoteResult: () => void;
  onReloadVendorQuotes: () => void;
  quoteSearch: string;
  onChangeQuoteSearch: (value: string) => void;
  quoteStatusFilter: string;
  onChangeQuoteStatusFilter: (value: string) => void;
  quoteStatusOptions: string[];
  onClearQuoteFilters: () => void;
  vendorQuoteListContent: React.ReactNode;
  normalizeCurrency: (value: string) => string;
};

export const VendorDocumentsVendorQuotesSection: React.FC<
  VendorDocumentsVendorQuotesSectionProps
> = ({
  active,
  quoteForm,
  projects,
  vendors,
  isQuoteSaving,
  onChangeQuoteForm,
  onCreateVendorQuote,
  quoteResult,
  onDismissQuoteResult,
  onReloadVendorQuotes,
  quoteSearch,
  onChangeQuoteSearch,
  quoteStatusFilter,
  onChangeQuoteStatusFilter,
  quoteStatusOptions,
  onClearQuoteFilters,
  vendorQuoteListContent,
  normalizeCurrency,
}) => (
  <section
    hidden={!active}
    style={{
      display: active ? 'block' : 'none',
    }}
  >
    <h3>仕入見積</h3>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select
          value={quoteForm.projectId}
          onChange={(e) =>
            onChangeQuoteForm({ ...quoteForm, projectId: e.target.value })
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
          value={quoteForm.vendorId}
          onChange={(e) =>
            onChangeQuoteForm({ ...quoteForm, vendorId: e.target.value })
          }
        >
          <option value="">業者を選択</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.code} / {vendor.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={quoteForm.quoteNo}
          onChange={(e) =>
            onChangeQuoteForm({ ...quoteForm, quoteNo: e.target.value })
          }
          placeholder="見積番号"
        />
        <input
          type="number"
          min={0}
          value={quoteForm.totalAmount}
          onChange={(e) =>
            onChangeQuoteForm({
              ...quoteForm,
              totalAmount: Number(e.target.value),
            })
          }
          placeholder="金額"
          style={{ width: 120 }}
        />
        <input
          type="text"
          value={quoteForm.currency}
          onChange={(e) =>
            onChangeQuoteForm({
              ...quoteForm,
              currency: normalizeCurrency(e.target.value),
            })
          }
          placeholder="通貨"
          style={{ width: 80 }}
          maxLength={3}
        />
        <input
          type="date"
          value={quoteForm.issueDate}
          onChange={(e) =>
            onChangeQuoteForm({ ...quoteForm, issueDate: e.target.value })
          }
        />
        <input
          type="text"
          value={quoteForm.documentUrl}
          onChange={(e) =>
            onChangeQuoteForm({ ...quoteForm, documentUrl: e.target.value })
          }
          placeholder="書類URL"
          style={{ minWidth: 180 }}
        />
        <Button onClick={onCreateVendorQuote} disabled={isQuoteSaving}>
          {isQuoteSaving ? '登録中' : '登録'}
        </Button>
      </div>
    </div>
    {quoteResult && (
      <div style={{ marginBottom: 12 }}>
        <Toast
          variant={quoteResult.type}
          title={quoteResult.type === 'error' ? 'エラー' : '完了'}
          description={quoteResult.text}
          dismissible
          onClose={onDismissQuoteResult}
        />
      </div>
    )}
    <CrudList
      title="仕入見積一覧"
      description="仕入見積の検索と注釈登録を実行できます。"
      filters={
        <FilterBar
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                onReloadVendorQuotes();
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
              value={quoteSearch}
              onChange={(e) => onChangeQuoteSearch(e.target.value)}
              placeholder="見積番号 / 案件 / 業者 / 金額で検索"
              aria-label="仕入見積検索"
            />
            <Select
              value={quoteStatusFilter}
              onChange={(e) => onChangeQuoteStatusFilter(e.target.value)}
              aria-label="仕入見積状態フィルタ"
            >
              <option value="all">状態: 全て</option>
              {quoteStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
            {(quoteSearch || quoteStatusFilter !== 'all') && (
              <Button variant="ghost" onClick={onClearQuoteFilters}>
                条件クリア
              </Button>
            )}
          </div>
        </FilterBar>
      }
      table={vendorQuoteListContent}
    />
  </section>
);
