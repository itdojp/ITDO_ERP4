import React, { useCallback, useEffect, useState } from 'react';
import { api, apiResponse } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import {
  Alert,
  AsyncStatePanel,
  Button,
  ConfirmActionDialog,
  CrudList,
  DataTable,
  Dialog,
  FilterBar,
  Input,
  Select,
  Tabs,
  Toast,
} from '../ui';
import { formatDateForFilename, openResponseInNewTab } from '../utils/download';
import { PurchaseOrderSendLogsDialog } from './vendor-documents/PurchaseOrderSendLogsDialog';
import { VendorInvoiceAllocationDialog } from './vendor-documents/VendorInvoiceAllocationDialog';
import { VendorDocumentsPurchaseOrdersSection } from './vendor-documents/VendorDocumentsPurchaseOrdersSection';
import { VendorDocumentsVendorQuotesSection } from './vendor-documents/VendorDocumentsVendorQuotesSection';
import { VendorDocumentsVendorInvoicesSection } from './vendor-documents/VendorDocumentsVendorInvoicesSection';
import { VendorInvoiceLineDialog } from './vendor-documents/VendorInvoiceLineDialog';
import { VendorInvoicePoLinkDialog } from './vendor-documents/VendorInvoicePoLinkDialog';
import { VendorInvoiceSavedViewBar } from './vendor-documents/VendorInvoiceSavedViewBar';
import { useVendorInvoiceSavedViews } from './vendor-documents/useVendorInvoiceSavedViews';
import { useVendorDocumentsLookups } from './vendor-documents/useVendorDocumentsLookups';
import { useVendorDocumentsTableData } from './vendor-documents/useVendorDocumentsTableData';
import { useVendorInvoiceDialogs } from './vendor-documents/useVendorInvoiceDialogs';
import {
  defaultPurchaseOrderForm,
  defaultVendorInvoiceForm,
  defaultVendorQuoteForm,
  documentTabIds,
  formatAmount,
  isDocumentTabId,
  isPdfUrl,
  normalizeInvoiceStatusFilter,
  parseNumberValue,
} from './vendor-documents/vendorDocumentsShared';
import type {
  DocumentSendLog,
  DocumentTabId,
  ListStatus,
  MessageState,
  ProjectOption,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderForm,
  VendorInvoice,
  VendorInvoiceForm,
  VendorOption,
  VendorQuote,
  VendorQuoteForm,
} from './vendor-documents/vendorDocumentsShared';

