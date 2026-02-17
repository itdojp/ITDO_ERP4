export type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

export type VendorOption = {
  id: string;
  code: string;
  name: string;
};

export type PurchaseOrder = {
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

export type PurchaseOrderLine = {
  id: string;
  purchaseOrderId: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate?: number | string | null;
  taskId?: string | null;
  expenseId?: string | null;
};

export type PurchaseOrderDetail = PurchaseOrder & {
  lines?: PurchaseOrderLine[];
};

export type VendorInvoiceAllocation = {
  id?: string;
  projectId: string;
  amount: number | string;
  taxRate?: number | string | null;
  taxAmount?: number | string | null;
  purchaseOrderLineId?: string | null;
};

export type VendorInvoiceLine = {
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

export type VendorInvoicePoLineUsage = {
  purchaseOrderLineId: string;
  purchaseOrderQuantity: number;
  existingQuantity: number;
  requestedQuantity: number;
  remainingQuantity: number;
  exceeds: boolean;
};

export type DocumentSendLog = {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
  error?: string | null;
  pdfUrl?: string | null;
};

export type VendorQuote = {
  id: string;
  quoteNo?: string | null;
  projectId: string;
  vendorId: string;
  issueDate?: string | null;
  currency: string;
  totalAmount: number | string;
  status: string;
};

export type VendorInvoice = {
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

export type MessageState = { text: string; type: 'success' | 'error' } | null;
export type ListStatus = 'idle' | 'loading' | 'error' | 'success';

export type PurchaseOrderForm = {
  projectId: string;
  vendorId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalAmount: number;
};

export type VendorQuoteForm = {
  projectId: string;
  vendorId: string;
  quoteNo: string;
  issueDate: string;
  currency: string;
  totalAmount: number;
  documentUrl: string;
};

export type VendorInvoiceForm = {
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

export type InvoiceSavedFilterPayload = {
  search: string;
  status: string;
};

export const documentTabIds = [
  'purchase-orders',
  'vendor-quotes',
  'vendor-invoices',
] as const;

export type DocumentTabId = (typeof documentTabIds)[number];

export const isDocumentTabId = (value: string): value is DocumentTabId =>
  (documentTabIds as readonly string[]).includes(value);

export const normalizeInvoiceStatusFilter = (
  value: string,
  options: string[],
) => {
  if (value === 'all') return 'all';
  return options.includes(value) ? value : 'all';
};

export const formatDate = (value?: string | null) =>
  value ? value.slice(0, 10) : '-';

export const parseNumberValue = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const formatAmount = (value: number | string, currency: string) => {
  const amount = parseNumberValue(value);
  if (amount === null) return `- ${currency}`;
  return `${amount.toLocaleString()} ${currency}`;
};

export const isPdfUrl = (value?: string | null) => {
  if (!value) return false;
  return /\.pdf($|[?#])/i.test(value);
};

const today = new Date().toISOString().slice(0, 10);

export const defaultPurchaseOrderForm: PurchaseOrderForm = {
  projectId: '',
  vendorId: '',
  issueDate: today,
  dueDate: '',
  currency: 'JPY',
  totalAmount: 0,
};

export const defaultVendorQuoteForm: VendorQuoteForm = {
  projectId: '',
  vendorId: '',
  quoteNo: '',
  issueDate: today,
  currency: 'JPY',
  totalAmount: 0,
  documentUrl: '',
};

export const defaultVendorInvoiceForm: VendorInvoiceForm = {
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
