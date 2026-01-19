import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { InvoiceDetail } from './InvoiceDetail';
import { useProjects } from '../hooks/useProjects';
import { Alert, Button, Card, EmptyState, Input, Select, Toast } from '../ui';

interface Invoice {
  id: string;
  invoiceNo?: string;
  projectId: string;
  totalAmount: number;
  status: string;
  lines?: { description: string; quantity: number; unitPrice: number }[];
}

type InvoiceFromTimeEntriesResponse = {
  invoice: Invoice;
  meta?: { timeEntryCount?: number };
};

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId || 'demo-project',
  totalAmount: 100000,
});

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const Invoices: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [timeFrom, setTimeFrom] = useState(() => {
    const now = new Date();
    let fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    if (
      fromDate.getFullYear() === now.getFullYear() &&
      fromDate.getMonth() === now.getMonth() &&
      fromDate.getDate() === now.getDate()
    ) {
      fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    }
    return formatDateInput(fromDate);
  });
  const [timeTo, setTimeTo] = useState(() => formatDateInput(new Date()));
  const [timeUnitPrice, setTimeUnitPrice] = useState(10000);
  const [items, setItems] = useState<Invoice[]>([]);
  const handleProjectSelect = useCallback(
    (projectId: string) => {
      setForm((prev) => ({ ...prev, projectId }));
    },
    [setForm],
  );
  const { projects, projectMessage } = useProjects({
    selectedProjectId: form.projectId,
    onSelect: handleProjectSelect,
  });
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [message, setMessage] = useState<
    | {
        text: string;
        type: 'success' | 'error' | 'info';
      }
    | null
  >(null);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const create = async () => {
    if (form.totalAmount <= 0) {
      setMessage({ text: '金額は1円以上で入力してください', type: 'error' });
      return;
    }
    try {
      const res = await api<Invoice>(`/projects/${form.projectId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          totalAmount: form.totalAmount,
          currency: 'JPY',
          lines: [
            { description: '作業費', quantity: 1, unitPrice: form.totalAmount },
          ],
        }),
      });
      setMessage({ text: '作成しました', type: 'success' });
      setItems((prev) => [...prev, res]);
    } catch (e) {
      setMessage({ text: '作成に失敗しました', type: 'error' });
    }
  };

  const load = async () => {
    try {
      const res = await api<{ items: Invoice[] }>(
        `/projects/${form.projectId}/invoices`,
      );
      setItems(res.items);
      setMessage({ text: '読み込みました', type: 'success' });
    } catch (e) {
      setMessage({ text: '読み込みに失敗しました', type: 'error' });
    }
  };

  const createFromTimeEntries = async () => {
    try {
      const res = await api<InvoiceFromTimeEntriesResponse>(
        `/projects/${form.projectId}/invoices/from-time-entries`,
        {
          method: 'POST',
          body: JSON.stringify({
            from: timeFrom,
            to: timeTo,
            unitPrice: timeUnitPrice,
            currency: 'JPY',
          }),
        },
      );
      setMessage({
        text: `工数${res.meta?.timeEntryCount ?? 0}件からドラフトを作成しました`,
        type: 'success',
      });
      setItems((prev) => [res.invoice, ...prev]);
    } catch (e) {
      setMessage({ text: '工数からの作成に失敗しました', type: 'error' });
    }
  };

  const releaseTimeEntries = async (id: string) => {
    try {
      const res = await api<{ released: number }>(
        `/invoices/${id}/release-time-entries`,
        { method: 'POST' },
      );
      setMessage({
        text: `工数リンクを解除しました (${res.released}件)`,
        type: 'success',
      });
    } catch (e) {
      setMessage({ text: '工数リンクの解除に失敗しました', type: 'error' });
    }
  };

  const send = async (id: string) => {
    try {
      await api(`/invoices/${id}/send`, { method: 'POST' });
      setMessage({ text: '送信しました', type: 'success' });
    } catch (e) {
      setMessage({ text: '送信に失敗しました', type: 'error' });
    }
  };

  const buildApproval = (status: string) => {
    if (status === 'pending_exec')
      return { step: 2, total: 2, status: 'pending_exec' };
    if (status === 'pending_qa')
      return { step: 1, total: 2, status: 'pending_qa' };
    if (status === 'approved' || status === 'sent' || status === 'paid')
      return { step: 2, total: 2, status: 'approved' };
    return { step: 0, total: 2, status: 'draft' };
  };

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  return (
    <div>
      <h2>請求</h2>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <Select
          label="案件"
          aria-label="案件選択"
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          placeholder="案件を選択"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </Select>
        <Input
          label="金額"
          aria-label="金額"
          type="number"
          value={form.totalAmount}
          onChange={(e) =>
            setForm({ ...form, totalAmount: Number(e.target.value) })
          }
          placeholder="金額"
          min={0}
        />
        <Button onClick={create}>作成</Button>
        <Button variant="secondary" onClick={load}>
          読み込み
        </Button>
      </div>
      <Card padding="small" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>工数から請求ドラフト作成</h3>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <Input
            label="工数集計開始日"
            aria-label="工数集計開始日"
            type="date"
            value={timeFrom}
            onChange={(e) => setTimeFrom(e.target.value)}
          />
          <Input
            label="工数集計終了日"
            aria-label="工数集計終了日"
            type="date"
            value={timeTo}
            onChange={(e) => setTimeTo(e.target.value)}
          />
          <Input
            label="単価(円/時)"
            aria-label="請求単価"
            type="number"
            value={timeUnitPrice}
            onChange={(e) => setTimeUnitPrice(Number(e.target.value))}
            min={1}
          />
          <Button onClick={createFromTimeEntries}>工数から作成</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <Alert variant="warning">
            対象工数は請求に紐づけられ、解除するまで編集/付け替えできません。
          </Alert>
        </div>
      </Card>
      {projectMessage && (
        <div style={{ marginTop: 12 }}>
          <Alert variant="error">{projectMessage}</Alert>
        </div>
      )}
      {message && (
        <div style={{ marginTop: 12 }}>
          <Toast
            variant={message.type}
            title={message.type === 'error' ? 'エラー' : '完了'}
            description={message.text}
            dismissible
            onClose={() => setMessage(null)}
          />
        </div>
      )}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {items.map((d) => (
          <Card key={d.id} padding="small">
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <span className="badge">{d.status}</span>
              <span>{d.invoiceNo || '(draft)'}</span>
              <span>/ {renderProject(d.projectId)}</span>
              <span>/ ¥{(d.totalAmount || 0).toLocaleString()}</span>
            </div>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <Button variant="secondary" onClick={() => setSelected(d)}>
                詳細
              </Button>
              <Button onClick={() => send(d.id)}>送信 (Stub)</Button>
            </div>
          </Card>
        ))}
        {items.length === 0 && <EmptyState title="データなし" />}
      </div>
      {selected && (
        <Card padding="small" style={{ marginTop: 12 }}>
          <InvoiceDetail
            {...selected}
            approval={buildApproval(selected.status)}
            onSend={() => send(selected.id)}
          />
          {selected.status === 'draft' && (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="secondary"
                onClick={() => releaseTimeEntries(selected.id)}
              >
                工数リンク解除
              </Button>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              閉じる
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
