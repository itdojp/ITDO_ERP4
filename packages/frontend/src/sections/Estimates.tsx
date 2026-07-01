import React, { useCallback, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { useProjects } from '../hooks/useProjects';
import { EstimateDetail } from './EstimateDetail';
import { Button, Dialog } from '../ui';
import {
  WorkflowMetricGrid,
  WorkflowPageHeader,
  WorkflowPanel,
} from './workflowUx';

interface Estimate {
  id: string;
  estimateNo?: string;
  projectId: string;
  totalAmount: unknown;
  currency: string;
  status: string;
  validUntil?: string | null;
  notes?: string | null;
  lines?: { description: string; quantity: unknown; unitPrice: unknown }[];
}

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId ?? '',
  totalAmount: 100000,
  currency: 'JPY',
  validUntil: '',
  notes: '',
});

const formatEstimateAmount = (value: unknown, currency: string) => {
  const amount = Number(value);
  const formattedAmount = Number.isFinite(amount)
    ? amount.toLocaleString()
    : String(value ?? '-');
  return `${formattedAmount} ${currency}`;
};

const isSendableEstimate = (status: string) =>
  status === 'approved' || status === 'sent';

export const Estimates: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [items, setItems] = useState<Estimate[]>([]);
  const handleProjectSelect = useCallback((projectId: string) => {
    setForm((prev) => ({ ...prev, projectId }));
  }, []);
  const { projects, projectMessage } = useProjects({
    selectedProjectId: form.projectId,
    onSelect: handleProjectSelect,
  });
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [annotationTarget, setAnnotationTarget] = useState<{
    kind: 'estimate';
    id: string;
    projectId: string;
    title: string;
  } | null>(null);
  const [message, setMessage] = useState('');

  const updateItem = useCallback((updated: Estimate) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelected((prev) => (prev?.id === updated.id ? updated : prev));
  }, []);

  const create = async () => {
    if (!form.projectId) {
      setMessage('案件を選択してください');
      return;
    }
    try {
      const res = await api<{ number: string; estimate: Estimate }>(
        `/projects/${form.projectId}/estimates`,
        {
          method: 'POST',
          body: JSON.stringify({
            totalAmount: form.totalAmount,
            currency: form.currency,
            validUntil: form.validUntil || undefined,
            notes: form.notes || undefined,
            lines: [
              {
                description: '作業費',
                quantity: 1,
                unitPrice: form.totalAmount,
              },
            ],
          }),
        },
      );
      setMessage('作成しました');
      setItems((prev) => [...prev, res.estimate]);
    } catch (e) {
      setMessage('作成に失敗');
    }
  };

  const load = async () => {
    if (!form.projectId) {
      setMessage('案件を選択してください');
      return;
    }
    try {
      const res = await api<{ items: Estimate[] }>(
        `/projects/${form.projectId}/estimates`,
      );
      setItems(res.items);
      setMessage('読み込みました');
    } catch (e) {
      setMessage('読み込みに失敗');
    }
  };

  const submit = async (id: string) => {
    try {
      const updated = await api<Estimate>(`/estimates/${id}/submit`, {
        method: 'POST',
      });
      updateItem(updated);
      setMessage('承認依頼しました');
    } catch (e) {
      setMessage('承認依頼に失敗');
    }
  };

  const send = async (id: string) => {
    try {
      const updated = await api<Estimate>(`/estimates/${id}/send`, {
        method: 'POST',
      });
      updateItem(updated);
      setMessage('送信しました');
    } catch (e) {
      setMessage('送信失敗');
    }
  };

  const buildApproval = (status: string) => {
    if (status === 'pending_exec')
      return { step: 2, total: 2, status: 'pending_exec' };
    if (status === 'pending_qa')
      return { step: 1, total: 2, status: 'pending_qa' };
    if (status === 'approved' || status === 'sent')
      return { step: 2, total: 2, status: 'approved' };
    return { step: 0, total: 2, status: 'draft' };
  };

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const selectedProjectLabel = form.projectId
    ? renderProject(form.projectId)
    : '未選択';
  const totalEstimateAmount = items.reduce((sum, item) => {
    const amount = Number(item.totalAmount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  const draftCount = items.filter((item) => item.status === 'draft').length;
  const sendableCount = items.filter((item) =>
    isSendableEstimate(item.status),
  ).length;

  return (
    <div>
      <WorkflowPageHeader
        title="見積"
        description="案件別の見積作成、承認依頼、送信状態、注釈確認を同じ画面で追跡します。"
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void load();
            }}
          >
            最新の見積を取得
          </Button>
        }
      />
      <WorkflowMetricGrid
        ariaLabel="見積判断サマリー"
        items={[
          {
            id: 'estimate-project',
            label: '対象案件',
            value: selectedProjectLabel,
            helper: '作成・読込対象の案件',
            tone: form.projectId ? 'success' : 'warning',
          },
          {
            id: 'estimate-count',
            label: '表示中の見積',
            value: `${items.length}件`,
            helper: `ドラフト ${draftCount}件`,
          },
          {
            id: 'estimate-total',
            label: '見積合計',
            value: `${totalEstimateAmount.toLocaleString()} ${form.currency}`,
            helper: '現在読み込み済みの合計',
          },
          {
            id: 'estimate-sendable',
            label: '送信可能',
            value: `${sendableCount}件`,
            helper: 'approved / sent の見積',
            tone: sendableCount > 0 ? 'success' : 'default',
          },
        ]}
      />
      <WorkflowPanel
        title="見積作成"
        description="案件・金額・有効期限・備考をまとめて入力し、作成後すぐ一覧で状態を確認できます。"
      >
        <div
          className="row workflow-control-grid"
          style={{ gap: 8, flexWrap: 'wrap' }}
        >
          <label>
            案件
            <select
              aria-label="案件選択"
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">案件を選択</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} / {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            金額
            <input
              type="number"
              value={form.totalAmount}
              onChange={(e) =>
                setForm({ ...form, totalAmount: Number(e.target.value) })
              }
              placeholder="金額"
            />
          </label>
          <label>
            通貨
            <select
              aria-label="通貨"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="JPY">JPY</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            有効期限
            <input
              aria-label="有効期限"
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </label>
          <label>
            備考
            <input
              aria-label="備考"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="備考"
            />
          </label>
          <button className="button" onClick={create}>
            作成
          </button>
          <button className="button secondary" onClick={load}>
            読み込み
          </button>
        </div>
      </WorkflowPanel>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      {message && <p>{message}</p>}
      <WorkflowPanel
        title="見積一覧"
        description="承認依頼・詳細確認・送信操作を見積単位で実行します。"
      >
        <ul className="list">
          {items.map((d) => (
            <li key={d.id}>
              <span className="badge">{d.status}</span>{' '}
              {d.estimateNo || '(draft)'} / {renderProject(d.projectId)} /{' '}
              {formatEstimateAmount(d.totalAmount, d.currency)}
              <div>
                <button
                  className="button secondary"
                  style={{ marginRight: 8 }}
                  onClick={() => setSelected(d)}
                >
                  詳細
                </button>
                <button
                  className="button secondary"
                  style={{ marginRight: 8 }}
                  onClick={() => submit(d.id)}
                  disabled={d.status !== 'draft'}
                >
                  承認依頼
                </button>
                <button
                  className="button"
                  onClick={() => send(d.id)}
                  disabled={!isSendableEstimate(d.status)}
                >
                  送信 (Stub)
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li>データなし</li>}
        </ul>
      </WorkflowPanel>
      {selected && (
        <WorkflowPanel title="選択中の見積詳細">
          <EstimateDetail
            {...selected}
            approval={buildApproval(selected.status)}
            onSend={() => send(selected.id)}
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              className="button secondary"
              onClick={() =>
                setAnnotationTarget({
                  kind: 'estimate',
                  id: selected.id,
                  projectId: selected.projectId,
                  title: `見積: ${selected.estimateNo || '(draft)'}`,
                })
              }
            >
              注釈
            </button>
            <button
              className="button secondary"
              onClick={() => setSelected(null)}
            >
              閉じる
            </button>
          </div>
        </WorkflowPanel>
      )}
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
