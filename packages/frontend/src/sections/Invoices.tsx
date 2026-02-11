import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { InvoiceDetail } from './InvoiceDetail';
import { useProjects } from '../hooks/useProjects';
import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  ConfirmActionDialog,
  CrudList,
  DataTable,
  Drawer,
  FilterBar,
  Dialog,
  Input,
  Select,
  StatusBadge,
  Toast,
  erpStatusDictionary,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';

interface Invoice {
  id: string;
  invoiceNo?: string;
  projectId: string;
  totalAmount: number;
  status: string;
  paidAt?: string | null;
  paidBy?: string | null;
  lines?: { description: string; quantity: number; unitPrice: number }[];
}

type InvoiceFromTimeEntriesResponse = {
  invoice: Invoice;
  meta?: { timeEntryCount?: number };
};

type ListStatus = 'idle' | 'loading' | 'error' | 'success';

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
  const canMarkPaid = Boolean(
    auth?.roles?.some((role) => role === 'admin' || role === 'mgmt'),
  );
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
  const [listStatus, setListStatus] = useState<ListStatus>('idle');
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
  const [annotationTarget, setAnnotationTarget] = useState<{
    kind: 'invoice';
    id: string;
    projectId: string;
    title: string;
  } | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = useState<Invoice | null>(null);

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

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      setListStatus('loading');
      setListError('');
      try {
        const res = await api<{ items: Invoice[] }>(
          `/projects/${form.projectId}/invoices`,
        );
        setItems(res.items || []);
        setListStatus('success');
        if (!options?.silent) {
          setMessage({ text: '読み込みました', type: 'success' });
        }
      } catch (e) {
        setListStatus('error');
        setListError('請求一覧の取得に失敗しました');
        if (!options?.silent) {
          setMessage({ text: '読み込みに失敗しました', type: 'error' });
        }
      }
    },
    [form.projectId],
  );

  useEffect(() => {
    void load({ silent: true });
    // form.projectId が変わったら対象案件の請求一覧を再取得する。
  }, [load]);

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

  const markPaid = async (id: string) => {
    if (!canMarkPaid) return;
    try {
      const res = await api<Invoice>(`/invoices/${id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setItems((prev) => prev.map((item) => (item.id === id ? res : item)));
      setSelected((prev) => (prev && prev.id === id ? res : prev));
      setMessage({ text: '入金を確認しました', type: 'success' });
    } catch (e) {
      setMessage({ text: '入金確認に失敗しました', type: 'error' });
    }
  };

  const requestMarkPaid = (id: string) => {
    if (!canMarkPaid) return;
    const target = items.find((item) => item.id === id);
    if (!target) return;
    setMarkPaidTarget(target);
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

  const renderProject = useCallback(
    (projectId: string) => {
      const project = projectMap.get(projectId);
      return project ? `${project.code} / ${project.name}` : projectId;
    },
    [projectMap],
  );

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.status)))
        .filter(Boolean)
        .sort(),
    [items],
  );

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!needle) return true;
      const target = [
        item.invoiceNo || '(draft)',
        renderProject(item.projectId),
        item.status,
        `${item.totalAmount || 0}`,
      ]
        .join(' ')
        .toLowerCase();
      return target.includes(needle);
    });
  }, [items, renderProject, search, statusFilter]);

  const tableRows = useMemo<DataTableRow[]>(
    () =>
      filteredItems.map((item) => ({
        id: item.id,
        invoiceNo: item.invoiceNo || '(draft)',
        project: renderProject(item.projectId),
        status: item.status,
        totalAmount: `¥${(item.totalAmount || 0).toLocaleString()}`,
        paidAt: item.paidAt || '-',
      })),
    [filteredItems, renderProject],
  );

  const tableColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'invoiceNo', header: '請求番号' },
      { key: 'project', header: '案件' },
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
      { key: 'paidAt', header: '入金日' },
    ],
    [],
  );

  const listContent = (() => {
    if (listStatus === 'loading' || listStatus === 'idle') {
      return (
        <AsyncStatePanel state="loading" loadingText="請求一覧を読み込み中" />
      );
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '請求一覧の取得に失敗しました',
            detail: listError,
            onRetry: () => {
              void load();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (tableRows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title:
              items.length === 0
                ? '請求データがありません'
                : '条件に一致する請求がありません',
            description:
              items.length === 0
                ? '「作成」または「工数から作成」で請求を登録してください'
                : '検索条件を変更してください',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={tableColumns}
        rows={tableRows}
        rowActions={[
          {
            key: 'detail',
            label: '詳細',
            onSelect: (row: DataTableRow) => {
              const target = items.find((item) => item.id === row.id);
              if (!target) return;
              setSelected(target);
            },
          },
          {
            key: 'send',
            label: '送信',
            onSelect: (row: DataTableRow) => {
              void send(row.id);
            },
          },
          {
            key: 'release',
            label: '工数リンク解除',
            onSelect: (row: DataTableRow) => {
              const target = items.find((item) => item.id === row.id);
              if (!target || target.status !== 'draft') {
                setMessage({
                  text: '工数リンク解除は draft の請求のみ実行できます',
                  type: 'info',
                });
                return;
              }
              void releaseTimeEntries(row.id);
            },
          },
          ...(canMarkPaid
            ? [
                {
                  key: 'mark-paid',
                  label: '入金確認',
                  onSelect: (row: DataTableRow) => {
                    requestMarkPaid(row.id);
                  },
                },
              ]
            : []),
        ]}
      />
    );
  })();

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
        <Button
          variant="secondary"
          onClick={() => {
            void load();
          }}
        >
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
      <div style={{ marginTop: 12 }}>
        <CrudList
          title="一覧"
          description="検索・状態絞り込み・行アクションで運用できます。"
          filters={
            <FilterBar
              actions={
                <Button
                  variant="ghost"
                  onClick={() => {
                    void load();
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
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="請求番号 / 案件 / 状態で検索"
                  aria-label="請求検索"
                />
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="請求状態フィルタ"
                >
                  <option value="all">状態: 全て</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
                {(search || statusFilter !== 'all') && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                    }}
                  >
                    条件クリア
                  </Button>
                )}
              </div>
            </FilterBar>
          }
          table={listContent}
        />
      </div>
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={
          selected ? `請求詳細: ${selected.invoiceNo || '(draft)'}` : '請求詳細'
        }
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              閉じる
            </Button>
          </div>
        }
      >
        {selected && (
          <div style={{ display: 'grid', gap: 12 }}>
            <InvoiceDetail
              {...selected}
              approval={buildApproval(selected.status)}
              onSend={() => send(selected.id)}
              onMarkPaid={() => requestMarkPaid(selected.id)}
              canMarkPaid={canMarkPaid}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                onClick={() =>
                  setAnnotationTarget({
                    kind: 'invoice',
                    id: selected.id,
                    projectId: selected.projectId,
                    title: `請求: ${selected.invoiceNo || '(draft)'}`,
                  })
                }
              >
                注釈
              </Button>
              {selected.status === 'draft' && (
                <Button
                  variant="secondary"
                  onClick={() => releaseTimeEntries(selected.id)}
                >
                  工数リンク解除
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>
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
      <ConfirmActionDialog
        open={Boolean(markPaidTarget)}
        title="入金確認を実行しますか？"
        description={
          markPaidTarget
            ? `対象請求: ${markPaidTarget.invoiceNo || '(draft)'}`
            : undefined
        }
        tone="default"
        confirmLabel="入金確認"
        cancelLabel="キャンセル"
        onConfirm={() => {
          if (!markPaidTarget) return;
          void markPaid(markPaidTarget.id);
          setMarkPaidTarget(null);
        }}
        onCancel={() => setMarkPaidTarget(null)}
      />
    </div>
  );
};
