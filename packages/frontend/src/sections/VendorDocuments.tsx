import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { Button, Dialog } from '../ui';
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
  const [poListMessage, setPoListMessage] = useState('');
  const [quoteListMessage, setQuoteListMessage] = useState('');
  const [invoiceListMessage, setInvoiceListMessage] = useState('');
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
  const [poActionState, setPoActionState] = useState<Record<string, boolean>>(
    {},
  );
  const [poSendLogs, setPoSendLogs] = useState<
    Record<string, DocumentSendLog[]>
  >({});
  const [poSendLogMessage, setPoSendLogMessage] = useState<
    Record<string, string>
  >({});
  const [poSendLogLoading, setPoSendLogLoading] = useState<
    Record<string, boolean>
  >({});
  const [invoiceActionState, setInvoiceActionState] = useState<
    Record<string, boolean>
  >({});
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
    try {
      const res = await api<{ items: PurchaseOrder[] }>('/purchase-orders');
      setPurchaseOrders(res.items || []);
      setPoListMessage('');
    } catch (err) {
      console.error('Failed to load purchase orders.', err);
      setPurchaseOrders([]);
      setPoListMessage('発注書一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorQuotes = useCallback(async () => {
    try {
      const res = await api<{ items: VendorQuote[] }>('/vendor-quotes');
      setVendorQuotes(res.items || []);
      setQuoteListMessage('');
    } catch (err) {
      console.error('Failed to load vendor quotes.', err);
      setVendorQuotes([]);
      setQuoteListMessage('仕入見積一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorInvoices = useCallback(async () => {
    try {
      const res = await api<{ items: VendorInvoice[] }>('/vendor-invoices');
      setVendorInvoices(res.items || []);
      setInvoiceListMessage('');
    } catch (err) {
      console.error('Failed to load vendor invoices.', err);
      setVendorInvoices([]);
      setInvoiceListMessage('仕入請求一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorInvoiceAllocations = useCallback(async (invoiceId: string) => {
    setInvoiceAllocationLoading(true);
    setInvoiceAllocationMessage(null);
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

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const renderVendor = (vendorId: string) => {
    const vendor = vendorMap.get(vendorId);
    return vendor ? `${vendor.code} / ${vendor.name}` : vendorId;
  };

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
    if (!invoiceAllocationDialog || invoiceAllocations.length === 0) return null;
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
    const diff =
      invoiceTotal != null ? invoiceTotal - grossTotal : null;
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

  const setPoActionBusy = (id: string, isBusy: boolean) => {
    setPoActionState((prev) => ({ ...prev, [id]: isBusy }));
  };

  const setPoSendLogBusy = (id: string, isBusy: boolean) => {
    setPoSendLogLoading((prev) => ({ ...prev, [id]: isBusy }));
  };

  const setInvoiceActionBusy = (id: string, isBusy: boolean) => {
    setInvoiceActionState((prev) => ({ ...prev, [id]: isBusy }));
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
      setPoActionBusy(id, true);
      setPoResult(null);
      await api(`/purchase-orders/${id}/submit`, { method: 'POST' });
      setPoResult({ text: '発注書を承認依頼しました', type: 'success' });
      loadPurchaseOrders();
    } catch (err) {
      console.error('Failed to submit purchase order.', err);
      setPoResult({ text: '発注書の承認依頼に失敗しました', type: 'error' });
    } finally {
      setPoActionBusy(id, false);
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
      setInvoiceActionBusy(id, true);
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
      setInvoiceActionBusy(id, false);
    }
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
        entry.taxRate === undefined || entry.taxRate === null || entry.taxRate === ''
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

  return (
    <div>
      <h2>仕入/発注</h2>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      {vendorMessage && <p style={{ color: '#dc2626' }}>{vendorMessage}</p>}
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>発注書</h3>
          <div className="card" style={{ marginBottom: 8 }}>
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
              <button
                className="button"
                onClick={createPurchaseOrder}
                disabled={isPoSaving}
              >
                {isPoSaving ? '登録中' : '登録'}
              </button>
            </div>
            {poResult && (
              <p
                style={{
                  color: poResult.type === 'error' ? '#dc2626' : '#16a34a',
                  marginTop: 8,
                }}
              >
                {poResult.text}
              </p>
            )}
          </div>
          <button className="button secondary" onClick={loadPurchaseOrders}>
            再読込
          </button>
          {poListMessage && <p style={{ color: '#dc2626' }}>{poListMessage}</p>}
          <ul className="list">
            {purchaseOrders.map((item) => {
              const linkedInvoices =
                vendorInvoicesByPurchaseOrderId.get(item.id) || [];
              const linkedInvoiceLabels = linkedInvoices.map(
                (invoice) =>
                  `${invoice.vendorInvoiceNo || missingNumberLabel}(${invoice.status})`,
              );
              const shownLinkedInvoiceLabels = linkedInvoiceLabels.slice(0, 3);
              const remainingLinkedInvoiceCount =
                linkedInvoiceLabels.length - shownLinkedInvoiceLabels.length;
              return (
                <li key={item.id}>
                  <span className="badge">{item.status}</span>{' '}
                  {item.poNo || missingNumberLabel} /{' '}
                  {renderProject(item.projectId)} /{' '}
                  {renderVendor(item.vendorId)} /{' '}
                  {formatAmount(item.totalAmount, item.currency)}
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    発行日: {formatDate(item.issueDate)} / 納期:{' '}
                    {formatDate(item.dueDate)}
                  </div>
                  {linkedInvoices.length > 0 && (
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      リンク済み仕入請求: {linkedInvoices.length}件（
                      {shownLinkedInvoiceLabels.join(', ')}
                      {remainingLinkedInvoiceCount > 0
                        ? ` 他${remainingLinkedInvoiceCount}件`
                        : ''}
                      ）
                    </div>
                  )}
                  {item.status === 'draft' && (
                    <div style={{ marginTop: 6 }}>
                      <button
                        className="button secondary"
                        onClick={() => submitPurchaseOrder(item.id)}
                        disabled={poActionState[item.id]}
                      >
                        {poActionState[item.id] ? '申請中' : '承認依頼'}
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="button secondary"
                      onClick={() => startVendorInvoiceFromPo(item)}
                    >
                      仕入請求を作成
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="button secondary"
                      onClick={() => loadPurchaseOrderSendLogs(item.id)}
                      disabled={poSendLogLoading[item.id]}
                    >
                      {poSendLogLoading[item.id] ? '取得中' : '送信履歴'}
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setAnnotationTarget({
                          kind: 'purchase_order',
                          id: item.id,
                          projectId: item.projectId,
                          title: `発注書: ${item.poNo || missingNumberLabel}`,
                        })
                      }
                    >
                      注釈
                    </button>
                  </div>
                  {poSendLogMessage[item.id] && (
                    <div style={{ color: '#dc2626', marginTop: 4 }}>
                      {poSendLogMessage[item.id]}
                    </div>
                  )}
                  {Object.prototype.hasOwnProperty.call(
                    poSendLogs,
                    item.id,
                  ) && (
                    <ul className="list" style={{ marginTop: 6 }}>
                      {(poSendLogs[item.id] || []).map((log) => (
                        <li key={log.id}>
                          <span className="badge">{log.status}</span>{' '}
                          {log.channel} / {formatDateTime(log.createdAt)}
                          {log.error && (
                            <div style={{ color: '#dc2626' }}>
                              error: {log.error}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            logId: {log.id}
                          </div>
                          {log.pdfUrl && (
                            <div style={{ marginTop: 4 }}>
                              <button
                                className="button secondary"
                                onClick={() =>
                                  openPurchaseOrderPdf(item.id, log.pdfUrl)
                                }
                                disabled={poSendLogLoading[item.id]}
                              >
                                PDFを開く
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                      {(poSendLogs[item.id] || []).length === 0 && (
                        <li>履歴なし</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
            {purchaseOrders.length === 0 && <li>データなし</li>}
          </ul>
        </div>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>仕入見積</h3>
          <div className="card" style={{ marginBottom: 8 }}>
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
              <button
                className="button"
                onClick={createVendorQuote}
                disabled={isQuoteSaving}
              >
                {isQuoteSaving ? '登録中' : '登録'}
              </button>
            </div>
            {quoteResult && (
              <p
                style={{
                  color: quoteResult.type === 'error' ? '#dc2626' : '#16a34a',
                  marginTop: 8,
                }}
              >
                {quoteResult.text}
              </p>
            )}
          </div>
          <button className="button secondary" onClick={loadVendorQuotes}>
            再読込
          </button>
          {quoteListMessage && (
            <p style={{ color: '#dc2626' }}>{quoteListMessage}</p>
          )}
          <ul className="list">
            {vendorQuotes.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span>{' '}
                {item.quoteNo || missingNumberLabel} /{' '}
                {renderProject(item.projectId)} / {renderVendor(item.vendorId)}{' '}
                / {formatAmount(item.totalAmount, item.currency)}
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  発行日: {formatDate(item.issueDate)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <button
                    className="button secondary"
                    onClick={() =>
                      setAnnotationTarget({
                        kind: 'vendor_quote',
                        id: item.id,
                        projectId: item.projectId,
                        title: `仕入見積: ${item.quoteNo || missingNumberLabel}`,
                      })
                    }
                  >
                    注釈
                  </button>
                </div>
              </li>
            ))}
            {vendorQuotes.length === 0 && <li>データなし</li>}
          </ul>
        </div>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>仕入請求</h3>
          <div className="card" style={{ marginBottom: 8 }}>
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
              <button
                className="button"
                onClick={createVendorInvoice}
                disabled={isInvoiceSaving}
              >
                {isInvoiceSaving ? '登録中' : '登録'}
              </button>
            </div>
            {invoiceResult && (
              <p
                style={{
                  color: invoiceResult.type === 'error' ? '#dc2626' : '#16a34a',
                  marginTop: 8,
                }}
              >
                {invoiceResult.text}
              </p>
            )}
          </div>
          <button className="button secondary" onClick={loadVendorInvoices}>
            再読込
          </button>
          {invoiceListMessage && (
            <p style={{ color: '#dc2626' }}>{invoiceListMessage}</p>
          )}
          <ul className="list">
            {vendorInvoices.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span>{' '}
                {item.vendorInvoiceNo || missingNumberLabel} /{' '}
                {renderProject(item.projectId)} / {renderVendor(item.vendorId)}{' '}
                / {formatAmount(item.totalAmount, item.currency)}
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  受領日: {formatDate(item.receivedDate)} / 支払期限:{' '}
                  {formatDate(item.dueDate)}
                </div>
                {(item.purchaseOrder || item.purchaseOrderId) && (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    関連発注書:{' '}
                    {item.purchaseOrder?.poNo || item.purchaseOrderId}
                  </div>
                )}
                {isVendorInvoiceSubmittableStatus(item.status) && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="button secondary"
                      onClick={() => submitVendorInvoice(item.id)}
                      disabled={invoiceActionState[item.id]}
                    >
                      {invoiceActionState[item.id] ? '申請中' : '承認依頼'}
                    </button>
                  </div>
                )}
                <div
                  style={{
                    marginTop: 6,
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    className="button secondary"
                    onClick={() => openVendorInvoicePoLinkDialog(item)}
                  >
                    PO紐づけ
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => openVendorInvoiceAllocationDialog(item)}
                  >
                    配賦明細
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      setAnnotationTarget({
                        kind: 'vendor_invoice',
                        id: item.id,
                        projectId: item.projectId,
                        title: `仕入請求: ${item.vendorInvoiceNo || missingNumberLabel}`,
                      })
                    }
                  >
                    注釈
                  </button>
                </div>
              </li>
            ))}
            {vendorInvoices.length === 0 && <li>データなし</li>}
          </ul>
        </div>
      </div>
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
              <span className="badge">
                {invoicePoLinkDialog.invoice.status}
              </span>{' '}
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
              <span className="badge">
                {invoiceAllocationDialog.invoice.status}
              </span>{' '}
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
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  PDF未登録
                </div>
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
                onClick={() =>
                  setInvoiceAllocationExpanded((prev) => !prev)
                }
              >
                {invoiceAllocationExpanded ? '配賦明細を隠す' : '配賦明細を入力'}
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
                          const poDetail =
                            invoiceAllocationDialog.invoice.purchaseOrderId
                              ? purchaseOrderDetails[
                                  invoiceAllocationDialog.invoice
                                    .purchaseOrderId
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
                                    <option
                                      key={project.id}
                                      value={project.id}
                                    >
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
                              {invoiceAllocationDialog.invoice.purchaseOrderId && (
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
                      差分:{' '}
                      {allocationTotals.diff.toLocaleString()}{' '}
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