export const VendorDocuments: React.FC = () => {
  const [annotationTarget, setAnnotationTarget] = useState<{
    kind: 'purchase_order' | 'vendor_quote' | 'vendor_invoice';
    id: string;
    projectId: string;
    title: string;
  } | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendorQuotes, setVendorQuotes] = useState<VendorQuote[]>([]);
  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoice[]>([]);
  const [projectMessage, setProjectMessage] = useState('');
  const [vendorMessage, setVendorMessage] = useState('');
  const [poListStatus, setPoListStatus] = useState<ListStatus>('idle');
  const [poListError, setPoListError] = useState('');
  const [quoteListStatus, setQuoteListStatus] = useState<ListStatus>('idle');
  const [quoteListError, setQuoteListError] = useState('');
  const [invoiceListStatus, setInvoiceListStatus] =
    useState<ListStatus>('idle');
  const [invoiceListError, setInvoiceListError] = useState('');
  const [poSearch, setPoSearch] = useState('');
  const [poStatusFilter, setPoStatusFilter] = useState('all');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [quoteStatusFilter, setQuoteStatusFilter] = useState('all');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');
  const [activeDocumentTab, setActiveDocumentTab] =
    useState<DocumentTabId>('purchase-orders');
  const [poResult, setPoResult] = useState<MessageState>(null);
  const [quoteResult, setQuoteResult] = useState<MessageState>(null);
  const [invoiceResult, setInvoiceResult] = useState<MessageState>(null);
  const [poForm, setPoForm] = useState<PurchaseOrderForm>(
    defaultPurchaseOrderForm,
  );
  const [quoteForm, setQuoteForm] = useState<VendorQuoteForm>(
    defaultVendorQuoteForm,
  );
  const [invoiceForm, setInvoiceForm] = useState<VendorInvoiceForm>(
    defaultVendorInvoiceForm,
  );
  const [isPoSaving, setIsPoSaving] = useState(false);
  const [isQuoteSaving, setIsQuoteSaving] = useState(false);
  const [isInvoiceSaving, setIsInvoiceSaving] = useState(false);
  const [poSendLogs, setPoSendLogs] = useState<
    Record<string, DocumentSendLog[]>
  >({});
  const [poSendLogMessage, setPoSendLogMessage] = useState<
    Record<string, string>
  >({});
  const [poSendLogLoading, setPoSendLogLoading] = useState<
    Record<string, boolean>
  >({});
  const [poSubmitBusy, setPoSubmitBusy] = useState<Record<string, boolean>>({});
  const [poSendLogDialogId, setPoSendLogDialogId] = useState<string | null>(
    null,
  );
  const [invoicePoLinkDialog, setInvoicePoLinkDialog] = useState<{
    invoice: VendorInvoice;
    purchaseOrderId: string;
    reasonText: string;
  } | null>(null);
  const [invoicePoLinkBusy, setInvoicePoLinkBusy] = useState(false);
  const [invoicePoLinkResult, setInvoicePoLinkResult] =
    useState<MessageState>(null);
  const invoiceSavedViews = useVendorInvoiceSavedViews();
  const [invoiceSubmitBusy, setInvoiceSubmitBusy] = useState<
    Record<string, boolean>
  >({});
  const [purchaseOrderDetails, setPurchaseOrderDetails] = useState<
    Record<string, PurchaseOrderDetail>
  >({});
  const [purchaseOrderDetailLoading, setPurchaseOrderDetailLoading] =
    useState(false);
  const [purchaseOrderDetailMessage, setPurchaseOrderDetailMessage] =
    useState('');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'po-submit' | 'invoice-submit';
    id: string;
    numberLabel: string;
  } | null>(null);
  const {
    availablePurchaseOrders,
    availablePurchaseOrdersForInvoicePoLink,
    selectedPurchaseOrderId,
    selectedPurchaseOrder,
    vendorInvoicesByPurchaseOrderId,
    renderProject,
    renderVendor,
  } = useVendorDocumentsLookups({
    projects,
    vendors,
    purchaseOrders,
    vendorInvoices,
    invoiceForm,
    invoicePoLinkDialog,
    purchaseOrderDetails,
  });

  const loadPurchaseOrderDetail = useCallback(
    async (purchaseOrderId: string, signal?: AbortSignal) => {
      if (!purchaseOrderId) return;
      if (purchaseOrderDetails[purchaseOrderId]) {
        setPurchaseOrderDetailMessage('');
        return;
      }
      setPurchaseOrderDetailLoading(true);
      setPurchaseOrderDetailMessage('');
      try {
        const po = await api<PurchaseOrderDetail>(
          `/purchase-orders/${purchaseOrderId}`,
          { signal },
        );
        setPurchaseOrderDetails((prev) => ({ ...prev, [po.id]: po }));
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        console.error('Failed to load purchase order details.', err);
        setPurchaseOrderDetailMessage('発注書明細の取得に失敗しました');
      } finally {
        setPurchaseOrderDetailLoading(false);
      }
    },
    [purchaseOrderDetails],
  );

  useEffect(() => {
    if (!selectedPurchaseOrderId) {
      setPurchaseOrderDetailLoading(false);
      setPurchaseOrderDetailMessage('');
      return;
    }
    const controller = new AbortController();
    void loadPurchaseOrderDetail(selectedPurchaseOrderId, controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadPurchaseOrderDetail, selectedPurchaseOrderId]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: ProjectOption[] }>('/projects');
      setProjects(res.items || []);
      setProjectMessage('');
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setProjectMessage('案件一覧の取得に失敗しました');
    }
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      const res = await api<{ items: VendorOption[] }>('/vendors');
      setVendors(res.items || []);
      setVendorMessage('');
    } catch (err) {
      console.error('Failed to load vendors.', err);
      setVendors([]);
      setVendorMessage('業者一覧の取得に失敗しました');
    }
  }, []);

  const loadPurchaseOrders = useCallback(async () => {
    setPoListStatus('loading');
    setPoListError('');
    try {
      const res = await api<{ items: PurchaseOrder[] }>('/purchase-orders');
      setPurchaseOrders(res.items || []);
      setPoListStatus('success');
    } catch (err) {
      console.error('Failed to load purchase orders.', err);
      setPurchaseOrders([]);
      setPoListStatus('error');
      setPoListError('発注書一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorQuotes = useCallback(async () => {
    setQuoteListStatus('loading');
    setQuoteListError('');
    try {
      const res = await api<{ items: VendorQuote[] }>('/vendor-quotes');
      setVendorQuotes(res.items || []);
      setQuoteListStatus('success');
    } catch (err) {
      console.error('Failed to load vendor quotes.', err);
      setVendorQuotes([]);
      setQuoteListStatus('error');
      setQuoteListError('仕入見積一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorInvoices = useCallback(async () => {
    setInvoiceListStatus('loading');
    setInvoiceListError('');
    try {
      const res = await api<{ items: VendorInvoice[] }>('/vendor-invoices');
      setVendorInvoices(res.items || []);
      setInvoiceListStatus('success');
    } catch (err) {
      console.error('Failed to load vendor invoices.', err);
      setVendorInvoices([]);
      setInvoiceListStatus('error');
      setInvoiceListError('仕入請求一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      await Promise.all([loadProjects(), loadVendors()]);
      await Promise.all([
        loadPurchaseOrders(),
        loadVendorQuotes(),
        loadVendorInvoices(),
      ]);
    };
    loadAll();
  }, [
    loadProjects,
    loadVendors,
    loadPurchaseOrders,
    loadVendorQuotes,
    loadVendorInvoices,
  ]);

  useEffect(() => {
    if (projects.length === 0) return;
    setPoForm((prev) =>
      prev.projectId ? prev : { ...prev, projectId: projects[0].id },
    );
    setQuoteForm((prev) =>
      prev.projectId ? prev : { ...prev, projectId: projects[0].id },
    );
    setInvoiceForm((prev) =>
      prev.projectId ? prev : { ...prev, projectId: projects[0].id },
    );
  }, [projects]);

  useEffect(() => {
    if (vendors.length === 0) return;
    setPoForm((prev) =>
      prev.vendorId ? prev : { ...prev, vendorId: vendors[0].id },
    );
    setQuoteForm((prev) =>
      prev.vendorId ? prev : { ...prev, vendorId: vendors[0].id },
    );
    setInvoiceForm((prev) =>
      prev.vendorId ? prev : { ...prev, vendorId: vendors[0].id },
    );
  }, [vendors]);

  useEffect(() => {
    if (!invoiceForm.purchaseOrderId) return;
    const exists = availablePurchaseOrders.some(
      (po) => po.id === invoiceForm.purchaseOrderId,
    );
    if (!exists) {
      setInvoiceForm((prev) => ({ ...prev, purchaseOrderId: '' }));
    }
  }, [availablePurchaseOrders, invoiceForm.purchaseOrderId]);

  const missingNumberLabel = '(番号未設定)';
  const isVendorInvoiceSubmittableStatus = (status: string) =>
    status === 'received' || status === 'draft';
  const isVendorInvoicePoLinkReasonRequiredStatus = (status: string) =>
    status !== 'received' && status !== 'draft' && status !== 'rejected';
  const isVendorInvoiceAllocationReasonRequiredStatus = (status: string) =>
    status !== 'received' && status !== 'draft' && status !== 'rejected';
  const isVendorInvoiceLineReasonRequiredStatus = (status: string) =>
    status !== 'received' && status !== 'draft' && status !== 'rejected';
  const normalizeCurrency = (value: string) =>
    value.trim().toUpperCase().slice(0, 3);
  const {
    invoiceAllocationDialog,
    invoiceAllocations,
    invoiceAllocationLoading,
    invoiceAllocationSaving,
    invoiceAllocationMessage,
    invoiceAllocationReason,
    invoiceAllocationExpanded,
    invoiceLineDialog,
    invoiceLines,
    invoiceLineLoading,
    invoiceLineSaving,
    invoiceLineMessage,
    invoiceLineReason,
    invoiceLineExpanded,
    invoiceLinePoUsageByPoLineId,
    invoiceLinePurchaseOrderDetail,
    allocationTotals,
    allocationTaxRateSummary,
    invoiceLineTotals,
    invoiceLineRequestedQuantityByPoLine,
    openVendorInvoiceAllocationDialog,
    closeVendorInvoiceAllocationDialog,
    openVendorInvoiceLineDialog,
    closeVendorInvoiceLineDialog,
    addVendorInvoiceAllocationRow,
    updateVendorInvoiceAllocation,
    removeVendorInvoiceAllocation,
    saveVendorInvoiceAllocations,
    setInvoiceAllocationReason,
    toggleInvoiceAllocationExpanded,
    addVendorInvoiceLineRow,
    updateVendorInvoiceLine,
    removeVendorInvoiceLine,
    saveVendorInvoiceLines,
    setInvoiceLineReason,
    toggleInvoiceLineExpanded,
  } = useVendorInvoiceDialogs({
    projects,
    purchaseOrderDetails,
    loadPurchaseOrderDetail,
    loadVendorInvoices,
    isVendorInvoiceAllocationReasonRequiredStatus,
    isVendorInvoiceLineReasonRequiredStatus,
  });

  const createPurchaseOrder = async () => {
    if (!poForm.projectId || !poForm.vendorId) {
      setPoResult({ text: '案件と業者は必須です', type: 'error' });
      return;
    }
    if (!Number.isFinite(poForm.totalAmount) || poForm.totalAmount < 0) {
      setPoResult({ text: '金額は0以上で入力してください', type: 'error' });
      return;
    }
    try {
      setIsPoSaving(true);
      setPoResult(null);
      await api(`/projects/${poForm.projectId}/purchase-orders`, {
        method: 'POST',
        body: JSON.stringify({
          vendorId: poForm.vendorId,
          issueDate: poForm.issueDate || undefined,
          dueDate: poForm.dueDate || undefined,
          currency: normalizeCurrency(poForm.currency) || 'JPY',
          totalAmount: poForm.totalAmount,
        }),
      });
      setPoResult({ text: '発注書を登録しました', type: 'success' });
      setPoForm((prev) => ({ ...prev, totalAmount: 0 }));
      loadPurchaseOrders();
    } catch (err) {
      console.error('Failed to create purchase order.', err);
      setPoResult({ text: '発注書の登録に失敗しました', type: 'error' });
    } finally {
      setIsPoSaving(false);
    }
  };

  const createVendorQuote = async () => {
    if (!quoteForm.projectId || !quoteForm.vendorId) {
      setQuoteResult({ text: '案件と業者は必須です', type: 'error' });
      return;
    }
    if (!Number.isFinite(quoteForm.totalAmount) || quoteForm.totalAmount < 0) {
      setQuoteResult({ text: '金額は0以上で入力してください', type: 'error' });
      return;
    }
    try {
      setIsQuoteSaving(true);
      setQuoteResult(null);
      await api('/vendor-quotes', {
        method: 'POST',
        body: JSON.stringify({
          projectId: quoteForm.projectId,
          vendorId: quoteForm.vendorId,
          quoteNo: quoteForm.quoteNo.trim() || undefined,
          issueDate: quoteForm.issueDate || undefined,
          currency: normalizeCurrency(quoteForm.currency) || 'JPY',
          totalAmount: quoteForm.totalAmount,
          documentUrl: quoteForm.documentUrl.trim() || undefined,
        }),
      });
      setQuoteResult({ text: '仕入見積を登録しました', type: 'success' });
      setQuoteForm((prev) => ({
        ...prev,
        quoteNo: '',
        documentUrl: '',
        totalAmount: 0,
      }));
      loadVendorQuotes();
    } catch (err) {
      console.error('Failed to create vendor quote.', err);
      setQuoteResult({ text: '仕入見積の登録に失敗しました', type: 'error' });
    } finally {
      setIsQuoteSaving(false);
    }
  };

  const createVendorInvoice = async () => {
    if (!invoiceForm.projectId || !invoiceForm.vendorId) {
      setInvoiceResult({ text: '案件と業者は必須です', type: 'error' });
      return;
    }
    if (
      !Number.isFinite(invoiceForm.totalAmount) ||
      invoiceForm.totalAmount < 0
    ) {
      setInvoiceResult({
        text: '金額は0以上で入力してください',
        type: 'error',
      });
      return;
    }
    try {
      setIsInvoiceSaving(true);
      setInvoiceResult(null);
      await api('/vendor-invoices', {
        method: 'POST',
        body: JSON.stringify({
          projectId: invoiceForm.projectId,
          vendorId: invoiceForm.vendorId,
          purchaseOrderId: invoiceForm.purchaseOrderId || undefined,
          vendorInvoiceNo: invoiceForm.vendorInvoiceNo.trim() || undefined,
          receivedDate: invoiceForm.receivedDate || undefined,
          dueDate: invoiceForm.dueDate || undefined,
          currency: normalizeCurrency(invoiceForm.currency) || 'JPY',
          totalAmount: invoiceForm.totalAmount,
          documentUrl: invoiceForm.documentUrl.trim() || undefined,
        }),
      });
      setInvoiceResult({ text: '仕入請求を登録しました', type: 'success' });
      setInvoiceForm((prev) => ({
        ...prev,
        purchaseOrderId: '',
        vendorInvoiceNo: '',
        documentUrl: '',
        totalAmount: 0,
      }));
      loadVendorInvoices();
    } catch (err) {
      console.error('Failed to create vendor invoice.', err);
      setInvoiceResult({
        text: '仕入請求の登録に失敗しました',
        type: 'error',
      });
    } finally {
      setIsInvoiceSaving(false);
    }
  };

  const setPoSendLogBusy = (id: string, isBusy: boolean) => {
    setPoSendLogLoading((prev) => ({ ...prev, [id]: isBusy }));
  };

  const startVendorInvoiceFromPo = (po: PurchaseOrder) => {
    const amount =
      typeof po.totalAmount === 'number'
        ? po.totalAmount
        : Number(po.totalAmount) || 0;
    setInvoiceForm((prev) => ({
      ...prev,
      projectId: po.projectId,
      vendorId: po.vendorId,
      purchaseOrderId: po.id,
      currency: po.currency || prev.currency,
      totalAmount: amount,
    }));
    setInvoiceResult({
      text: '発注書から仕入請求の入力を開始しました',
      type: 'success',
    });
  };

  const submitPurchaseOrder = async (id: string) => {
    if (poSubmitBusy[id]) return;
    try {
      setPoSubmitBusy((prev) => ({ ...prev, [id]: true }));
      setPoResult(null);
      await api(`/purchase-orders/${id}/submit`, { method: 'POST' });
      setPoResult({ text: '発注書を承認依頼しました', type: 'success' });
      loadPurchaseOrders();
    } catch (err) {
      console.error('Failed to submit purchase order.', err);
      setPoResult({ text: '発注書の承認依頼に失敗しました', type: 'error' });
    } finally {
      setPoSubmitBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  const loadPurchaseOrderSendLogs = async (id: string) => {
    try {
      setPoSendLogBusy(id, true);
      setPoSendLogMessage((prev) => ({ ...prev, [id]: '' }));
      const res = await api<{ items: DocumentSendLog[] }>(
        `/purchase-orders/${id}/send-logs`,
      );
      setPoSendLogs((prev) => ({ ...prev, [id]: res.items || [] }));
    } catch (err) {
      console.error('Failed to load purchase order send logs.', err);
      setPoSendLogMessage((prev) => ({
        ...prev,
        [id]: '送信履歴の取得に失敗しました',
      }));
    } finally {
      setPoSendLogBusy(id, false);
    }
  };

  const openPurchaseOrderSendLogsDialog = (id: string) => {
    setPoSendLogDialogId(id);
    void loadPurchaseOrderSendLogs(id);
  };

  const openPurchaseOrderPdf = async (id: string, pdfUrl?: string | null) => {
    if (!pdfUrl) {
      setPoSendLogMessage((prev) => ({
        ...prev,
        [id]: 'PDF URL がありません',
      }));
      return;
    }
    if (pdfUrl.startsWith('stub://')) {
      setPoSendLogMessage((prev) => ({
        ...prev,
        [id]: 'PDF は stub です',
      }));
      return;
    }
    try {
      setPoSendLogBusy(id, true);
      const res = await apiResponse(pdfUrl);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const filename = `purchase-order-${formatDateForFilename()}.pdf`;
      await openResponseInNewTab(res, filename);
    } catch (err) {
      console.error('Failed to open purchase order PDF.', err);
      setPoSendLogMessage((prev) => ({
        ...prev,
        [id]: 'PDFの取得に失敗しました',
      }));
    } finally {
      setPoSendLogBusy(id, false);
    }
  };

  const submitVendorInvoice = async (id: string) => {
    if (invoiceSubmitBusy[id]) return;
    try {
      setInvoiceSubmitBusy((prev) => ({ ...prev, [id]: true }));
      setInvoiceResult(null);
      await api(`/vendor-invoices/${id}/submit`, { method: 'POST' });
      setInvoiceResult({ text: '仕入請求を承認依頼しました', type: 'success' });
      loadVendorInvoices();
    } catch (err) {
      console.error('Failed to submit vendor invoice.', err);
      setInvoiceResult({
        text: '仕入請求の承認依頼に失敗しました',
        type: 'error',
      });
    } finally {
      setInvoiceSubmitBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  const executeConfirmAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'po-submit') {
      void submitPurchaseOrder(confirmAction.id);
    } else {
      void submitVendorInvoice(confirmAction.id);
    }
    setConfirmAction(null);
  };

  const openVendorInvoicePoLinkDialog = (invoice: VendorInvoice) => {
    setInvoicePoLinkResult(null);
    setInvoicePoLinkDialog({
      invoice,
      purchaseOrderId: invoice.purchaseOrderId || '',
      reasonText: '',
    });
  };

  const saveVendorInvoicePoLink = async () => {
    if (!invoicePoLinkDialog) return;
    const invoice = invoicePoLinkDialog.invoice;
    const purchaseOrderId = invoicePoLinkDialog.purchaseOrderId.trim();
    const reasonText = invoicePoLinkDialog.reasonText.trim();
    if (
      isVendorInvoicePoLinkReasonRequiredStatus(invoice.status) &&
      !reasonText
    ) {
      setInvoicePoLinkResult({
        text: '変更理由を入力してください',
        type: 'error',
      });
      return;
    }
    try {
      setInvoicePoLinkBusy(true);
      setInvoicePoLinkResult(null);
      if (purchaseOrderId) {
        await api(`/vendor-invoices/${invoice.id}/link-po`, {
          method: 'POST',
          body: JSON.stringify({
            purchaseOrderId,
            ...(reasonText ? { reasonText } : {}),
          }),
        });
      } else {
        await api(`/vendor-invoices/${invoice.id}/unlink-po`, {
          method: 'POST',
          body: JSON.stringify({
            ...(reasonText ? { reasonText } : {}),
          }),
        });
      }
      setInvoicePoLinkResult({
        text: '関連発注書を更新しました',
        type: 'success',
      });
      loadVendorInvoices();
      setInvoicePoLinkDialog(null);
    } catch (err) {
      console.error('Failed to update vendor invoice purchase order.', err);
      setInvoicePoLinkResult({
        text: '関連発注書の更新に失敗しました',
        type: 'error',
      });
    } finally {
      setInvoicePoLinkBusy(false);
    }
  };

  const {
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
  } = useVendorDocumentsTableData({
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
  });

  const purchaseOrderListContent = (() => {
    if (poListStatus === 'idle' || poListStatus === 'loading') {
      return (
        <AsyncStatePanel state="loading" loadingText="発注書一覧を取得中" />
      );
    }
    if (poListStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '発注書一覧の取得に失敗しました',
            detail: poListError,
            onRetry: () => {
              void loadPurchaseOrders();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (purchaseOrderRows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title:
              purchaseOrders.length === 0
                ? '発注書データがありません'
                : '条件に一致する発注書がありません',
            description:
              purchaseOrders.length === 0
                ? 'フォームから発注書を登録してください'
                : '検索条件を変更してください',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={purchaseOrderColumns}
        rows={purchaseOrderRows}
        rowActions={[
          {
            key: 'submit',
            label: '承認依頼',
            onSelect: (row) => {
              const status = String(row.status || '');
              if (status !== 'draft') {
                setPoResult({
                  text: '承認依頼は draft の発注書のみ実行できます',
                  type: 'error',
                });
                return;
              }
              if (poSubmitBusy[row.id]) {
                setPoResult({
                  text: 'この発注書は承認依頼を処理中です',
                  type: 'error',
                });
                return;
              }
              setConfirmAction({
                type: 'po-submit',
                id: row.id,
                numberLabel: String(row.poNo || missingNumberLabel),
              });
            },
          },
          {
            key: 'create-invoice',
            label: '仕入請求を作成',
            onSelect: (row) => {
              const target = purchaseOrderMap.get(row.id);
              if (!target) return;
              startVendorInvoiceFromPo(target);
            },
          },
          {
            key: 'send-logs',
            label: '送信履歴',
            onSelect: (row) => {
              openPurchaseOrderSendLogsDialog(row.id);
            },
          },
          {
            key: 'annotation',
            label: '注釈',
            onSelect: (row) => {
              const target = purchaseOrderMap.get(row.id);
              if (!target) return;
              setAnnotationTarget({
                kind: 'purchase_order',
                id: target.id,
                projectId: target.projectId,
                title: `発注書: ${target.poNo || missingNumberLabel}`,
              });
            },
          },
        ]}
      />
    );
  })();

  const vendorQuoteListContent = (() => {
    if (quoteListStatus === 'idle' || quoteListStatus === 'loading') {
      return (
        <AsyncStatePanel state="loading" loadingText="仕入見積一覧を取得中" />
      );
    }
    if (quoteListStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '仕入見積一覧の取得に失敗しました',
            detail: quoteListError,
            onRetry: () => {
              void loadVendorQuotes();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (vendorQuoteRows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title:
              vendorQuotes.length === 0
                ? '仕入見積データがありません'
                : '条件に一致する仕入見積がありません',
            description:
              vendorQuotes.length === 0
                ? 'フォームから仕入見積を登録してください'
                : '検索条件を変更してください',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={vendorQuoteColumns}
        rows={vendorQuoteRows}
        rowActions={[
          {
            key: 'annotation',
            label: '注釈',
            onSelect: (row) => {
              const target = vendorQuoteMap.get(row.id);
              if (!target) return;
              setAnnotationTarget({
                kind: 'vendor_quote',
                id: target.id,
                projectId: target.projectId,
                title: `仕入見積: ${target.quoteNo || missingNumberLabel}`,
              });
            },
          },
        ]}
      />
    );
  })();

  const vendorInvoiceListContent = (() => {
    if (invoiceListStatus === 'idle' || invoiceListStatus === 'loading') {
      return (
        <AsyncStatePanel state="loading" loadingText="仕入請求一覧を取得中" />
      );
    }
    if (invoiceListStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '仕入請求一覧の取得に失敗しました',
            detail: invoiceListError,
            onRetry: () => {
              void loadVendorInvoices();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (vendorInvoiceRows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title:
              vendorInvoices.length === 0
                ? '仕入請求データがありません'
                : '条件に一致する仕入請求がありません',
            description:
              vendorInvoices.length === 0
                ? 'フォームから仕入請求を登録してください'
                : '検索条件を変更してください',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={vendorInvoiceColumns}
        rows={vendorInvoiceRows}
        rowActions={[
          {
            key: 'submit',
            label: '承認依頼',
            onSelect: (row) => {
              const status = String(row.status || '');
              if (!isVendorInvoiceSubmittableStatus(status)) {
                setInvoiceResult({
                  text: '承認依頼は received/draft の仕入請求のみ実行できます',
                  type: 'error',
                });
                return;
              }
              if (invoiceSubmitBusy[row.id]) {
                setInvoiceResult({
                  text: 'この仕入請求は承認依頼を処理中です',
                  type: 'error',
                });
                return;
              }
              setConfirmAction({
                type: 'invoice-submit',
                id: row.id,
                numberLabel: String(row.vendorInvoiceNo || missingNumberLabel),
              });
            },
          },
          {
            key: 'po-link',
            label: 'PO紐づけ',
            onSelect: (row) => {
              const target = vendorInvoiceMap.get(row.id);
              if (!target) return;
              openVendorInvoicePoLinkDialog(target);
            },
          },
          {
            key: 'allocation',
            label: '配賦明細',
            onSelect: (row) => {
              const target = vendorInvoiceMap.get(row.id);
              if (!target) return;
              void openVendorInvoiceAllocationDialog(target);
            },
          },
          {
            key: 'invoice-lines',
            label: '請求明細',
            onSelect: (row) => {
              const target = vendorInvoiceMap.get(row.id);
              if (!target) return;
              void openVendorInvoiceLineDialog(target);
            },
          },
          {
            key: 'annotation',
            label: '注釈',
            onSelect: (row) => {
              const target = vendorInvoiceMap.get(row.id);
              if (!target) return;
              setAnnotationTarget({
                kind: 'vendor_invoice',
                id: target.id,
                projectId: target.projectId,
                title: `仕入請求: ${target.vendorInvoiceNo || missingNumberLabel}`,
              });
            },
          },
        ]}
      />
    );
  })();

  const activePoSendLogs = poSendLogDialogId
    ? poSendLogs[poSendLogDialogId] || []
    : [];
  const activePoSendLogMessage = poSendLogDialogId
    ? poSendLogMessage[poSendLogDialogId] || ''
    : '';
  const activePoSendLogLoading = poSendLogDialogId
    ? poSendLogLoading[poSendLogDialogId]
    : false;
  const activePo = poSendLogDialogId
    ? purchaseOrderMap.get(poSendLogDialogId)
    : null;

  return (
    <div>
      <h2>仕入/発注</h2>
      {projectMessage && (
        <div style={{ marginTop: 12 }}>
          <Alert variant="error">{projectMessage}</Alert>
        </div>
      )}
      {vendorMessage && (
        <div style={{ marginTop: 12 }}>
          <Alert variant="error">{vendorMessage}</Alert>
        </div>
      )}
      <div style={{ marginTop: 12, display: 'grid', gap: 16 }}>
        <Tabs
          value={activeDocumentTab}
          onValueChange={(value) => {
            if (!isDocumentTabId(value)) return;
            setActiveDocumentTab(value);
          }}
          ariaLabel="仕入/発注セクション"
          items={documentTabIds.map((id) => {
            if (id === 'purchase-orders') {
              return { id, label: `発注書 (${purchaseOrderRows.length})` };
            }
            if (id === 'vendor-quotes') {
              return { id, label: `仕入見積 (${vendorQuoteRows.length})` };
            }
            return { id, label: `仕入請求 (${vendorInvoiceRows.length})` };
          })}
        />
        <div style={{ display: 'grid', gap: 24 }}>
          <VendorDocumentsPurchaseOrdersSection
            active={activeDocumentTab === 'purchase-orders'}
            poForm={poForm}
            projects={projects}
            vendors={vendors}
            isPoSaving={isPoSaving}
            onChangePoForm={setPoForm}
            onCreatePurchaseOrder={createPurchaseOrder}
            poResult={poResult}
            onDismissPoResult={() => setPoResult(null)}
            onReloadPurchaseOrders={() => {
              void loadPurchaseOrders();
            }}
            poSearch={poSearch}
            onChangePoSearch={setPoSearch}
            poStatusFilter={poStatusFilter}
            onChangePoStatusFilter={setPoStatusFilter}
            poStatusOptions={poStatusOptions}
            onClearPoFilters={() => {
              setPoSearch('');
              setPoStatusFilter('all');
            }}
            purchaseOrderListContent={purchaseOrderListContent}
            normalizeCurrency={normalizeCurrency}
          />

          <VendorDocumentsVendorQuotesSection
            active={activeDocumentTab === 'vendor-quotes'}
            quoteForm={quoteForm}
            projects={projects}
            vendors={vendors}
            isQuoteSaving={isQuoteSaving}
            onChangeQuoteForm={setQuoteForm}
            onCreateVendorQuote={createVendorQuote}
            quoteResult={quoteResult}
            onDismissQuoteResult={() => setQuoteResult(null)}
            onReloadVendorQuotes={() => {
              void loadVendorQuotes();
            }}
            quoteSearch={quoteSearch}
            onChangeQuoteSearch={setQuoteSearch}
            quoteStatusFilter={quoteStatusFilter}
            onChangeQuoteStatusFilter={setQuoteStatusFilter}
            quoteStatusOptions={quoteStatusOptions}
            onClearQuoteFilters={() => {
              setQuoteSearch('');
              setQuoteStatusFilter('all');
            }}
            vendorQuoteListContent={vendorQuoteListContent}
            normalizeCurrency={normalizeCurrency}
          />

          <VendorDocumentsVendorInvoicesSection
            active={activeDocumentTab === 'vendor-invoices'}
            invoiceForm={invoiceForm}
            projects={projects}
            vendors={vendors}
            availablePurchaseOrders={availablePurchaseOrders}
            missingNumberLabel={missingNumberLabel}
            isInvoiceSaving={isInvoiceSaving}
            onChangeInvoiceForm={setInvoiceForm}
            onCreateVendorInvoice={createVendorInvoice}
            invoiceResult={invoiceResult}
            onDismissInvoiceResult={() => setInvoiceResult(null)}
            invoiceSavedViewBar={
              <VendorInvoiceSavedViewBar
                savedViews={invoiceSavedViews}
                invoiceSearch={invoiceSearch}
                invoiceStatusFilter={invoiceStatusFilter}
                invoiceStatusOptions={invoiceStatusOptions}
                onChangeInvoiceSearch={setInvoiceSearch}
                onChangeInvoiceStatusFilter={setInvoiceStatusFilter}
                normalizeInvoiceStatusFilter={normalizeInvoiceStatusFilter}
              />
            }
            onReloadVendorInvoices={() => {
              void loadVendorInvoices();
            }}
            invoiceSearch={invoiceSearch}
            onChangeInvoiceSearch={setInvoiceSearch}
            invoiceStatusFilter={invoiceStatusFilter}
            onChangeInvoiceStatusFilter={setInvoiceStatusFilter}
            invoiceStatusOptions={invoiceStatusOptions}
            onClearInvoiceFilters={() => {
              setInvoiceSearch('');
              setInvoiceStatusFilter('all');
            }}
            vendorInvoiceListContent={vendorInvoiceListContent}
            normalizeCurrency={normalizeCurrency}
          />
        </div>
      </div>
      <PurchaseOrderSendLogsDialog
        open={Boolean(poSendLogDialogId)}
        purchaseOrderId={poSendLogDialogId}
        purchaseOrderStatus={activePo?.status}
        purchaseOrderNo={activePo?.poNo}
        missingNumberLabel={missingNumberLabel}
        message={activePoSendLogMessage}
        loading={Boolean(activePoSendLogLoading)}
        logs={activePoSendLogs}
        onClose={() => setPoSendLogDialogId(null)}
        onOpenPdf={(purchaseOrderId, pdfUrl) => {
          void openPurchaseOrderPdf(purchaseOrderId, pdfUrl);
        }}
      />
      <ConfirmActionDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'po-submit'
            ? '発注書を承認依頼しますか？'
            : '仕入請求を承認依頼しますか？'
        }
        description={
          confirmAction
            ? `対象: ${confirmAction.numberLabel}\nこの操作は取り消せません。`
            : undefined
        }
        confirmLabel="実行"
        cancelLabel="キャンセル"
        confirmDisabled={
          confirmAction
            ? confirmAction.type === 'po-submit'
              ? Boolean(poSubmitBusy[confirmAction.id])
              : Boolean(invoiceSubmitBusy[confirmAction.id])
            : false
        }
        onConfirm={executeConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
      <VendorInvoicePoLinkDialog
        open={Boolean(invoicePoLinkDialog)}
        dialog={invoicePoLinkDialog}
        busy={invoicePoLinkBusy}
        result={invoicePoLinkResult}
        missingNumberLabel={missingNumberLabel}
        availablePurchaseOrders={availablePurchaseOrdersForInvoicePoLink}
        selectedPurchaseOrderId={selectedPurchaseOrderId}
        selectedPurchaseOrder={selectedPurchaseOrder}
        purchaseOrderDetailLoading={purchaseOrderDetailLoading}
        purchaseOrderDetailMessage={purchaseOrderDetailMessage}
        onClose={() => setInvoicePoLinkDialog(null)}
        onSave={saveVendorInvoicePoLink}
        onChangePurchaseOrderId={(purchaseOrderId) => {
          setInvoicePoLinkDialog((prev) =>
            prev ? { ...prev, purchaseOrderId } : prev,
          );
        }}
        onChangeReasonText={(reasonText) => {
          setInvoicePoLinkDialog((prev) =>
            prev ? { ...prev, reasonText } : prev,
          );
        }}
        renderProject={renderProject}
        renderVendor={renderVendor}
        isReasonRequiredStatus={isVendorInvoicePoLinkReasonRequiredStatus}
        parseNumberValue={parseNumberValue}
        formatAmount={formatAmount}
      />
      <VendorInvoiceAllocationDialog
        open={Boolean(invoiceAllocationDialog)}
        dialog={invoiceAllocationDialog}
        saving={invoiceAllocationSaving}
        loading={invoiceAllocationLoading}
        expanded={invoiceAllocationExpanded}
        allocations={invoiceAllocations}
        projects={projects}
        purchaseOrderDetails={purchaseOrderDetails}
        missingNumberLabel={missingNumberLabel}
        allocationTotals={allocationTotals}
        allocationTaxRateSummary={allocationTaxRateSummary}
        reason={invoiceAllocationReason}
        message={invoiceAllocationMessage}
        onClose={closeVendorInvoiceAllocationDialog}
        onSave={saveVendorInvoiceAllocations}
        onToggleExpanded={toggleInvoiceAllocationExpanded}
        onAddRow={addVendorInvoiceAllocationRow}
        onUpdateAllocation={updateVendorInvoiceAllocation}
        onRemoveAllocation={removeVendorInvoiceAllocation}
        onChangeReason={setInvoiceAllocationReason}
        renderProject={renderProject}
        renderVendor={renderVendor}
        formatAmount={formatAmount}
        parseNumberValue={parseNumberValue}
        isPdfUrl={isPdfUrl}
        isReasonRequiredStatus={isVendorInvoiceAllocationReasonRequiredStatus}
      />
      <VendorInvoiceLineDialog
        open={Boolean(invoiceLineDialog)}
        dialog={invoiceLineDialog}
        saving={invoiceLineSaving}
        loading={invoiceLineLoading}
        expanded={invoiceLineExpanded}
        lines={invoiceLines}
        invoiceLinePurchaseOrderDetail={invoiceLinePurchaseOrderDetail}
        invoiceLinePoUsageByPoLineId={invoiceLinePoUsageByPoLineId}
        invoiceLineRequestedQuantityByPoLine={
          invoiceLineRequestedQuantityByPoLine
        }
        invoiceLineTotals={invoiceLineTotals}
        reason={invoiceLineReason}
        message={invoiceLineMessage}
        missingNumberLabel={missingNumberLabel}
        onClose={closeVendorInvoiceLineDialog}
        onSave={saveVendorInvoiceLines}
        onToggleExpanded={toggleInvoiceLineExpanded}
        onAddRow={addVendorInvoiceLineRow}
        onUpdateLine={updateVendorInvoiceLine}
        onRemoveLine={removeVendorInvoiceLine}
        onChangeReason={setInvoiceLineReason}
        onOpenAllocation={(invoice) => {
          closeVendorInvoiceLineDialog();
          void openVendorInvoiceAllocationDialog(invoice);
        }}
        renderProject={renderProject}
        renderVendor={renderVendor}
        formatAmount={formatAmount}
        parseNumberValue={parseNumberValue}
        isPdfUrl={isPdfUrl}
        isReasonRequiredStatus={isVendorInvoiceLineReasonRequiredStatus}
      />
      <Dialog
        open={Boolean(annotationTarget)}
        onClose={() => setAnnotationTarget(null)}
        title={annotationTarget?.title || '注釈'}
        size="large"
        footer={
          <Button variant="secondary" onClick={() => setAnnotationTarget(null)}>
            閉じる
          </Button>
        }
      >
        {annotationTarget && (
          <AnnotationsCard
            targetKind={annotationTarget.kind}
            targetId={annotationTarget.id}
            projectId={annotationTarget.projectId}
            title={annotationTarget.title}
          />
        )}
      </Dialog>
    </div>
  );
};
