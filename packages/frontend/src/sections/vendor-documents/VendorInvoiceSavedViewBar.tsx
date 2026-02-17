import React from 'react';
import { SavedViewBar } from '../../ui';
import type { UseSavedViewsResult } from '../../ui';
import type { InvoiceSavedFilterPayload } from './vendorDocumentsShared';

type VendorInvoiceSavedViewBarProps = {
  savedViews: UseSavedViewsResult<InvoiceSavedFilterPayload>;
  invoiceSearch: string;
  invoiceStatusFilter: string;
  invoiceStatusOptions: string[];
  onChangeInvoiceSearch: (value: string) => void;
  onChangeInvoiceStatusFilter: (value: string) => void;
  normalizeInvoiceStatusFilter: (value: string, options: string[]) => string;
};

export const VendorInvoiceSavedViewBar: React.FC<
  VendorInvoiceSavedViewBarProps
> = ({
  savedViews,
  invoiceSearch,
  invoiceStatusFilter,
  invoiceStatusOptions,
  onChangeInvoiceSearch,
  onChangeInvoiceStatusFilter,
  normalizeInvoiceStatusFilter,
}) => (
  <SavedViewBar
    views={savedViews.views}
    activeViewId={savedViews.activeViewId}
    onSelectView={(viewId) => {
      savedViews.selectView(viewId);
      const selected = savedViews.views.find((view) => view.id === viewId);
      if (!selected) return;
      onChangeInvoiceSearch(selected.payload.search);
      onChangeInvoiceStatusFilter(
        normalizeInvoiceStatusFilter(
          selected.payload.status,
          invoiceStatusOptions,
        ),
      );
    }}
    onSaveAs={(name) => {
      const normalizedStatus = normalizeInvoiceStatusFilter(
        invoiceStatusFilter,
        invoiceStatusOptions,
      );
      savedViews.createView(name, {
        search: invoiceSearch,
        status: normalizedStatus,
      });
    }}
    onUpdateView={(viewId) => {
      const normalizedStatus = normalizeInvoiceStatusFilter(
        invoiceStatusFilter,
        invoiceStatusOptions,
      );
      savedViews.updateView(viewId, {
        payload: {
          search: invoiceSearch,
          status: normalizedStatus,
        },
      });
    }}
    onDuplicateView={(viewId) => {
      savedViews.duplicateView(viewId);
    }}
    onShareView={(viewId) => {
      savedViews.toggleShared(viewId, true);
    }}
    onDeleteView={(viewId) => {
      savedViews.deleteView(viewId);
    }}
    labels={{
      title: '仕入請求フィルタ保存',
      saveAsPlaceholder: 'ビュー名',
      saveAsButton: '保存',
      update: '更新',
      duplicate: '複製',
      share: '共有',
      delete: '削除',
      active: '現在のビュー',
    }}
  />
);
