import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Customer = {
  id: string;
  code: string;
  name: string;
  status: string;
  invoiceRegistrationId?: string | null;
  taxRegion?: string | null;
  billingAddress?: string | null;
  externalSource?: string | null;
  externalId?: string | null;
};

type Vendor = {
  id: string;
  code: string;
  name: string;
  status: string;
  bankInfo?: string | null;
  taxRegion?: string | null;
  externalSource?: string | null;
  externalId?: string | null;
};

const emptyCustomer = {
  code: '',
  name: '',
  status: 'active',
  invoiceRegistrationId: '',
  taxRegion: '',
  billingAddress: '',
  externalSource: '',
  externalId: '',
};

const emptyVendor = {
  code: '',
  name: '',
  status: 'active',
  bankInfo: '',
  taxRegion: '',
  externalSource: '',
  externalId: '',
};

const trimValue = (value: string) => value.trim();

const optionalValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const MasterData: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [customerForm, setCustomerForm] = useState(emptyCustomer);
  const [vendorForm, setVendorForm] = useState(emptyVendor);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(
    null,
  );
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [customerMessage, setCustomerMessage] = useState('');
  const [vendorMessage, setVendorMessage] = useState('');

  const customerPayload = useMemo(() => {
    return {
      code: trimValue(customerForm.code),
      name: trimValue(customerForm.name),
      status: trimValue(customerForm.status) || 'active',
      invoiceRegistrationId: optionalValue(customerForm.invoiceRegistrationId),
      taxRegion: optionalValue(customerForm.taxRegion),
      billingAddress: optionalValue(customerForm.billingAddress),
      externalSource: optionalValue(customerForm.externalSource),
      externalId: optionalValue(customerForm.externalId),
    };
  }, [customerForm]);

  const vendorPayload = useMemo(() => {
    return {
      code: trimValue(vendorForm.code),
      name: trimValue(vendorForm.name),
      status: trimValue(vendorForm.status) || 'active',
      bankInfo: optionalValue(vendorForm.bankInfo),
      taxRegion: optionalValue(vendorForm.taxRegion),
      externalSource: optionalValue(vendorForm.externalSource),
      externalId: optionalValue(vendorForm.externalId),
    };
  }, [vendorForm]);

  const loadCustomers = async () => {
    try {
      const res = await api<{ items: Customer[] }>('/customers');
      setCustomers(res.items || []);
    } catch (err) {
      setCustomers([]);
      setCustomerMessage('顧客一覧の取得に失敗しました');
    }
  };

  const loadVendors = async () => {
    try {
      const res = await api<{ items: Vendor[] }>('/vendors');
      setVendors(res.items || []);
    } catch (err) {
      setVendors([]);
      setVendorMessage('業者一覧の取得に失敗しました');
    }
  };

  const saveCustomer = async () => {
    if (!customerPayload.code || !customerPayload.name) {
      setCustomerMessage('コードと名称は必須です');
      return;
    }
    try {
      if (editingCustomerId) {
        await api(`/customers/${editingCustomerId}`, {
          method: 'PATCH',
          body: JSON.stringify(customerPayload),
        });
        setCustomerMessage('顧客を更新しました');
      } else {
        await api('/customers', {
          method: 'POST',
          body: JSON.stringify(customerPayload),
        });
        setCustomerMessage('顧客を追加しました');
      }
      setCustomerForm(emptyCustomer);
      setEditingCustomerId(null);
      loadCustomers();
    } catch (err) {
      setCustomerMessage('顧客の保存に失敗しました');
    }
  };

  const saveVendor = async () => {
    if (!vendorPayload.code || !vendorPayload.name) {
      setVendorMessage('コードと名称は必須です');
      return;
    }
    try {
      if (editingVendorId) {
        await api(`/vendors/${editingVendorId}`, {
          method: 'PATCH',
          body: JSON.stringify(vendorPayload),
        });
        setVendorMessage('業者を更新しました');
      } else {
        await api('/vendors', {
          method: 'POST',
          body: JSON.stringify(vendorPayload),
        });
        setVendorMessage('業者を追加しました');
      }
      setVendorForm(emptyVendor);
      setEditingVendorId(null);
      loadVendors();
    } catch (err) {
      setVendorMessage('業者の保存に失敗しました');
    }
  };

  const editCustomer = (item: Customer) => {
    setEditingCustomerId(item.id);
    setCustomerForm({
      code: item.code || '',
      name: item.name || '',
      status: item.status || 'active',
      invoiceRegistrationId: item.invoiceRegistrationId || '',
      taxRegion: item.taxRegion || '',
      billingAddress: item.billingAddress || '',
      externalSource: item.externalSource || '',
      externalId: item.externalId || '',
    });
  };

  const editVendor = (item: Vendor) => {
    setEditingVendorId(item.id);
    setVendorForm({
      code: item.code || '',
      name: item.name || '',
      status: item.status || 'active',
      bankInfo: item.bankInfo || '',
      taxRegion: item.taxRegion || '',
      externalSource: item.externalSource || '',
      externalId: item.externalId || '',
    });
  };

  const resetCustomer = () => {
    setCustomerForm(emptyCustomer);
    setEditingCustomerId(null);
  };

  const resetVendor = () => {
    setVendorForm(emptyVendor);
    setEditingVendorId(null);
  };

  useEffect(() => {
    loadCustomers();
    loadVendors();
  }, []);

  return (
    <div>
      <h2>顧客/業者マスタ</h2>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>顧客</h3>
          <div className="row">
            <input
              type="text"
              placeholder="コード"
              value={customerForm.code}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, code: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="名称"
              value={customerForm.name}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, name: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="ステータス"
              value={customerForm.status}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, status: e.target.value })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="適格請求書番号"
              value={customerForm.invoiceRegistrationId}
              onChange={(e) =>
                setCustomerForm({
                  ...customerForm,
                  invoiceRegistrationId: e.target.value,
                })
              }
            />
            <input
              type="text"
              placeholder="税区分"
              value={customerForm.taxRegion}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, taxRegion: e.target.value })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="請求先住所"
              value={customerForm.billingAddress}
              onChange={(e) =>
                setCustomerForm({
                  ...customerForm,
                  billingAddress: e.target.value,
                })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="外部ソース"
              value={customerForm.externalSource}
              onChange={(e) =>
                setCustomerForm({
                  ...customerForm,
                  externalSource: e.target.value,
                })
              }
            />
            <input
              type="text"
              placeholder="外部ID"
              value={customerForm.externalId}
              onChange={(e) =>
                setCustomerForm({
                  ...customerForm,
                  externalId: e.target.value,
                })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={saveCustomer}>
              {editingCustomerId ? '更新' : '追加'}
            </button>
            <button className="button secondary" onClick={resetCustomer}>
              クリア
            </button>
            <button className="button secondary" onClick={loadCustomers}>
              再読込
            </button>
          </div>
          {customerMessage && <p>{customerMessage}</p>}
          <ul className="list">
            {customers.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span> {item.code} /{' '}
                {item.name}
                <button
                  className="button secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => editCustomer(item)}
                >
                  編集
                </button>
              </li>
            ))}
            {customers.length === 0 && <li>データなし</li>}
          </ul>
        </div>
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>業者</h3>
          <div className="row">
            <input
              type="text"
              placeholder="コード"
              value={vendorForm.code}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, code: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="名称"
              value={vendorForm.name}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, name: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="ステータス"
              value={vendorForm.status}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, status: e.target.value })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="振込情報"
              value={vendorForm.bankInfo}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, bankInfo: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="税区分"
              value={vendorForm.taxRegion}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, taxRegion: e.target.value })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="外部ソース"
              value={vendorForm.externalSource}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, externalSource: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="外部ID"
              value={vendorForm.externalId}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, externalId: e.target.value })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={saveVendor}>
              {editingVendorId ? '更新' : '追加'}
            </button>
            <button className="button secondary" onClick={resetVendor}>
              クリア
            </button>
            <button className="button secondary" onClick={loadVendors}>
              再読込
            </button>
          </div>
          {vendorMessage && <p>{vendorMessage}</p>}
          <ul className="list">
            {vendors.map((item) => (
              <li key={item.id}>
                <span className="badge">{item.status}</span> {item.code} /{' '}
                {item.name}
                <button
                  className="button secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => editVendor(item)}
                >
                  編集
                </button>
              </li>
            ))}
            {vendors.length === 0 && <li>データなし</li>}
          </ul>
        </div>
      </div>
    </div>
  );
};
