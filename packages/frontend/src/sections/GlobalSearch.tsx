import React, { useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type ProjectResult = {
  id: string;
  code: string;
  name: string;
  status?: string | null;
};

type ProjectRef = {
  code?: string | null;
  name?: string | null;
};

type InvoiceResult = {
  id: string;
  invoiceNo: string;
  status: string;
  totalAmount: unknown;
  currency: string;
  projectId: string;
  project?: ProjectRef | null;
};

type EstimateResult = {
  id: string;
  status: string;
  totalAmount: unknown;
  currency: string;
  projectId: string;
  notes?: string | null;
  project?: ProjectRef | null;
};

type ExpenseResult = {
  id: string;
  category: string;
  amount: unknown;
  currency: string;
  incurredOn: string;
  projectId: string;
  project?: ProjectRef | null;
};

type TimeEntryResult = {
  id: string;
  userId: string;
  workDate: string;
  minutes: number;
  workType?: string | null;
  location?: string | null;
  notes?: string | null;
  status: string;
  projectId: string;
  project?: ProjectRef | null;
};

type PurchaseOrderResult = {
  id: string;
  poNo: string;
  status: string;
  totalAmount: unknown;
  currency: string;
  projectId: string;
  project?: ProjectRef | null;
  vendor?: { name?: string | null } | null;
};

type VendorQuoteResult = {
  id: string;
  quoteNo?: string | null;
  status: string;
  totalAmount: unknown;
  currency: string;
  projectId: string;
  project?: ProjectRef | null;
  vendor?: { name?: string | null } | null;
};

type VendorInvoiceResult = {
  id: string;
  vendorInvoiceNo?: string | null;
  status: string;
  totalAmount: unknown;
  currency: string;
  projectId: string;
  project?: ProjectRef | null;
  vendor?: { name?: string | null } | null;
};

type ErpSearchResponse = {
  query: string;
  projects: ProjectResult[];
  invoices: InvoiceResult[];
  estimates: EstimateResult[];
  expenses: ExpenseResult[];
  timeEntries: TimeEntryResult[];
  purchaseOrders: PurchaseOrderResult[];
  vendorQuotes: VendorQuoteResult[];
  vendorInvoices: VendorInvoiceResult[];
};

type ChatRoom = {
  id: string;
  type: string;
  name: string;
  projectId?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
};

type ChatMessageResult = {
  id: string;
  roomId: string;
  userId: string;
  body: string;
  createdAt: string;
  room: ChatRoom;
};

function buildExcerpt(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function formatProjectLabel(project?: ProjectRef | null, projectId?: string) {
  if (project?.code && project?.name)
    return `${project.code} / ${project.name}`;
  if (project?.code) return project.code;
  if (project?.name) return project.name;
  return projectId || 'N/A';
}

function formatRoomLabel(room: ChatRoom, currentUserId: string) {
  if (room.type === 'project') {
    if (room.projectCode && room.projectName) {
      return `${room.projectCode} / ${room.projectName}`;
    }
    if (room.projectCode) return room.projectCode;
    return room.name;
  }
  if (room.type !== 'dm') return room.name;
  const parts = room.name.startsWith('dm:')
    ? room.name.slice(3).split(':')
    : [];
  if (parts.length >= 2) {
    const [a, b] = parts;
    if (a === currentUserId) return b;
    if (b === currentUserId) return a;
    return `${a} / ${b}`;
  }
  return room.name;
}

function openChatTarget(message: ChatMessageResult) {
  if (message.room.type === 'project' && message.room.projectId) {
    window.dispatchEvent(
      new CustomEvent('erp4_open_project_chat', {
        detail: { projectId: message.room.projectId },
      }),
    );
    return;
  }
  window.dispatchEvent(
    new CustomEvent('erp4_open_room_chat', {
      detail: { roomId: message.roomId },
    }),
  );
}

export const GlobalSearch: React.FC = () => {
  const auth = getAuthState();
  const currentUserId = auth?.userId || 'demo-user';
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [erpResult, setErpResult] = useState<ErpSearchResponse | null>(null);
  const [chatItems, setChatItems] = useState<ChatMessageResult[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2;

  const counts = useMemo(() => {
    const erp = erpResult;
    return {
      projects: erp?.projects.length ?? 0,
      invoices: erp?.invoices.length ?? 0,
      estimates: erp?.estimates.length ?? 0,
      expenses: erp?.expenses.length ?? 0,
      timeEntries: erp?.timeEntries.length ?? 0,
      purchaseOrders: erp?.purchaseOrders.length ?? 0,
      vendorQuotes: erp?.vendorQuotes.length ?? 0,
      vendorInvoices: erp?.vendorInvoices.length ?? 0,
      chat: chatItems.length,
    };
  }, [erpResult, chatItems.length]);

  const runSearch = async () => {
    if (!canSearch) {
      setMessage('検索語は2文字以上で入力してください');
      return;
    }
    try {
      setIsLoading(true);
      setMessage('');
      const params = new URLSearchParams();
      params.set('q', trimmed);
      params.set('limit', String(limit));

      const [erp, chat] = await Promise.all([
        api<ErpSearchResponse>(`/search?${params.toString()}`),
        api<{ items?: ChatMessageResult[] }>(
          `/chat-messages/search?${params.toString()}`,
        ),
      ]);
      setErpResult(erp);
      setChatItems(Array.isArray(chat.items) ? chat.items : []);
    } catch (err) {
      console.error('Failed to run global search.', err);
      setMessage('検索に失敗しました');
      setErpResult(null);
      setChatItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2>検索（ERP横断）</h2>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label>
          検索語
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="keyword"
          />
        </label>
        <label>
          取得件数/種別
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            min={1}
            max={50}
            style={{ width: 100 }}
          />
        </label>
        <button
          className="button secondary"
          onClick={runSearch}
          disabled={isLoading}
        >
          検索
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setQuery('');
            setErpResult(null);
            setChatItems([]);
            setMessage('');
          }}
          disabled={isLoading}
        >
          クリア
        </button>
      </div>
      {message && (
        <div style={{ color: '#dc2626', marginTop: 6 }}>{message}</div>
      )}

      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span className="badge">Projects {counts.projects}</span>
        <span className="badge">Invoices {counts.invoices}</span>
        <span className="badge">Estimates {counts.estimates}</span>
        <span className="badge">Expenses {counts.expenses}</span>
        <span className="badge">Time {counts.timeEntries}</span>
        <span className="badge">PO {counts.purchaseOrders}</span>
        <span className="badge">VQ {counts.vendorQuotes}</span>
        <span className="badge">VI {counts.vendorInvoices}</span>
        <span className="badge">Chat {counts.chat}</span>
      </div>

      {isLoading && <div style={{ marginTop: 8 }}>検索中...</div>}

      {!isLoading && erpResult && (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <div>
            <strong>Projects</strong>
            <ul className="list" style={{ marginTop: 6 }}>
              {erpResult.projects.map((p) => (
                <li key={p.id} className="card" style={{ padding: 10 }}>
                  {p.code} / {p.name} <span className="badge">{p.status}</span>
                </li>
              ))}
              {erpResult.projects.length === 0 && (
                <li className="card" style={{ padding: 10 }}>
                  なし
                </li>
              )}
            </ul>
          </div>

          <div>
            <strong>Invoices</strong>
            <ul className="list" style={{ marginTop: 6 }}>
              {erpResult.invoices.map((inv) => (
                <li key={inv.id} className="card" style={{ padding: 10 }}>
                  <div>
                    <strong>{inv.invoiceNo}</strong>{' '}
                    <span className="badge">{inv.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    {formatProjectLabel(inv.project, inv.projectId)} /{' '}
                    {String(inv.totalAmount)} {inv.currency}
                  </div>
                </li>
              ))}
              {erpResult.invoices.length === 0 && (
                <li className="card" style={{ padding: 10 }}>
                  なし
                </li>
              )}
            </ul>
          </div>

          <div>
            <strong>Estimates</strong>
            <ul className="list" style={{ marginTop: 6 }}>
              {erpResult.estimates.map((est) => (
                <li key={est.id} className="card" style={{ padding: 10 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>{est.id}</strong>{' '}
                      <span className="badge">{est.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      {String(est.totalAmount)} {est.currency}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    {formatProjectLabel(est.project, est.projectId)}
                  </div>
                  {est.notes && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      {buildExcerpt(est.notes)}
                    </div>
                  )}
                </li>
              ))}
              {erpResult.estimates.length === 0 && (
                <li className="card" style={{ padding: 10 }}>
                  なし
                </li>
              )}
            </ul>
          </div>

          <div>
            <strong>Expenses</strong>
            <ul className="list" style={{ marginTop: 6 }}>
              {erpResult.expenses.map((exp) => (
                <li key={exp.id} className="card" style={{ padding: 10 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>{exp.category}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      {String(exp.amount)} {exp.currency}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    {formatProjectLabel(exp.project, exp.projectId)} /{' '}
                    {exp.incurredOn?.slice(0, 10)}
                  </div>
                </li>
              ))}
              {erpResult.expenses.length === 0 && (
                <li className="card" style={{ padding: 10 }}>
                  なし
                </li>
              )}
            </ul>
          </div>

          <div>
            <strong>Time Entries</strong>
            <ul className="list" style={{ marginTop: 6 }}>
              {erpResult.timeEntries.map((t) => (
                <li key={t.id} className="card" style={{ padding: 10 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>{t.userId}</strong>{' '}
                      <span className="badge">{t.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      {t.minutes}m
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    {formatProjectLabel(t.project, t.projectId)} /{' '}
                    {t.workDate?.slice(0, 10)}
                  </div>
                  {(t.notes || t.workType || t.location) && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      {buildExcerpt(
                        [t.workType, t.location, t.notes]
                          .filter(Boolean)
                          .join(' / '),
                      )}
                    </div>
                  )}
                </li>
              ))}
              {erpResult.timeEntries.length === 0 && (
                <li className="card" style={{ padding: 10 }}>
                  なし
                </li>
              )}
            </ul>
          </div>

          <div>
            <strong>Chat</strong>
            <ul className="list" style={{ marginTop: 6 }}>
              {chatItems.map((item) => (
                <li key={item.id} className="card" style={{ padding: 10 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>
                        {formatRoomLabel(item.room, currentUserId)}
                      </strong>
                      <div
                        style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                      >
                        {new Date(item.createdAt).toLocaleString()} /{' '}
                        {item.userId}
                      </div>
                      <div
                        style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                      >
                        {buildExcerpt(item.body)}
                      </div>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => openChatTarget(item)}
                    >
                      開く
                    </button>
                  </div>
                </li>
              ))}
              {chatItems.length === 0 && (
                <li className="card" style={{ padding: 10 }}>
                  なし
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
