import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  StatusBadge,
  Toast,
  erpStatusDictionary,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import { formatDateForFilename, openResponseInNewTab } from '../utils/download';

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

type PurchaseOrder = {
  id: string;
  poNo?: string | null;
  projectId: string;
  vendorId: string;
  issueDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number | string;
  status: string;
};

type PurchaseOrderLine = {
  id: string;
  purchaseOrderId: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate?: number | string | null;
  taskId?: string | null;
  expenseId?: string | null;
};

type PurchaseOrderDetail = PurchaseOrder & { lines?: PurchaseOrderLine[] };

type VendorInvoiceAllocation = {
  id?: string;
  projectId: string;
  amount: number | string;
  taxRate?: number | string | null;
  taxAmount?: number | string | null;
  purchaseOrderLineId?: string | null;
};

type DocumentSendLog = {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
  error?: string | null;
  pdfUrl?: string | null;
};

type VendorQuote = {
  id: string;
  quoteNo?: string | null;
  projectId: string;
  vendorId: string;
  issueDate?: string | null;
  currency: string;
  totalAmount: number | string;
  status: string;
};

type VendorInvoice = {
  id: string;
  vendorInvoiceNo?: string | null;
  projectId: string;
  vendorId: string;
  purchaseOrderId?: string | null;
  purchaseOrder?: { id: string; poNo?: string | null } | null;
  receivedDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number | string;
  status: string;
  documentUrl?: string | null;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;
type ListStatus = 'idle' | 'loading' | 'error' | 'success';

type PurchaseOrderForm = {
  projectId: string;
  vendorId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalAmount: number;
};

type VendorQuoteForm = {
  projectId: string;
  vendorId: string;
  quoteNo: string;
  issueDate: string;
  currency: string;
  totalAmount: number;
  documentUrl: string;
};

type VendorInvoiceForm = {
  projectId: string;
  vendorId: string;
  purchaseOrderId?: string;
  vendorInvoiceNo: string;
  receivedDate: string;
  dueDate: string;
  currency: string;
  totalAmount: number;
  documentUrl: string;
};

const formatDate = (value?: string | null) =>
  value ? value.slice(0, 10) : '-';
const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const parseNumberValue = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatAmount = (value: number | string, currency: string) => {
  const amount = parseNumberValue(value);
  if (amount === null) return `- ${currency}`;
  return `${amount.toLocaleString()} ${currency}`;
};

const isPdfUrl = (value?: string | null) => {
  if (!value) return false;
  return /\.pdf($|[?#])/i.test(value);
};

const today = new Date().toISOString().slice(0, 10);

const defaultPurchaseOrderForm: PurchaseOrderForm = {
  projectId: '',
  vendorId: '',
  issueDate: today,
  dueDate: '',
  currency: 'JPY',
  totalAmount: 0,
};

const defaultVendorQuoteForm: VendorQuoteForm = {
  projectId: '',
  vendorId: '',
  quoteNo: '',
  issueDate: today,
  currency: 'JPY',
  totalAmount: 0,
  documentUrl: '',
};

const defaultVendorInvoiceForm: VendorInvoiceForm = {
  projectId: '',
  vendorId: '',
  purchaseOrderId: '',
  vendorInvoiceNo: '',
  receivedDate: today,
  dueDate: '',
  currency: 'JPY',
  totalAmount: 0,
  documentUrl: '',
};

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
  const [invoiceAllocationDialog, setInvoiceAllocationDialog] = useState<{
    invoice: VendorInvoice;
  } | null>(null);
  const [invoiceAllocations, setInvoiceAllocations] = useState<
    VendorInvoiceAllocation[]
  >([]);
  const [invoiceAllocationLoading, setInvoiceAllocationLoading] =
    useState(false);
  const [invoiceAllocationSaving, setInvoiceAllocationSaving] = useState(false);
  const [invoiceAllocationMessage, setInvoiceAllocationMessage] =
    useState<MessageState>(null);
  const [invoiceAllocationReason, setInvoiceAllocationReason] = useState('');
  const [invoiceAllocationExpanded, setInvoiceAllocationExpanded] =
    useState(false);
  const [purchaseOrderDetails, setPurchaseOrderDetails] = useState<
    Record<string, PurchaseOrderDetail>
  >({});
  const [purchaseOrderDetailLoading, setPurchaseOrderDetailLoading] =
    useState(false);
  const [purchaseOrderDetailMessage, setPurchaseOrderDetailMessage] =
    useState('');
  const [confirmAction, setConfirmAction] = useState<
    | {
        type: 'po-submit' | 'invoice-submit';
        id: string;
        numberLabel: string;
      }
    | null
  >(null);

  const projectMap = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project]));
  }, [projects]);

  const vendorMap = useMemo(() => {
    return new Map(vendors.map((vendor) => [vendor.id, vendor]));
  }, [vendors]);

  const availablePurchaseOrders = useMemo(() => {
    return purchaseOrders.filter(
      (po) =>
        po.projectId === invoiceForm.projectId &&
        po.vendorId === invoiceForm.vendorId,
    );
  }, [purchaseOrders, invoiceForm.projectId, invoiceForm.vendorId]);

  const availablePurchaseOrdersForInvoicePoLink = useMemo(() => {
    if (!invoicePoLinkDialog) return [];
    const invoice = invoicePoLinkDialog.invoice;
    return purchaseOrders.filter(
      (po) =>
        po.projectId === invoice.projectId && po.vendorId === invoice.vendorId,
    );
  }, [invoicePoLinkDialog, purchaseOrders]);

  const selectedPurchaseOrderId = invoicePoLinkDialog?.purchaseOrderId.trim();
  const selectedPurchaseOrder = selectedPurchaseOrderId
    ? purchaseOrderDetails[selectedPurchaseOrderId] || null
    : null;

  const vendorInvoicesByPurchaseOrderId = useMemo(() => {
    const map = new Map<string, VendorInvoice[]>();
    vendorInvoices.forEach((invoice) => {
      const poId = invoice.purchaseOrderId;
      if (!poId) return;
      const list = map.get(poId) || [];
      list.push(invoice);
      map.set(poId, list);
    });
    return map;
  }, [vendorInvoices]);

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

  const loadVendorInvoiceAllocations = useCallback(
    async (invoiceId: string) => {
      setInvoiceAllocationLoading(true);
      try {
        const res = await api<{
          invoice: VendorInvoice;
          items: VendorInvoiceAllocation[];
        }>(`/vendor-invoices/${invoiceId}/allocations`);
        setInvoiceAllocations(res.items || []);
        setInvoiceAllocationDialog((prev) =>
          prev ? { ...prev, invoice: res.invoice } : prev,
        );
      } catch (err) {
        console.error('Failed to load vendor invoice allocations.', err);
        setInvoiceAllocationMessage({
          text: '配賦明細の取得に失敗しました',
          type: 'error',
        });
        setInvoiceAllocations([]);
      } finally {
        setInvoiceAllocationLoading(false);
      }
    },
    [],
  );

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

  const renderProject = useCallback(
    (projectId: string) => {
      const project = projectMap.get(projectId);
      return project ? `${project.code} / ${project.name}` : projectId;
    },
    [projectMap],
  );

  const renderVendor = useCallback(
    (vendorId: string) => {
      const vendor = vendorMap.get(vendorId);
      return vendor ? `${vendor.code} / ${vendor.name}` : vendorId;
    },
    [vendorMap],
  );

  const missingNumberLabel = '(番号未設定)';
  const isVendorInvoiceSubmittableStatus = (status: string) =>
    status === 'received' || status === 'draft';
  const isVendorInvoicePoLinkReasonRequiredStatus = (status: string) =>
    status !== 'received' && status !== 'draft' && status !== 'rejected';
  const isVendorInvoiceAllocationReasonRequiredStatus = (status: string) =>
    status !== 'received' && status !== 'draft' && status !== 'rejected';
  const normalizeCurrency = (value: string) =>
    value.trim().toUpperCase().slice(0, 3);

  const allocationTotals = useMemo(() => {
    if (!invoiceAllocationDialog || invoiceAllocations.length === 0)
      return null;
    let amountTotal = 0;
    let taxTotal = 0;
    invoiceAllocations.forEach((item) => {
      amountTotal += parseNumberValue(item.amount) ?? 0;
      taxTotal += parseNumberValue(item.taxAmount) ?? 0;
    });
    const grossTotal = amountTotal + taxTotal;
    const invoiceTotal = parseNumberValue(
      invoiceAllocationDialog.invoice.totalAmount,
    );
    const diff = invoiceTotal != null ? invoiceTotal - grossTotal : null;
    return { amountTotal, taxTotal, grossTotal, invoiceTotal, diff };
  }, [invoiceAllocationDialog, invoiceAllocations]);

  const allocationTaxRateSummary = useMemo(() => {
    const summary = new Map<string, { amount: number; tax: number }>();
    invoiceAllocations.forEach((item) => {
      const rateValue = parseNumberValue(item.taxRate);
      const key = rateValue == null ? '免税' : `${rateValue}%`;
      const entry = summary.get(key) || { amount: 0, tax: 0 };
      entry.amount += parseNumberValue(item.amount) ?? 0;
      entry.tax += parseNumberValue(item.taxAmount) ?? 0;
      summary.set(key, entry);
    });
    return Array.from(summary.entries()).map(([key, value]) => ({
      key,
      amount: value.amount,
      tax: value.tax,
    }));
  }, [invoiceAllocations]);

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
    try {
      setPoResult(null);
      await api(`/purchase-orders/${id}/submit`, { method: 'POST' });
      setPoResult({ text: '発注書を承認依頼しました', type: 'success' });
      loadPurchaseOrders();
    } catch (err) {
      console.error('Failed to submit purchase order.', err);
      setPoResult({ text: '発注書の承認依頼に失敗しました', type: 'error' });
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
    try {
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

  const openVendorInvoiceAllocationDialog = async (invoice: VendorInvoice) => {
    setInvoiceAllocationDialog({ invoice });
    setInvoiceAllocationReason('');
    setInvoiceAllocationMessage(null);
    setInvoiceAllocationExpanded(false);
    setInvoiceAllocations([]);
    if (invoice.purchaseOrderId) {
      void loadPurchaseOrderDetail(invoice.purchaseOrderId);
    }
    await loadVendorInvoiceAllocations(invoice.id);
  };

  const addVendorInvoiceAllocationRow = () => {
    const defaultProjectId =
      invoiceAllocationDialog?.invoice.projectId || projects[0]?.id || '';
    setInvoiceAllocations((prev) => [
      ...prev,
      {
        projectId: defaultProjectId,
        amount: 0,
        taxRate: null,
        taxAmount: null,
        purchaseOrderLineId: '',
      },
    ]);
  };

  const updateVendorInvoiceAllocation = (
    index: number,
    update: Partial<VendorInvoiceAllocation>,
  ) => {
    setInvoiceAllocations((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...update } : item)),
    );
  };

  const removeVendorInvoiceAllocation = (index: number) => {
    setInvoiceAllocations((prev) => prev.filter((_, idx) => idx !== index));
  };

  const saveVendorInvoiceAllocations = async () => {
    if (!invoiceAllocationDialog) return;
    const invoice = invoiceAllocationDialog.invoice;
    const reasonText = invoiceAllocationReason.trim();
    if (
      isVendorInvoiceAllocationReasonRequiredStatus(invoice.status) &&
      !reasonText
    ) {
      setInvoiceAllocationMessage({
        text: '変更理由を入力してください',
        type: 'error',
      });
      return;
    }
    const payload: {
      allocations: Array<{
        projectId: string;
        amount: number;
        taxRate?: number;
        taxAmount?: number;
        purchaseOrderLineId?: string;
      }>;
      reasonText?: string;
    } = { allocations: [] };

    for (let i = 0; i < invoiceAllocations.length; i += 1) {
      const entry = invoiceAllocations[i];
      const projectId = entry.projectId.trim();
      if (!projectId) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の案件が未選択です`,
          type: 'error',
        });
        return;
      }
      const amount = parseNumberValue(entry.amount);
      if (amount == null || amount < 0) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の金額が不正です`,
          type: 'error',
        });
        return;
      }
      const taxRate =
        entry.taxRate === undefined ||
        entry.taxRate === null ||
        entry.taxRate === ''
          ? null
          : parseNumberValue(entry.taxRate);
      if (entry.taxRate != null && taxRate == null) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の税率が不正です`,
          type: 'error',
        });
        return;
      }
      const taxAmount =
        entry.taxAmount === undefined ||
        entry.taxAmount === null ||
        entry.taxAmount === ''
          ? null
          : parseNumberValue(entry.taxAmount);
      if (entry.taxAmount != null && taxAmount == null) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の税額が不正です`,
          type: 'error',
        });
        return;
      }
      const purchaseOrderLineId = entry.purchaseOrderLineId?.trim();
      payload.allocations.push({
        projectId,
        amount,
        ...(taxRate != null ? { taxRate } : {}),
        ...(taxAmount != null ? { taxAmount } : {}),
        ...(purchaseOrderLineId ? { purchaseOrderLineId } : {}),
      });
    }
    if (reasonText) {
      payload.reasonText = reasonText;
    }

    try {
      setInvoiceAllocationSaving(true);
      setInvoiceAllocationMessage(null);
      await api(`/vendor-invoices/${invoice.id}/allocations`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setInvoiceAllocationMessage({
        text: '配賦明細を更新しました',
        type: 'success',
      });
      await loadVendorInvoices();
      await loadVendorInvoiceAllocations(invoice.id);
    } catch (err) {
      console.error('Failed to update vendor invoice allocations.', err);
      setInvoiceAllocationMessage({
        text: '配賦明細の更新に失敗しました',
        type: 'error',
      });
    } finally {
      setInvoiceAllocationSaving(false);
    }
  };

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
      if (poStatusFilter !== 'all' && item.status !== poStatusFilter) {
        return false;
      }
      if (!needle) return true;
      const linkedInvoices = vendorInvoicesByPurchaseOrderId.get(item.id) || [];
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
      if (quoteStatusFilter !== 'all' && item.status !== quoteStatusFilter) {
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
        const linkedInvoices = vendorInvoicesByPurchaseOrderId.get(item.id) || [];
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
    [filteredVendorQuotes, missingNumberLabel, renderProject, renderVendor],
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
    [filteredVendorInvoices, missingNumberLabel, renderProject, renderVendor],
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

  const purchaseOrderListContent = (() => {
    if (poListStatus === 'idle' || poListStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="発注書一覧を取得中" />;
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
      return <AsyncStatePanel state="loading" loadingText="仕入見積一覧を取得中" />;
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
      return <AsyncStatePanel state="loading" loadingText="仕入請求一覧を取得中" />;
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
  const activePo = poSendLogDialogId ? purchaseOrderMap.get(poSendLogDialogId) : null;

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
      <div style={{ marginTop: 12, display: 'grid', gap: 24 }}>
        <section>
          <h3>発注書</h3>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select
                value={poForm.projectId}
                onChange={(e) =>
                  setPoForm({ ...poForm, projectId: e.target.value })
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
                value={poForm.vendorId}
                onChange={(e) =>
                  setPoForm({ ...poForm, vendorId: e.target.value })
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
                type="number"
                min={0}
                value={poForm.totalAmount}
                onChange={(e) =>
                  setPoForm({
                    ...poForm,
                    totalAmount: Number(e.target.value),
                  })
                }
                placeholder="金額"
                style={{ width: 120 }}
              />
              <input
                type="text"
                value={poForm.currency}
                onChange={(e) =>
                  setPoForm({
                    ...poForm,
                    currency: normalizeCurrency(e.target.value),
                  })
                }
                placeholder="通貨"
                style={{ width: 80 }}
                maxLength={3}
              />
              <input
                type="date"
                value={poForm.issueDate}
                onChange={(e) =>
                  setPoForm({ ...poForm, issueDate: e.target.value })
                }
              />
              <input
                type="date"
                value={poForm.dueDate}
                onChange={(e) =>
                  setPoForm({ ...poForm, dueDate: e.target.value })
                }
              />
              <Button onClick={createPurchaseOrder} disabled={isPoSaving}>
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
                onClose={() => setPoResult(null)}
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
                      void loadPurchaseOrders();
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
                    onChange={(e) => setPoSearch(e.target.value)}
                    placeholder="発注番号 / 案件 / 業者 / 請求番号で検索"
                    aria-label="発注書検索"
                  />
                  <Select
                    value={poStatusFilter}
                    onChange={(e) => setPoStatusFilter(e.target.value)}
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPoSearch('');
                        setPoStatusFilter('all');
                      }}
                    >
                      条件クリア
                    </Button>
                  )}
                </div>
              </FilterBar>
            }
            table={purchaseOrderListContent}
          />
        </section>

        <section>
          <h3>仕入見積</h3>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select
                value={quoteForm.projectId}
                onChange={(e) =>
                  setQuoteForm({ ...quoteForm, projectId: e.target.value })
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
                  setQuoteForm({ ...quoteForm, vendorId: e.target.value })
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
                  setQuoteForm({ ...quoteForm, quoteNo: e.target.value })
                }
                placeholder="見積番号"
              />
              <input
                type="number"
                min={0}
                value={quoteForm.totalAmount}
                onChange={(e) =>
                  setQuoteForm({
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
                  setQuoteForm({
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
                  setQuoteForm({ ...quoteForm, issueDate: e.target.value })
                }
              />
              <input
                type="text"
                value={quoteForm.documentUrl}
                onChange={(e) =>
                  setQuoteForm({ ...quoteForm, documentUrl: e.target.value })
                }
                placeholder="書類URL"
                style={{ minWidth: 180 }}
              />
              <Button onClick={createVendorQuote} disabled={isQuoteSaving}>
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
                onClose={() => setQuoteResult(null)}
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
                      void loadVendorQuotes();
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
                    onChange={(e) => setQuoteSearch(e.target.value)}
                    placeholder="見積番号 / 案件 / 業者 / 金額で検索"
                    aria-label="仕入見積検索"
                  />
                  <Select
                    value={quoteStatusFilter}
                    onChange={(e) => setQuoteStatusFilter(e.target.value)}
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQuoteSearch('');
                        setQuoteStatusFilter('all');
                      }}
                    >
                      条件クリア
                    </Button>
                  )}
                </div>
              </FilterBar>
            }
            table={vendorQuoteListContent}
          />
        </section>

        <section>
          <h3>仕入請求</h3>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select
                value={invoiceForm.projectId}
                onChange={(e) =>
                  setInvoiceForm({ ...invoiceForm, projectId: e.target.value })
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
                  setInvoiceForm({ ...invoiceForm, vendorId: e.target.value })
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
                  setInvoiceForm({
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
                  setInvoiceForm({
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
                  setInvoiceForm({
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
                  setInvoiceForm({
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
                  setInvoiceForm({
                    ...invoiceForm,
                    receivedDate: e.target.value,
                  })
                }
              />
              <input
                type="date"
                value={invoiceForm.dueDate}
                onChange={(e) =>
                  setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })
                }
              />
              <input
                type="text"
                value={invoiceForm.documentUrl}
                onChange={(e) =>
                  setInvoiceForm({
                    ...invoiceForm,
                    documentUrl: e.target.value,
                  })
                }
                placeholder="書類URL"
                style={{ minWidth: 180 }}
              />
              <Button onClick={createVendorInvoice} disabled={isInvoiceSaving}>
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
                onClose={() => setInvoiceResult(null)}
              />
            </div>
          )}
          <CrudList
            title="仕入請求一覧"
            description="承認依頼・PO紐づけ・配賦明細編集を一覧から実行できます。"
            filters={
              <FilterBar
                actions={
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void loadVendorInvoices();
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
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    placeholder="請求番号 / 案件 / 業者 / PO番号で検索"
                    aria-label="仕入請求検索"
                  />
                  <Select
                    value={invoiceStatusFilter}
                    onChange={(e) => setInvoiceStatusFilter(e.target.value)}
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setInvoiceSearch('');
                        setInvoiceStatusFilter('all');
                      }}
                    >
                      条件クリア
                    </Button>
                  )}
                </div>
              </FilterBar>
            }
            table={vendorInvoiceListContent}
          />
        </section>
      </div>
      <Dialog
        open={Boolean(poSendLogDialogId)}
        onClose={() => setPoSendLogDialogId(null)}
        title="発注書: 送信履歴"
        size="large"
        footer={
          <Button variant="secondary" onClick={() => setPoSendLogDialogId(null)}>
            閉じる
          </Button>
        }
      >
        {poSendLogDialogId && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              <StatusBadge
                status={activePo?.status || 'draft'}
                dictionary={erpStatusDictionary}
                size="sm"
              />{' '}
              {activePo?.poNo || missingNumberLabel}
            </div>
            {activePoSendLogMessage && (
              <Alert variant="error">{activePoSendLogMessage}</Alert>
            )}
            {activePoSendLogLoading && (
              <AsyncStatePanel state="loading" loadingText="送信履歴を取得中" />
            )}
            {!activePoSendLogLoading && (
              <DataTable
                columns={[
                  { key: 'status', header: '状態' },
                  { key: 'channel', header: 'チャネル' },
                  { key: 'createdAt', header: '送信日時' },
                  { key: 'error', header: 'エラー' },
                  { key: 'logId', header: 'ログID' },
                ]}
                rows={activePoSendLogs.map((log) => ({
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
                      if (!poSendLogDialogId) return;
                      void openPurchaseOrderPdf(poSendLogDialogId, pdfUrl);
                    },
                  },
                ]}
              />
            )}
          </div>
        )}
      </Dialog>
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
        onConfirm={executeConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
      <Dialog
        open={Boolean(invoicePoLinkDialog)}
        onClose={() => setInvoicePoLinkDialog(null)}
        title="仕入請求: 関連発注書（PO）"
        size="large"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setInvoicePoLinkDialog(null)}
              disabled={invoicePoLinkBusy}
            >
              閉じる
            </Button>
            <Button
              onClick={saveVendorInvoicePoLink}
              disabled={invoicePoLinkBusy}
            >
              {invoicePoLinkBusy ? '更新中' : '更新'}
            </Button>
          </div>
        }
      >
        {invoicePoLinkDialog && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              <StatusBadge
                status={invoicePoLinkDialog.invoice.status}
                dictionary={erpStatusDictionary}
                size="sm"
              />{' '}
              {invoicePoLinkDialog.invoice.vendorInvoiceNo ||
                missingNumberLabel}
              {' / '}
              {renderProject(invoicePoLinkDialog.invoice.projectId)}
              {' / '}
              {renderVendor(invoicePoLinkDialog.invoice.vendorId)}
            </div>
            <select
              value={invoicePoLinkDialog.purchaseOrderId}
              onChange={(e) =>
                setInvoicePoLinkDialog((prev) =>
                  prev ? { ...prev, purchaseOrderId: e.target.value } : prev,
                )
              }
            >
              <option value="">紐づけなし</option>
              {availablePurchaseOrdersForInvoicePoLink.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.poNo || missingNumberLabel}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={invoicePoLinkDialog.reasonText}
              onChange={(e) =>
                setInvoicePoLinkDialog((prev) =>
                  prev ? { ...prev, reasonText: e.target.value } : prev,
                )
              }
              placeholder={
                isVendorInvoicePoLinkReasonRequiredStatus(
                  invoicePoLinkDialog.invoice.status,
                )
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
                      const viCurrency = invoicePoLinkDialog.invoice.currency;
                      const sameCurrency = viCurrency === poCurrency;
                      const poTotal = parseNumberValue(
                        selectedPurchaseOrder.totalAmount,
                      );
                      const viTotal = parseNumberValue(
                        invoicePoLinkDialog.invoice.totalAmount,
                      );
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
                            {formatAmount(
                              invoicePoLinkDialog.invoice.totalAmount,
                              viCurrency,
                            )}
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
                                qty !== null && unit !== null
                                  ? qty * unit
                                  : null;
                              return (
                                <tr key={line.id}>
                                  <td style={{ padding: 6 }}>
                                    {line.description}
                                  </td>
                                  <td
                                    style={{ padding: 6, textAlign: 'right' }}
                                  >
                                    {String(line.quantity)}
                                  </td>
                                  <td
                                    style={{ padding: 6, textAlign: 'right' }}
                                  >
                                    {formatAmount(
                                      line.unitPrice,
                                      selectedPurchaseOrder.currency,
                                    )}
                                  </td>
                                  <td
                                    style={{ padding: 6, textAlign: 'right' }}
                                  >
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
                            {(selectedPurchaseOrder.lines ?? []).length ===
                              0 && (
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
            {invoicePoLinkResult && (
              <p
                style={{
                  color:
                    invoicePoLinkResult.type === 'error'
                      ? '#dc2626'
                      : '#16a34a',
                  margin: 0,
                }}
              >
                {invoicePoLinkResult.text}
              </p>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(invoiceAllocationDialog)}
        onClose={() => setInvoiceAllocationDialog(null)}
        title="仕入請求: 配賦明細"
        size="large"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setInvoiceAllocationDialog(null)}
              disabled={invoiceAllocationSaving}
            >
              閉じる
            </Button>
            <Button
              onClick={saveVendorInvoiceAllocations}
              disabled={invoiceAllocationSaving}
            >
              {invoiceAllocationSaving ? '更新中' : '更新'}
            </Button>
          </div>
        }
      >
        {invoiceAllocationDialog && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              <StatusBadge
                status={invoiceAllocationDialog.invoice.status}
                dictionary={erpStatusDictionary}
                size="sm"
              />{' '}
              {invoiceAllocationDialog.invoice.vendorInvoiceNo ||
                missingNumberLabel}
              {' / '}
              {renderProject(invoiceAllocationDialog.invoice.projectId)}
              {' / '}
              {renderVendor(invoiceAllocationDialog.invoice.vendorId)}
              {' / '}
              {formatAmount(
                invoiceAllocationDialog.invoice.totalAmount,
                invoiceAllocationDialog.invoice.currency,
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b' }}>請求書PDF</div>
              {!invoiceAllocationDialog.invoice.documentUrl && (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>PDF未登録</div>
              )}
              {invoiceAllocationDialog.invoice.documentUrl && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <a
                    href={invoiceAllocationDialog.invoice.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12 }}
                  >
                    PDFを開く
                  </a>
                  {isPdfUrl(invoiceAllocationDialog.invoice.documentUrl) && (
                    <iframe
                      title="vendor-invoice-pdf"
                      src={invoiceAllocationDialog.invoice.documentUrl}
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
              <Button
                variant="secondary"
                onClick={() => setInvoiceAllocationExpanded((prev) => !prev)}
              >
                {invoiceAllocationExpanded
                  ? '配賦明細を隠す'
                  : '配賦明細を入力'}
              </Button>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                配賦明細は必要時のみ入力（未入力でも保存可）
              </span>
            </div>
            {invoiceAllocationLoading && (
              <div style={{ fontSize: 12, color: '#64748b' }}>
                配賦明細を読み込み中...
              </div>
            )}
            {invoiceAllocationExpanded && !invoiceAllocationLoading && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <button
                    className="button secondary"
                    onClick={addVendorInvoiceAllocationRow}
                  >
                    明細追加
                  </button>
                </div>
                {invoiceAllocations.length === 0 && (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    配賦明細は未入力です
                  </div>
                )}
                {invoiceAllocations.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>案件</th>
                          <th>金額</th>
                          <th>税率</th>
                          <th>税額</th>
                          {invoiceAllocationDialog.invoice.purchaseOrderId && (
                            <th>PO明細</th>
                          )}
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceAllocations.map((entry, index) => {
                          const amountValue = parseNumberValue(entry.amount);
                          const taxRateValue = parseNumberValue(entry.taxRate);
                          const computedTax =
                            amountValue != null && taxRateValue != null
                              ? Math.round((amountValue * taxRateValue) / 100)
                              : null;
                          const poDetail = invoiceAllocationDialog.invoice
                            .purchaseOrderId
                            ? purchaseOrderDetails[
                                invoiceAllocationDialog.invoice.purchaseOrderId
                              ]
                            : null;
                          return (
                            <tr key={`alloc-${index}`}>
                              <td>
                                <select
                                  value={entry.projectId}
                                  onChange={(e) =>
                                    updateVendorInvoiceAllocation(index, {
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
                                    updateVendorInvoiceAllocation(index, {
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
                                    updateVendorInvoiceAllocation(index, {
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
                                    updateVendorInvoiceAllocation(index, {
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
                              {invoiceAllocationDialog.invoice
                                .purchaseOrderId && (
                                <td>
                                  <select
                                    value={entry.purchaseOrderLineId ?? ''}
                                    onChange={(e) =>
                                      updateVendorInvoiceAllocation(index, {
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
                                  onClick={() =>
                                    removeVendorInvoiceAllocation(index)
                                  }
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
                      invoiceAllocationDialog.invoice.currency,
                    )}
                  </div>
                  <div>
                    税額合計:{' '}
                    {formatAmount(
                      allocationTotals.taxTotal,
                      invoiceAllocationDialog.invoice.currency,
                    )}
                  </div>
                  <div>
                    配賦合計:{' '}
                    {formatAmount(
                      allocationTotals.grossTotal,
                      invoiceAllocationDialog.invoice.currency,
                    )}
                  </div>
                  <div>
                    請求合計:{' '}
                    {formatAmount(
                      invoiceAllocationDialog.invoice.totalAmount,
                      invoiceAllocationDialog.invoice.currency,
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
                      {invoiceAllocationDialog.invoice.currency}
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
                            invoiceAllocationDialog.invoice.currency,
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
              value={invoiceAllocationReason}
              onChange={(e) => setInvoiceAllocationReason(e.target.value)}
              placeholder={
                isVendorInvoiceAllocationReasonRequiredStatus(
                  invoiceAllocationDialog.invoice.status,
                )
                  ? '変更理由（必須）'
                  : '変更理由（任意）'
              }
            />
            {invoiceAllocationMessage && (
              <p
                style={{
                  color:
                    invoiceAllocationMessage.type === 'error'
                      ? '#dc2626'
                      : '#16a34a',
                }}
              >
                {invoiceAllocationMessage.text}
              </p>
            )}
          </div>
        )}
      </Dialog>
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
