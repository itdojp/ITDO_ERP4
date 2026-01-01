import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type Contact = {
  id: string;
  customerId?: string | null;
  vendorId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isPrimary: boolean;
};

type ContactOwnerType = 'customer' | 'vendor';

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

const emptyContact = {
  name: '',
  email: '',
  phone: '',
  role: '',
  isPrimary: false,
};

const trimValue = (value: string) => value.trim();

const optionalValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const statusOptions = [
  { value: 'active', label: '有効' },
  { value: 'inactive', label: '無効' },
];

const errorDetail = (err: unknown) => {
  if (err instanceof Error && err.message) {
    return ` (${err.message})`;
  }
  return '';
};

const hasContactDraft = (form: typeof emptyContact) =>
  Boolean(
    form.name.trim() ||
      form.email.trim() ||
      form.phone.trim() ||
      form.role.trim() ||
      form.isPrimary,
  );

export const MasterData: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [customerForm, setCustomerForm] = useState(emptyCustomer);
  const [vendorForm, setVendorForm] = useState(emptyVendor);
  const [contactForm, setContactForm] = useState(emptyContact);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(
    null,
  );
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [customerMessage, setCustomerMessage] = useState('');
  const [vendorMessage, setVendorMessage] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactOwnerType, setContactOwnerType] =
    useState<ContactOwnerType>('customer');
  const [contactOwnerId, setContactOwnerId] = useState('');

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

  const contactPayload = useMemo(() => {
    return {
      name: trimValue(contactForm.name),
      email: optionalValue(contactForm.email),
      phone: optionalValue(contactForm.phone),
      role: optionalValue(contactForm.role),
      isPrimary: contactForm.isPrimary,
    };
  }, [contactForm]);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api<{ items: Customer[] }>('/customers');
      setCustomers(res.items || []);
    } catch (err) {
      console.error('Failed to load customers.', err);
      setCustomers([]);
      setCustomerMessage(`顧客一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      const res = await api<{ items: Vendor[] }>('/vendors');
      setVendors(res.items || []);
    } catch (err) {
      console.error('Failed to load vendors.', err);
      setVendors([]);
      setVendorMessage(`業者一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    if (!contactOwnerId) {
      setContacts([]);
      return;
    }
    const query =
      contactOwnerType === 'customer'
        ? `customerId=${contactOwnerId}`
        : `vendorId=${contactOwnerId}`;
    try {
      const res = await api<{ items: Contact[] }>(`/contacts?${query}`);
      setContacts(res.items || []);
    } catch (err) {
      console.error('Failed to load contacts.', err);
      setContactMessage(`連絡先一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, [contactOwnerId, contactOwnerType]);

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
      console.error('Failed to save customer.', err);
      setCustomerMessage(`顧客の保存に失敗しました${errorDetail(err)}`);
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
      console.error('Failed to save vendor.', err);
      setVendorMessage(`業者の保存に失敗しました${errorDetail(err)}`);
    }
  };

  const saveContact = async () => {
    if (!contactOwnerId) {
      setContactMessage('顧客または業者を選択してください');
      return;
    }
    if (!contactPayload.name) {
      setContactMessage('氏名は必須です');
      return;
    }
    const ownerPayload =
      contactOwnerType === 'customer'
        ? { customerId: contactOwnerId }
        : { vendorId: contactOwnerId };
    try {
      if (editingContactId) {
        await api(`/contacts/${editingContactId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...contactPayload,
            ...ownerPayload,
          }),
        });
        setContactMessage('連絡先を更新しました');
      } else {
        await api('/contacts', {
          method: 'POST',
          body: JSON.stringify({
            ...contactPayload,
            ...ownerPayload,
          }),
        });
        setContactMessage('連絡先を追加しました');
      }
      setContactForm(emptyContact);
      setEditingContactId(null);
      loadContacts();
    } catch (err) {
      console.error('Failed to save contact.', err);
      setContactMessage(`連絡先の保存に失敗しました${errorDetail(err)}`);
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

  const editContact = (item: Contact) => {
    const hasCustomer = Boolean(item.customerId);
    const hasVendor = Boolean(item.vendorId);
    if (!hasCustomer && !hasVendor) {
      console.error('Contact has no owner.', item);
      setContactMessage(
        'この連絡先には紐づく顧客または業者がありません。管理者にお問い合わせください。',
      );
      return;
    }
    const ownerType: ContactOwnerType = hasCustomer ? 'customer' : 'vendor';
    const ownerId = (hasCustomer ? item.customerId : item.vendorId) ?? '';
    if (ownerType !== contactOwnerType) {
      setContactOwnerType(ownerType);
    }
    if (ownerId !== contactOwnerId) {
      setContactOwnerId(ownerId);
    }
    setEditingContactId(item.id);
    setContactForm({
      name: item.name || '',
      email: item.email || '',
      phone: item.phone || '',
      role: item.role || '',
      isPrimary: Boolean(item.isPrimary),
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

  const resetContact = () => {
    setContactForm(emptyContact);
    setEditingContactId(null);
  };

  useEffect(() => {
    loadCustomers();
    loadVendors();
  }, [loadCustomers, loadVendors]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

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
              aria-label="顧客コード"
              value={customerForm.code}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, code: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="名称"
              aria-label="顧客名称"
              value={customerForm.name}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, name: e.target.value })
              }
            />
            <select
              aria-label="顧客ステータス"
              value={customerForm.status}
              onChange={(e) =>
                setCustomerForm({ ...customerForm, status: e.target.value })
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="適格請求書番号"
              aria-label="顧客適格請求書番号"
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
              aria-label="顧客税区分"
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
              aria-label="顧客請求先住所"
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
              aria-label="顧客外部ソース"
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
              aria-label="顧客外部ID"
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
              aria-label="業者コード"
              value={vendorForm.code}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, code: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="名称"
              aria-label="業者名称"
              value={vendorForm.name}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, name: e.target.value })
              }
            />
            <select
              aria-label="業者ステータス"
              value={vendorForm.status}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, status: e.target.value })
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="振込情報"
              aria-label="業者振込情報"
              value={vendorForm.bankInfo}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, bankInfo: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="税区分"
              aria-label="業者税区分"
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
              aria-label="業者外部ソース"
              value={vendorForm.externalSource}
              onChange={(e) =>
                setVendorForm({ ...vendorForm, externalSource: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="外部ID"
              aria-label="業者外部ID"
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
        <div style={{ minWidth: 320, flex: 1 }}>
          <h3>連絡先</h3>
          <div className="row">
            <select
              aria-label="連絡先の紐付け種別"
              value={contactOwnerType}
              disabled={Boolean(editingContactId)}
              onChange={(e) => {
                const nextType =
                  e.target.value === 'vendor' ? 'vendor' : 'customer';
                if (nextType === contactOwnerType) {
                  return;
                }
                if (
                  hasContactDraft(contactForm) &&
                  !window.confirm(
                    '入力中の連絡先情報が破棄されます。よろしいですか？',
                  )
                ) {
                  return;
                }
                setContactOwnerType(nextType);
                setContactOwnerId('');
                setContacts([]);
                resetContact();
              }}
            >
              <option value="customer">顧客</option>
              <option value="vendor">業者</option>
            </select>
            <select
              aria-label="連絡先の紐付け先"
              value={contactOwnerId}
              disabled={Boolean(editingContactId)}
              onChange={(e) => {
                const nextOwnerId = e.target.value;
                if (nextOwnerId === contactOwnerId) {
                  return;
                }
                if (
                  hasContactDraft(contactForm) &&
                  !window.confirm(
                    '入力中の連絡先情報が破棄されます。よろしいですか？',
                  )
                ) {
                  return;
                }
                setContactOwnerId(nextOwnerId);
                resetContact();
              }}
            >
              <option value="">選択してください</option>
              {(contactOwnerType === 'customer' ? customers : vendors).map(
                (item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} / {item.name}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="氏名"
              aria-label="連絡先氏名"
              value={contactForm.name}
              onChange={(e) =>
                setContactForm({ ...contactForm, name: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="メール"
              aria-label="連絡先メール"
              value={contactForm.email}
              onChange={(e) =>
                setContactForm({ ...contactForm, email: e.target.value })
              }
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="電話"
              aria-label="連絡先電話"
              value={contactForm.phone}
              onChange={(e) =>
                setContactForm({ ...contactForm, phone: e.target.value })
              }
            />
            <input
              type="text"
              placeholder="役割"
              aria-label="連絡先役割"
              value={contactForm.role}
              onChange={(e) =>
                setContactForm({ ...contactForm, role: e.target.value })
              }
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                aria-label="主担当"
                checked={contactForm.isPrimary}
                onChange={(e) =>
                  setContactForm({
                    ...contactForm,
                    isPrimary: e.target.checked,
                  })
                }
              />
              主担当
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={saveContact}>
              {editingContactId ? '更新' : '追加'}
            </button>
            <button className="button secondary" onClick={resetContact}>
              クリア
            </button>
            <button className="button secondary" onClick={loadContacts}>
              再読込
            </button>
          </div>
          {contactMessage && <p>{contactMessage}</p>}
          <ul className="list">
            {contacts.map((item) => (
              <li key={item.id}>
                {item.isPrimary && <span className="badge">主担当</span>}{' '}
                {item.name}
                {item.role && ` / ${item.role}`}
                {item.email && ` / ${item.email}`}
                {item.phone && ` / ${item.phone}`}
                <button
                  className="button secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => editContact(item)}
                >
                  編集
                </button>
              </li>
            ))}
            {contacts.length === 0 && <li>データなし</li>}
          </ul>
        </div>
      </div>
    </div>
  );
};
