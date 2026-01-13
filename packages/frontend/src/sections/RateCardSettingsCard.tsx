import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

type RateCard = {
  id: string;
  projectId?: string | null;
  role: string;
  workType?: string | null;
  unitPrice: unknown;
  validFrom: string;
  validTo?: string | null;
  currency: string;
};

const buildQuery = (params: Record<string, string | undefined>) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    qs.set(key, trimmed);
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  return value.slice(0, 10);
};

export const RateCardSettingsCard: React.FC = () => {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const [message, setMessage] = useState('');
  const [items, setItems] = useState<RateCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterIncludeGlobal, setFilterIncludeGlobal] = useState(true);
  const [filterActiveOnly, setFilterActiveOnly] = useState(true);
  const [filterWorkType, setFilterWorkType] = useState('');

  const [formProjectId, setFormProjectId] = useState('');
  const [role, setRole] = useState('default');
  const [workType, setWorkType] = useState('通常');
  const [unitPrice, setUnitPrice] = useState('6000');
  const [currency, setCurrency] = useState('JPY');
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [validTo, setValidTo] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: ProjectOption[] }>('/projects');
      setProjects(res.items || []);
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
    }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const qs = buildQuery({
        projectId: filterProjectId || undefined,
        includeGlobal: filterIncludeGlobal ? '1' : '0',
        active: filterActiveOnly ? '1' : '0',
        workType: filterWorkType || undefined,
      });
      const res = await api<{ items: RateCard[] }>(`/rate-cards${qs}`);
      setItems(res.items || []);
      setMessage('取得しました');
    } catch (err) {
      console.error('Failed to load rate cards.', err);
      setItems([]);
      setMessage('取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [filterActiveOnly, filterIncludeGlobal, filterProjectId, filterWorkType]);

  const create = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      await api<RateCard>('/rate-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: formProjectId || null,
          role,
          workType: workType.trim() ? workType.trim() : null,
          unitPrice: Number(unitPrice),
          currency,
          validFrom,
          validTo: validTo.trim() ? validTo.trim() : null,
        }),
      });
      setMessage('作成しました');
      await load();
    } catch (err) {
      console.error('Failed to create rate card.', err);
      setMessage('作成に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [
    currency,
    formProjectId,
    load,
    role,
    unitPrice,
    validFrom,
    validTo,
    workType,
  ]);

  const disable = useCallback(
    async (id: string) => {
      if (!window.confirm('この単価を無効化しますか？')) return;
      setIsLoading(true);
      setMessage('');
      try {
        await api(`/rate-cards/${id}/disable`, { method: 'POST' });
        setMessage('無効化しました');
        await load();
      } catch (err) {
        console.error('Failed to disable rate card.', err);
        setMessage('無効化に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [load],
  );

  const renderProject = (projectId?: string | null) => {
    if (!projectId) return '(global)';
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  useEffect(() => {
    loadProjects().catch(() => undefined);
  }, [loadProjects]);

  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>単価（RateCard）</strong>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
        工数原価（minutes × unitPrice）の計算に使用します
      </div>

      {message && <div style={{ marginTop: 8 }}>{message}</div>}

      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <select
          aria-label="案件フィルタ"
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value)}
          disabled={isLoading}
        >
          <option value="">(all projects)</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={filterIncludeGlobal}
            onChange={(e) => setFilterIncludeGlobal(e.target.checked)}
            disabled={isLoading}
          />
          global を含む
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={filterActiveOnly}
            onChange={(e) => setFilterActiveOnly(e.target.checked)}
            disabled={isLoading}
          />
          有効のみ
        </label>
        <input
          aria-label="workTypeフィルタ"
          value={filterWorkType}
          onChange={(e) => setFilterWorkType(e.target.value)}
          placeholder="workType（任意）"
          disabled={isLoading}
        />
        <button
          className="button secondary"
          onClick={load}
          disabled={isLoading}
        >
          取得
        </button>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <strong>追加</strong>
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <select
            aria-label="案件"
            value={formProjectId}
            onChange={(e) => setFormProjectId(e.target.value)}
            disabled={isLoading}
          >
            <option value="">(global)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} / {project.name}
              </option>
            ))}
          </select>
          <input
            aria-label="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="role"
            disabled={isLoading}
          />
          <input
            aria-label="workType"
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            placeholder="workType（空でデフォルト）"
            disabled={isLoading}
          />
          <input
            aria-label="unitPrice"
            type="number"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="unitPrice"
            disabled={isLoading}
          />
          <select
            aria-label="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={isLoading}
          >
            <option value="JPY">JPY</option>
            <option value="USD">USD</option>
          </select>
          <input
            aria-label="validFrom"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            disabled={isLoading}
          />
          <input
            aria-label="validTo"
            type="date"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            disabled={isLoading}
          />
          <button className="button" onClick={create} disabled={isLoading}>
            追加
          </button>
        </div>
      </div>

      <ul className="list" style={{ marginTop: 12 }}>
        {items.map((item) => (
          <li key={item.id}>
            <span className="badge">{renderProject(item.projectId)}</span>{' '}
            {item.workType || '(default)'} / {String(item.unitPrice)}{' '}
            {item.currency} / {formatDate(item.validFrom)}〜
            {formatDate(item.validTo)}
            <div style={{ marginTop: 6 }}>
              <button
                className="button secondary"
                onClick={() => disable(item.id)}
                disabled={isLoading}
              >
                無効化
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
    </div>
  );
};
