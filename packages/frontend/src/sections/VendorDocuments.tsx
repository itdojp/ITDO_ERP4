import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  SavedViewBar,
  Select,
  StatusBadge,
  Tabs,
  Toast,
  createLocalStorageSavedViewsAdapter,
  erpStatusDictionary,
  useSavedViews,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import { formatDateForFilename, openResponseInNewTab } from '../utils/download';
import { PurchaseOrderSendLogsDialog } from './vendor-documents/PurchaseOrderSendLogsDialog';
import { VendorInvoiceAllocationDialog } from './vendor-documents/VendorInvoiceAllocationDialog';
import { VendorDocumentsPurchaseOrdersSection } from './vendor-documents/VendorDocumentsPurchaseOrdersSection';
import { VendorInvoiceLineDialog } from './vendor-documents/VendorInvoiceLineDialog';
import { VendorInvoicePoLinkDialog } from './vendor-documents/VendorInvoicePoLinkDialog';

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

type VendorInvoiceLine = {
  id?: string;
  tempId?: string;
  lineNo?: number | string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  amount?: number | string | null;
  taxRate?: number | string | null;
  taxAmount?: number | string | null;
  grossAmount?: number | string | null;
  purchaseOrderLineId?: string | null;
};

type VendorInvoicePoLineUsage = {
  purchaseOrderLineId: string;
  purchaseOrderQuantity: number;
  existingQuantity: number;
  requestedQuantity: number;
  remainingQuantity: number;
  exceeds: boolean;
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

type InvoiceSavedFilterPayload = {
  search: string;
  status: string;
};

const documentTabIds = [
  'purchase-orders',
  'vendor-quotes',
  'vendor-invoices',
] as const;
type DocumentTabId = (typeof documentTabIds)[number];

const isDocumentTabId = (value: string): value is DocumentTabId =>
  (documentTabIds as readonly string[]).includes(value);

const normalizeInvoiceStatusFilter = (value: string, options: string[]) => {
  if (value === 'all') return 'all';
  return options.includes(value) ? value : 'all';
};

const formatDate = (value?: string | null) =>
  value ? value.slice(0, 10) : '-';

const parseNumberValue = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
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
  const [invoiceLineDialog, setInvoiceLineDialog] = useState<{
    invoice: VendorInvoice;
  } | null>(null);
  const [invoiceLines, setInvoiceLines] = useState<VendorInvoiceLine[]>([]);
  const [invoiceLineLoading, setInvoiceLineLoading] = useState(false);
  const invoiceInitialViewTimestamp = useMemo(
    () => new Date().toISOString(),
    [],
  );
  const invoiceSavedViews = useSavedViews<InvoiceSavedFilterPayload>({
    initialViews: [
      {
        id: 'default',
        name: '既定',
        payload: { search: '', status: 'all' },
        createdAt: invoiceInitialViewTimestamp,
        updatedAt: invoiceInitialViewTimestamp,
      },
    ],
    initialActiveViewId: 'default',
    storageAdapter:
      createLocalStorageSavedViewsAdapter<InvoiceSavedFilterPayload>(
        'erp4-vendor-invoice-filter-saved-views',
      ),
  });
  const [invoiceLineSaving, setInvoiceLineSaving] = useState(false);
  const [invoiceLineMessage, setInvoiceLineMessage] =
    useState<MessageState>(null);
  const [invoiceLineReason, setInvoiceLineReason] = useState('');
  const [invoiceLineExpanded, setInvoiceLineExpanded] = useState(false);
  const [invoiceLinePoUsageByPoLineId, setInvoiceLinePoUsageByPoLineId] =
    useState<Record<string, VendorInvoicePoLineUsage>>({});
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
  const invoiceLineTempIdRef = useRef(0);

  const nextInvoiceLineTempId = useCallback(() => {
    invoiceLineTempIdRef.current += 1;
    return `tmp-line-${invoiceLineTempIdRef.current}`;
  }, []);

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

  const loadVendorInvoiceLines = useCallback(
    async (invoiceId: string) => {
      setInvoiceLineLoading(true);
      try {
        const res = await api<{
          invoice: VendorInvoice;
          items: VendorInvoiceLine[];
          poLineUsage?: VendorInvoicePoLineUsage[];
        }>(`/vendor-invoices/${invoiceId}/lines`);
        setInvoiceLines(
          (res.items || []).map((item) =>
            item.id || item.tempId
              ? item
              : { ...item, tempId: nextInvoiceLineTempId() },
          ),
        );
        const usageByPoLineId: Record<string, VendorInvoicePoLineUsage> = {};
        (res.poLineUsage || []).forEach((entry) => {
          usageByPoLineId[entry.purchaseOrderLineId] = entry;
        });
        setInvoiceLinePoUsageByPoLineId(usageByPoLineId);
        setInvoiceLineDialog((prev) =>
          prev ? { ...prev, invoice: res.invoice } : prev,
        );
      } catch (err) {
        console.error('Failed to load vendor invoice lines.', err);
        setInvoiceLineMessage({
          text: '請求明細の取得に失敗しました',
          type: 'error',
        });
        setInvoiceLines([]);
        setInvoiceLinePoUsageByPoLineId({});
      } finally {
        setInvoiceLineLoading(false);
      }
    },
    [nextInvoiceLineTempId],
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
  const isVendorInvoiceLineReasonRequiredStatus = (status: string) =>
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

  const invoiceLineTotals = useMemo(() => {
    if (!invoiceLineDialog || invoiceLines.length === 0) return null;
    let amountTotal = 0;
    let taxTotal = 0;
    let grossTotal = 0;
    invoiceLines.forEach((line) => {
      const quantity = parseNumberValue(line.quantity) ?? 0;
      const unitPrice = parseNumberValue(line.unitPrice) ?? 0;
      const amount =
        parseNumberValue(line.amount) ?? Math.round(quantity * unitPrice);
      const taxRate = parseNumberValue(line.taxRate);
      const taxAmount =
        parseNumberValue(line.taxAmount) ??
        (taxRate == null ? 0 : Math.round((amount * taxRate) / 100));
      amountTotal += amount;
      taxTotal += taxAmount;
      grossTotal += amount + taxAmount;
    });
    const invoiceTotal = parseNumberValue(
      invoiceLineDialog.invoice.totalAmount,
    );
    const diff = invoiceTotal != null ? invoiceTotal - grossTotal : null;
    return {
      amountTotal,
      taxTotal,
      grossTotal,
      invoiceTotal,
      diff,
    };
  }, [invoiceLineDialog, invoiceLines]);

  const invoiceLineRequestedQuantityByPoLine = useMemo(() => {
    const map = new Map<string, number>();
    invoiceLines.forEach((line) => {
      const lineId = line.purchaseOrderLineId?.trim();
      if (!lineId) return;
      const quantity = parseNumberValue(line.quantity) ?? 0;
      map.set(lineId, (map.get(lineId) || 0) + quantity);
    });
    return map;
  }, [invoiceLines]);

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

  const openVendorInvoiceLineDialog = async (invoice: VendorInvoice) => {
    setInvoiceLineDialog({ invoice });
    setInvoiceLineReason('');
    setInvoiceLineMessage(null);
    setInvoiceLineExpanded(false);
    setInvoiceLines([]);
    setInvoiceLinePoUsageByPoLineId({});
    if (invoice.purchaseOrderId) {
      void loadPurchaseOrderDetail(invoice.purchaseOrderId);
    }
    await loadVendorInvoiceLines(invoice.id);
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

  const addVendorInvoiceLineRow = () => {
    const maxLineNo = invoiceLines.reduce((maxValue, line) => {
      const value = parseNumberValue(line.lineNo);
      if (value == null || !Number.isInteger(value)) return maxValue;
      return Math.max(maxValue, value);
    }, 0);
    const nextLineNo = maxLineNo + 1;
    setInvoiceLines((prev) => [
      ...prev,
      {
        tempId: nextInvoiceLineTempId(),
        lineNo: nextLineNo,
        description: '',
        quantity: 1,
        unitPrice: 0,
        amount: null,
        taxRate: null,
        taxAmount: null,
        purchaseOrderLineId: '',
      },
    ]);
  };

  const updateVendorInvoiceLine = (
    index: number,
    update: Partial<VendorInvoiceLine>,
  ) => {
    setInvoiceLines((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...update } : item)),
    );
  };

  const removeVendorInvoiceLine = (index: number) => {
    setInvoiceLines((prev) => prev.filter((_, idx) => idx !== index));
  };

  const saveVendorInvoiceLines = async () => {
    if (!invoiceLineDialog) return;
    const invoice = invoiceLineDialog.invoice;
    const reasonText = invoiceLineReason.trim();
    if (
      isVendorInvoiceLineReasonRequiredStatus(invoice.status) &&
      !reasonText
    ) {
      setInvoiceLineMessage({
        text: '変更理由を入力してください',
        type: 'error',
      });
      return;
    }

    const payload: {
      lines: Array<{
        lineNo: number;
        description: string;
        quantity: number;
        unitPrice: number;
        amount?: number | null;
        taxRate?: number | null;
        taxAmount?: number | null;
        purchaseOrderLineId?: string | null;
      }>;
      reasonText?: string;
    } = { lines: [] };

    const lineNos = new Set<number>();
    for (let i = 0; i < invoiceLines.length; i += 1) {
      const entry = invoiceLines[i];
      const lineNoRaw =
        entry.lineNo === undefined || entry.lineNo === null
          ? i + 1
          : parseNumberValue(entry.lineNo);
      if (
        lineNoRaw == null ||
        !Number.isInteger(lineNoRaw) ||
        Number(lineNoRaw) <= 0
      ) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の行番号が不正です`,
          type: 'error',
        });
        return;
      }
      const lineNo = Number(lineNoRaw);
      if (lineNos.has(lineNo)) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の行番号が重複しています`,
          type: 'error',
        });
        return;
      }
      lineNos.add(lineNo);

      const description = entry.description.trim();
      if (!description) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の内容を入力してください`,
          type: 'error',
        });
        return;
      }
      const quantity = parseNumberValue(entry.quantity);
      if (quantity == null || quantity <= 0) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の数量が不正です`,
          type: 'error',
        });
        return;
      }
      const unitPrice = parseNumberValue(entry.unitPrice);
      if (unitPrice == null || unitPrice < 0) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の単価が不正です`,
          type: 'error',
        });
        return;
      }
      const amount =
        entry.amount === undefined ||
        entry.amount === null ||
        entry.amount === ''
          ? null
          : parseNumberValue(entry.amount);
      if (
        entry.amount != null &&
        entry.amount !== '' &&
        (amount == null || amount < 0)
      ) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の金額が不正です`,
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
      if (
        entry.taxRate != null &&
        entry.taxRate !== '' &&
        (taxRate == null || taxRate < 0)
      ) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の税率が不正です`,
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
      if (
        entry.taxAmount != null &&
        entry.taxAmount !== '' &&
        (taxAmount == null || taxAmount < 0)
      ) {
        setInvoiceLineMessage({
          text: `請求明細 ${i + 1} の税額が不正です`,
          type: 'error',
        });
        return;
      }
      const purchaseOrderLineId = entry.purchaseOrderLineId?.trim();
      payload.lines.push({
        lineNo,
        description,
        quantity,
        unitPrice,
        amount,
        taxRate,
        taxAmount,
        purchaseOrderLineId: purchaseOrderLineId || null,
      });
    }
    if (reasonText) payload.reasonText = reasonText;

    try {
      setInvoiceLineSaving(true);
      setInvoiceLineMessage(null);
      await api(`/vendor-invoices/${invoice.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setInvoiceLineMessage({
        text: '請求明細を更新しました',
        type: 'success',
      });
      await loadVendorInvoices();
      await loadVendorInvoiceLines(invoice.id);
    } catch (err) {
      console.error('Failed to update vendor invoice lines.', err);
      const errorText = err instanceof Error ? err.message : String(err);
      if (errorText.includes('PO_LINE_QUANTITY_EXCEEDED')) {
        setInvoiceLineMessage({
          text: 'PO明細の数量上限を超えています（数量を見直してください）',
          type: 'error',
        });
      } else if (errorText.includes('LINE_TOTAL_MISMATCH')) {
        setInvoiceLineMessage({
          text: '請求合計との差分が解消されていません',
          type: 'error',
        });
      } else if (errorText.includes('INVALID_PURCHASE_ORDER_LINE')) {
        setInvoiceLineMessage({
          text: '選択したPO明細が関連POに属していません',
          type: 'error',
        });
      } else {
        setInvoiceLineMessage({
          text: '請求明細の更新に失敗しました',
          type: 'error',
        });
      }
    } finally {
      setInvoiceLineSaving(false);
    }
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
        linkedInvoices
          .map((invoice) => invoice.vendorInvoiceNo || '')
          .join(' '),
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
  const invoiceLinePurchaseOrderDetail = invoiceLineDialog?.invoice
    .purchaseOrderId
    ? purchaseOrderDetails[invoiceLineDialog.invoice.purchaseOrderId] || null
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

          <section
            hidden={activeDocumentTab !== 'vendor-quotes'}
            style={{
              display: activeDocumentTab === 'vendor-quotes' ? 'block' : 'none',
            }}
          >
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

          <section
            hidden={activeDocumentTab !== 'vendor-invoices'}
            style={{
              display:
                activeDocumentTab === 'vendor-invoices' ? 'block' : 'none',
            }}
          >
            <h3>仕入請求</h3>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select
                  value={invoiceForm.projectId}
                  onChange={(e) =>
                    setInvoiceForm({
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
                <Button
                  onClick={createVendorInvoice}
                  disabled={isInvoiceSaving}
                >
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
            <SavedViewBar
              views={invoiceSavedViews.views}
              activeViewId={invoiceSavedViews.activeViewId}
              onSelectView={(viewId) => {
                invoiceSavedViews.selectView(viewId);
                const selected = invoiceSavedViews.views.find(
                  (view) => view.id === viewId,
                );
                if (!selected) return;
                setInvoiceSearch(selected.payload.search);
                setInvoiceStatusFilter(
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
                invoiceSavedViews.createView(name, {
                  search: invoiceSearch,
                  status: normalizedStatus,
                });
              }}
              onUpdateView={(viewId) => {
                const normalizedStatus = normalizeInvoiceStatusFilter(
                  invoiceStatusFilter,
                  invoiceStatusOptions,
                );
                invoiceSavedViews.updateView(viewId, {
                  payload: {
                    search: invoiceSearch,
                    status: normalizedStatus,
                  },
                });
              }}
              onDuplicateView={(viewId) => {
                invoiceSavedViews.duplicateView(viewId);
              }}
              onShareView={(viewId) => {
                invoiceSavedViews.toggleShared(viewId, true);
              }}
              onDeleteView={(viewId) => {
                invoiceSavedViews.deleteView(viewId);
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
            <CrudList
              title="仕入請求一覧"
              description="承認依頼・PO紐づけ・配賦明細編集・請求明細編集を一覧から実行できます。"
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
        onClose={() => setInvoiceAllocationDialog(null)}
        onSave={saveVendorInvoiceAllocations}
        onToggleExpanded={() => setInvoiceAllocationExpanded((prev) => !prev)}
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
        onClose={() => setInvoiceLineDialog(null)}
        onSave={saveVendorInvoiceLines}
        onToggleExpanded={() => setInvoiceLineExpanded((prev) => !prev)}
        onAddRow={addVendorInvoiceLineRow}
        onUpdateLine={updateVendorInvoiceLine}
        onRemoveLine={removeVendorInvoiceLine}
        onChangeReason={setInvoiceLineReason}
        onOpenAllocation={(invoice) => {
          setInvoiceLineDialog(null);
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
