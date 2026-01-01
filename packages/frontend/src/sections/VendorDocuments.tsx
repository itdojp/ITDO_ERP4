import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

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
  receivedDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number | string;
  status: string;
};

const formatDate = (value?: string | null) => (value ? value.slice(0, 10) : '-');

const formatAmount = (value: number | string, currency: string) => {
  const amount =
    typeof value === 'number' ? value : Number.isFinite(Number(value))
      ? Number(value)
      : null;
  if (amount === null) return `${value} ${currency}`;
  return `${amount.toLocaleString()} ${currency}`;
};

export const VendorDocuments: React.FC = () => {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendorQuotes, setVendorQuotes] = useState<VendorQuote[]>([]);
  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoice[]>([]);
  const [vendorMessage, setVendorMessage] = useState('');
  const [poMessage, setPoMessage] = useState('');
  const [quoteMessage, setQuoteMessage] = useState('');
  const [invoiceMessage, setInvoiceMessage] = useState('');

  const vendorMap = useMemo(() => {
    return new Map(vendors.map((vendor) => [vendor.id, vendor]));
  }, [vendors]);

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
      setPoMessage('');
    } catch (err) {
      console.error('Failed to load purchase orders.', err);
      setPurchaseOrders([]);
      setPoMessage('発注書一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorQuotes = useCallback(async () => {
    try {
      const res = await api<{ items: VendorQuote[] }>('/vendor-quotes');
      setVendorQuotes(res.items || []);
      setQuoteMessage('');
    } catch (err) {
      console.error('Failed to load vendor quotes.', err);
      setVendorQuotes([]);
      setQuoteMessage('仕入見積一覧の取得に失敗しました');
    }
  }, []);

  const loadVendorInvoices = useCallback(async () => {
    try {
      const res = await api<{ items: VendorInvoice[] }>('/vendor-invoices');
      setVendorInvoices(res.items || []);
      setInvoiceMessage('');
    } catch (err) {
      console.error('Failed to load vendor invoices.', err);
      setVendorInvoices([]);
      setInvoiceMessage('仕入請求一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    loadVendors();
    loadPurchaseOrders();
    loadVendorQuotes();
    loadVendorInvoices();
  }, [loadVendors, loadPurchaseOrders, loadVendorQuotes, loadVendorInvoices]);

  const renderVendor = (vendorId: string) => {
    const vendor = vendorMap.get(vendorId);
    return vendor ? `${vendor.code} / ${vendor.name}` : vendorId;
  };

  return (
    <div>
      <h2>仕入/発注</h2>
      {vendorMessage && <p style={{ color: '#dc2626' }}>{vendorMessage}</p>}
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>発注書</h3>
          <button className="button secondary" onClick={loadPurchaseOrders}>
            再読込
          </button>
          {poMessage && <p style={{ color: '#dc2626' }}>{poMessage}</p>}
          <ul className="list">
            {purchaseOrders.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span>{' '}
                {item.poNo || '(draft)'} / {renderVendor(item.vendorId)} /{' '}
                {formatAmount(item.totalAmount, item.currency)}
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  発行日: {formatDate(item.issueDate)} / 納期:{' '}
                  {formatDate(item.dueDate)}
                </div>
              </li>
            ))}
            {purchaseOrders.length === 0 && <li>データなし</li>}
          </ul>
        </div>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>仕入見積</h3>
          <button className="button secondary" onClick={loadVendorQuotes}>
            再読込
          </button>
          {quoteMessage && <p style={{ color: '#dc2626' }}>{quoteMessage}</p>}
          <ul className="list">
            {vendorQuotes.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span>{' '}
                {item.quoteNo || '(no number)'} / {renderVendor(item.vendorId)} /{' '}
                {formatAmount(item.totalAmount, item.currency)}
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  発行日: {formatDate(item.issueDate)}
                </div>
              </li>
            ))}
            {vendorQuotes.length === 0 && <li>データなし</li>}
          </ul>
        </div>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>仕入請求</h3>
          <button className="button secondary" onClick={loadVendorInvoices}>
            再読込
          </button>
          {invoiceMessage && (
            <p style={{ color: '#dc2626' }}>{invoiceMessage}</p>
          )}
          <ul className="list">
            {vendorInvoices.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span>{' '}
                {item.vendorInvoiceNo || '(no number)'} /{' '}
                {renderVendor(item.vendorId)} /{' '}
                {formatAmount(item.totalAmount, item.currency)}
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  受領日: {formatDate(item.receivedDate)} / 支払期限:{' '}
                  {formatDate(item.dueDate)}
                </div>
              </li>
            ))}
            {vendorInvoices.length === 0 && <li>データなし</li>}
          </ul>
        </div>
      </div>
    </div>
  );
};
