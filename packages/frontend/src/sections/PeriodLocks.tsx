import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  ConfirmActionDialog,
  CrudList,
  DataTable,
  FilterBar,
  Input,
  Select,
  StatusBadge,
  erpStatusDictionary,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

type PeriodLock = {
  id: string;
  period: string;
  scope: 'global' | 'project';
  projectId?: string | null;
  reason?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
};

type FilterState = {
  period: string;
  scope: string;
  projectId: string;
};

type FormState = {
  period: string;
  scope: 'global' | 'project';
  projectId: string;
  reason: string;
};

const PERIOD_FORMAT_REGEX = /^\d{4}-\d{2}$/;
const getCurrentPeriod = () => new Date().toISOString().slice(0, 7);

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const PeriodLocks: React.FC = () => {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [items, setItems] = useState<PeriodLock[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    period: '',
    scope: '',
    projectId: '',
  });
  const [form, setForm] = useState<FormState>({
    period: getCurrentPeriod(),
    scope: 'project',
    projectId: '',
    reason: '',
  });
  const [listStatus, setListStatus] = useState<
    'idle' | 'loading' | 'error' | 'success'
  >('idle');
  const [listError, setListError] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [targetLock, setTargetLock] = useState<PeriodLock | null>(null);

  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  useEffect(() => {
    api<{ items: ProjectOption[] }>('/projects')
      .then((res) => setProjects(res.items || []))
      .catch(() => setProjects([]));
  }, []);

  const loadLocks = async () => {
    try {
      setListStatus('loading');
      setListError('');
      const params = new URLSearchParams();
      if (filters.period) params.set('period', filters.period);
      if (filters.scope) params.set('scope', filters.scope);
      if (filters.projectId) params.set('projectId', filters.projectId);
      const suffix = params.toString() ? `?${params}` : '';
      const res = await api<{ items: PeriodLock[] }>(`/period-locks${suffix}`);
      setItems(res.items || []);
      setListStatus('success');
    } catch (err) {
      setItems([]);
      setListStatus('error');
      setListError('締め一覧の取得に失敗しました');
    }
  };

  const validateForm = () => {
    const period = form.period;
    if (!PERIOD_FORMAT_REGEX.test(period)) {
      return 'period は YYYY-MM 形式で入力してください';
    }
    const month = Number(period.slice(5, 7));
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return 'period は有効な月 (01-12) を指定してください';
    }
    if (!form.scope) {
      return 'scope を選択してください';
    }
    if (form.scope === 'project' && !form.projectId.trim()) {
      return 'project を選択してください';
    }
    return '';
  };

  const createLock = async () => {
    const error = validateForm();
    if (error) {
      setFormMessage(error);
      return;
    }
    try {
      setIsSaving(true);
      setFormMessage('');
      await api('/period-locks', {
        method: 'POST',
        body: JSON.stringify({
          period: form.period,
          scope: form.scope,
          projectId: form.scope === 'project' ? form.projectId : undefined,
          reason: form.reason.trim() || undefined,
        }),
      });
      await loadLocks();
    } catch (err) {
      setFormMessage('締め登録に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const removeLock = async (id: string) => {
    try {
      await api(`/period-locks/${id}`, { method: 'DELETE' });
      await loadLocks();
    } catch (err) {
      setListError('締め解除に失敗しました');
      setListStatus('error');
    }
  };

  const renderProject = useCallback(
    (projectId?: string | null) => {
      if (!projectId) return '-';
      const project = projectMap.get(projectId);
      return project ? `${project.code} / ${project.name}` : projectId;
    },
    [projectMap],
  );

  const rows = useMemo<DataTableRow[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        period: item.period,
        scope: item.scope,
        project: renderProject(item.projectId),
        closedAt: formatDateTime(item.closedAt),
        closedBy: item.closedBy || '-',
        reason: item.reason || '-',
      })),
    [items, renderProject],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'period', header: '期間' },
      {
        key: 'scope',
        header: 'スコープ',
        cell: (row) => (
          <StatusBadge
            status={String(row.scope || '')}
            dictionary={{
              ...erpStatusDictionary,
              global: { label: 'global', tone: 'info' },
              project: { label: 'project', tone: 'success' },
            }}
            size="sm"
          />
        ),
      },
      { key: 'project', header: '案件' },
      { key: 'closedAt', header: '締め日時' },
      { key: 'closedBy', header: '実行者' },
      { key: 'reason', header: '理由' },
    ],
    [],
  );

  const listContent = (() => {
    if (listStatus === 'idle' || listStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="締め一覧を取得中" />;
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '締め一覧の取得に失敗しました',
            detail: listError,
            onRetry: () => {
              void loadLocks();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: '締めがありません',
            description: '条件を変更して検索してください',
          }}
        />
      );
    }
    return (
      <DataTable
        columns={columns}
        rows={rows}
        rowActions={[
          {
            key: 'unlock',
            label: '解除',
            onSelect: (row) => {
              const item = items.find((entry) => entry.id === row.id);
              if (!item) return;
              setTargetLock(item);
            },
          },
        ]}
      />
    );
  })();

  return (
    <div>
      <h2>期間締め</h2>
      <Card padding="small">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Input
            label="period (YYYY-MM)"
            value={form.period}
            onChange={(e) => setForm({ ...form, period: e.target.value })}
          />
          <Select
            label="scope"
            value={form.scope}
            onChange={(e) =>
              setForm({
                ...form,
                scope: e.target.value as FormState['scope'],
              })
            }
          >
            <option value="global">global</option>
            <option value="project">project</option>
          </Select>
          <Select
            label="project"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            disabled={form.scope !== 'project'}
            placeholder="案件を選択"
          >
            <option value="">案件を選択</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} / {project.name}
              </option>
            ))}
          </Select>
          <Input
            label="reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="任意"
          />
          <Button onClick={createLock} loading={isSaving}>
            締め登録
          </Button>
        </div>
        {formMessage && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{formMessage}</Alert>
          </div>
        )}
      </Card>

      <Card padding="small">
        {listError && (
          <div style={{ marginBottom: 8 }}>
            <Alert variant="error">{listError}</Alert>
          </div>
        )}
        <CrudList
          title="締め一覧"
          description="条件で絞り込み、対象期間の締めを解除できます。"
          filters={
            <FilterBar
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setFilters({ period: '', scope: '', projectId: '' })
                    }
                  >
                    条件クリア
                  </Button>
                  <Button
                    onClick={loadLocks}
                    loading={listStatus === 'loading'}
                  >
                    検索
                  </Button>
                </div>
              }
            >
              <div
                className="row"
                style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}
              >
                <Input
                  label="period"
                  value={filters.period}
                  onChange={(e) =>
                    setFilters({ ...filters, period: e.target.value })
                  }
                  placeholder="YYYY-MM"
                />
                <Select
                  label="scope"
                  value={filters.scope}
                  onChange={(e) =>
                    setFilters({ ...filters, scope: e.target.value })
                  }
                >
                  <option value="">すべて</option>
                  <option value="global">global</option>
                  <option value="project">project</option>
                </Select>
                <Select
                  label="project"
                  value={filters.projectId}
                  onChange={(e) =>
                    setFilters({ ...filters, projectId: e.target.value })
                  }
                >
                  <option value="">すべて</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code} / {project.name}
                    </option>
                  ))}
                </Select>
              </div>
            </FilterBar>
          }
          table={listContent}
        />
      </Card>
      <ConfirmActionDialog
        open={Boolean(targetLock)}
        title="期間締めを解除しますか？"
        description={
          targetLock
            ? `対象: ${targetLock.period} / ${targetLock.scope}`
            : undefined
        }
        tone="danger"
        confirmLabel="解除"
        cancelLabel="キャンセル"
        onConfirm={() => {
          if (!targetLock) return;
          void removeLock(targetLock.id);
          setTargetLock(null);
        }}
        onCancel={() => setTargetLock(null)}
      />
    </div>
  );
};
