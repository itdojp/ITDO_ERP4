import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, EmptyState, Input, Select } from '../ui';

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
  const [listMessage, setListMessage] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
      setIsLoading(true);
      setListMessage('');
      const params = new URLSearchParams();
      if (filters.period) params.set('period', filters.period);
      if (filters.scope) params.set('scope', filters.scope);
      if (filters.projectId) params.set('projectId', filters.projectId);
      const suffix = params.toString() ? `?${params}` : '';
      const res = await api<{ items: PeriodLock[] }>(`/period-locks${suffix}`);
      setItems(res.items || []);
    } catch (err) {
      setItems([]);
      setListMessage('締め一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
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
    if (!window.confirm('この締めを解除しますか？')) return;
    try {
      await api(`/period-locks/${id}`, { method: 'DELETE' });
      await loadLocks();
    } catch (err) {
      setListMessage('締め解除に失敗しました');
    }
  };

  const renderProject = (projectId?: string | null) => {
    if (!projectId) return '-';
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

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
        <div className="row" style={{ alignItems: 'flex-end' }}>
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
            onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
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
          <Button onClick={loadLocks} loading={isLoading}>
            検索
          </Button>
        </div>
        {listMessage && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{listMessage}</Alert>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {items.map((item) => (
          <Card key={item.id} padding="small">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{item.period}</strong> / {item.scope}
              </div>
              <Button
                variant="secondary"
                onClick={() => removeLock(item.id)}
              >
                解除
              </Button>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
              project: {renderProject(item.projectId)}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              closed: {formatDateTime(item.closedAt)} / by:{' '}
              {item.closedBy || '-'}
            </div>
            {item.reason && (
              <div style={{ fontSize: 12, color: '#475569' }}>
                reason: {item.reason}
              </div>
            )}
          </Card>
        ))}
        {items.length === 0 && <EmptyState title="締めがありません" />}
      </div>
    </div>
  );
};
