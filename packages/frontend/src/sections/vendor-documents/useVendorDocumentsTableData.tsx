import React, { useMemo } from 'react';
import { StatusBadge, erpStatusDictionary } from '../../ui';
import type { DataTableColumn, DataTableRow } from '../../ui';
import {
  formatAmount,
  formatDate,
  type PurchaseOrder,
  type VendorInvoice,
  type VendorQuote,
} from './vendorDocumentsShared';

type UseVendorDocumentsTableDataParams = {
  purchaseOrders: PurchaseOrder[];
  vendorQuotes: VendorQuote[];
  vendorInvoices: VendorInvoice[];
  vendorInvoicesByPurchaseOrderId: Map<string, VendorInvoice[]>;
  poSearch: string;
  poStatusFilter: string;
  quoteSearch: string;
  quoteStatusFilter: string;
  invoiceSearch: string;
  invoiceStatusFilter: string;
  missingNumberLabel: string;
  renderProject: (projectId: string) => string;
  renderVendor: (vendorId: string) => string;
};

export function useVendorDocumentsTableData(
  params: UseVendorDocumentsTableDataParams,
) {
  const {
    purchaseOrders,
    vendorQuotes,
    vendorInvoices,
    vendorInvoicesByPurchaseOrderId,
    poSearch,
    poStatusFilter,
    quoteSearch,
    quoteStatusFilter,
    invoiceSearch,
    invoiceStatusFilter,
    missingNumberLabel,
    renderProject,
    renderVendor,
  } = params;
  const purchaseOrderMap = useMemo(
    () => new Map(purchaseOrders.map((item) => [item.id, item])),
    [purchaseOrders],
  );
  const vendorQuoteMap = useMemo(
    () => new Map(vendorQuotes.map((item) => [item.id, item])),
    [vendorQuotes],
  );
  const vendorInvoiceMap = useMemo(
    () => new Map(vendorInvoices.map((item) => [item.id, item])),
    [vendorInvoices],
  );

  const poStatusOptions = useMemo(
    () =>
      Array.from(new Set(purchaseOrders.map((item) => item.status)))
        .filter(Boolean)
        .sort(),
    [purchaseOrders],
  );
  const quoteStatusOptions = useMemo(
    () =>
      Array.from(new Set(vendorQuotes.map((item) => item.status)))
        .filter(Boolean)
        .sort(),
    [vendorQuotes],
  );
  const invoiceStatusOptions = useMemo(
    () =>
      Array.from(new Set(vendorInvoices.map((item) => item.status)))
        .filter(Boolean)
        .sort(),
    [vendorInvoices],
  );

  const filteredPurchaseOrders = useMemo(() => {
    const needle = poSearch.trim().toLowerCase();
    return purchaseOrders.filter((item) => {
      if (
        poStatusFilter !== 'all' &&
        item.status !== poStatusFilter
      ) {
        return false;
      }
      if (!needle) return true;
      const linkedInvoices =
        vendorInvoicesByPurchaseOrderId.get(item.id) || [];
      const target = [
        item.poNo || missingNumberLabel,
        item.status,
        renderProject(item.projectId),
        renderVendor(item.vendorId),
        `${item.totalAmount}`,
        linkedInvoices.map((invoice) => invoice.vendorInvoiceNo || '').join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return target.includes(needle);
    });
  }, [
    missingNumberLabel,
    poSearch,
    poStatusFilter,
    purchaseOrders,
    renderProject,
    renderVendor,
    vendorInvoicesByPurchaseOrderId,
  ]);

  const filteredVendorQuotes = useMemo(() => {
    const needle = quoteSearch.trim().toLowerCase();
    return vendorQuotes.filter((item) => {
      if (
        quoteStatusFilter !== 'all' &&
        item.status !== quoteStatusFilter
      ) {
        return false;
      }
      if (!needle) return true;
      const target = [
        item.quoteNo || missingNumberLabel,
        item.status,
        renderProject(item.projectId),
        renderVendor(item.vendorId),
        `${item.totalAmount}`,
      ]
        .join(' ')
        .toLowerCase();
      return target.includes(needle);
    });
  }, [
    missingNumberLabel,
    quoteSearch,
    quoteStatusFilter,
    renderProject,
    renderVendor,
    vendorQuotes,
  ]);

  const filteredVendorInvoices = useMemo(() => {
    const needle = invoiceSearch.trim().toLowerCase();
    return vendorInvoices.filter((item) => {
      if (
        invoiceStatusFilter !== 'all' &&
        item.status !== invoiceStatusFilter
      ) {
        return false;
      }
      if (!needle) return true;
      const target = [
        item.vendorInvoiceNo || missingNumberLabel,
        item.status,
        renderProject(item.projectId),
        renderVendor(item.vendorId),
        `${item.totalAmount}`,
        item.purchaseOrder?.poNo || item.purchaseOrderId || '',
      ]
        .join(' ')
        .toLowerCase();
      return target.includes(needle);
    });
  }, [
    invoiceSearch,
    invoiceStatusFilter,
    missingNumberLabel,
    renderProject,
    renderVendor,
    vendorInvoices,
  ]);

  const purchaseOrderRows = useMemo<DataTableRow[]>(
    () =>
      filteredPurchaseOrders.map((item) => {
        const linkedInvoices =
          vendorInvoicesByPurchaseOrderId.get(item.id) || [];
        const shownLinkedInvoiceLabels = linkedInvoices
          .slice(0, 3)
          .map((invoice) => invoice.vendorInvoiceNo || missingNumberLabel);
        const remainingLinkedInvoiceCount =
          linkedInvoices.length - shownLinkedInvoiceLabels.length;
        const linkedSummary =
          linkedInvoices.length === 0
            ? '-'
            : `${linkedInvoices.length}件 (${shownLinkedInvoiceLabels.join(', ')}${
                remainingLinkedInvoiceCount > 0
                  ? ` 他${remainingLinkedInvoiceCount}件`
                  : ''
              })`;

        return {
          id: item.id,
          status: item.status,
          poNo: item.poNo || missingNumberLabel,
          project: renderProject(item.projectId),
          vendor: renderVendor(item.vendorId),
          totalAmount: formatAmount(item.totalAmount, item.currency),
          schedule: `発行 ${formatDate(item.issueDate)} / 納期 ${formatDate(
            item.dueDate,
          )}`,
          linkedInvoices: linkedSummary,
        };
      }),
    [
      filteredPurchaseOrders,
      missingNumberLabel,
      renderProject,
      renderVendor,
      vendorInvoicesByPurchaseOrderId,
    ],
  );

  const vendorQuoteRows = useMemo<DataTableRow[]>(
    () =>
      filteredVendorQuotes.map((item) => ({
        id: item.id,
        status: item.status,
        quoteNo: item.quoteNo || missingNumberLabel,
        project: renderProject(item.projectId),
        vendor: renderVendor(item.vendorId),
        totalAmount: formatAmount(item.totalAmount, item.currency),
        issueDate: formatDate(item.issueDate),
      })),
    [
      filteredVendorQuotes,
      missingNumberLabel,
      renderProject,
      renderVendor,
    ],
  );

  const vendorInvoiceRows = useMemo<DataTableRow[]>(
    () =>
      filteredVendorInvoices.map((item) => ({
        id: item.id,
        status: item.status,
        vendorInvoiceNo: item.vendorInvoiceNo || missingNumberLabel,
        project: renderProject(item.projectId),
        vendor: renderVendor(item.vendorId),
        totalAmount: formatAmount(item.totalAmount, item.currency),
        schedule: `受領 ${formatDate(item.receivedDate)} / 期限 ${formatDate(
          item.dueDate,
        )}`,
        purchaseOrder: item.purchaseOrder?.poNo || item.purchaseOrderId || '-',
      })),
    [
      filteredVendorInvoices,
      missingNumberLabel,
      renderProject,
      renderVendor,
    ],
  );

  const purchaseOrderColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'poNo', header: '発注番号' },
      { key: 'project', header: '案件' },
      { key: 'vendor', header: '業者' },
      {
        key: 'status',
        header: '状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.status || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      { key: 'totalAmount', header: '金額', align: 'right' },
      { key: 'schedule', header: '日付' },
      { key: 'linkedInvoices', header: 'リンク済み仕入請求' },
    ],
    [],
  );

  const vendorQuoteColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'quoteNo', header: '見積番号' },
      { key: 'project', header: '案件' },
      { key: 'vendor', header: '業者' },
      {
        key: 'status',
        header: '状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.status || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      { key: 'totalAmount', header: '金額', align: 'right' },
      { key: 'issueDate', header: '発行日' },
    ],
    [],
  );

  const vendorInvoiceColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'vendorInvoiceNo', header: '請求番号' },
      { key: 'project', header: '案件' },
      { key: 'vendor', header: '業者' },
      {
        key: 'status',
        header: '状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.status || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      { key: 'totalAmount', header: '金額', align: 'right' },
      { key: 'schedule', header: '受領/期限' },
      { key: 'purchaseOrder', header: '関連PO' },
    ],
    [],
  );

  return {
    purchaseOrderMap,
    vendorQuoteMap,
    vendorInvoiceMap,
    poStatusOptions,
    quoteStatusOptions,
    invoiceStatusOptions,
    purchaseOrderRows,
    vendorQuoteRows,
    vendorInvoiceRows,
    purchaseOrderColumns,
    vendorQuoteColumns,
    vendorInvoiceColumns,
  };
}
