import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

type ApprovalStep = {
  id: string;
  stepOrder: number;
  approverGroupId?: string | null;
  approverUserId?: string | null;
  status: string;
  actedBy?: string | null;
  actedAt?: string | null;
};

type ApprovalRule = {
  id: string;
  name?: string | null;
};

type ApprovalInstance = {
  id: string;
  flowType: string;
  targetTable: string;
  targetId: string;
  projectId?: string | null;
  status: string;
  currentStep?: number | null;
  createdAt?: string | null;
  createdBy?: string | null;
  steps: ApprovalStep[];
  rule?: ApprovalRule | null;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;

type FilterState = {
  flowType: string;
  status: string;
  projectId: string;
  approverGroupId: string;
  approverUserId: string;
  requesterId: string;
};

const flowTypeOptions = [
  { value: '', label: 'すべて' },
  { value: 'estimate', label: '見積' },
  { value: 'invoice', label: '請求' },
  { value: 'purchase_order', label: '発注' },
  { value: 'vendor_quote', label: '仕入見積' },
  { value: 'vendor_invoice', label: '仕入請求' },
  { value: 'expense', label: '経費' },
  { value: 'leave', label: '休暇' },
  { value: 'time', label: '工数' },
];

const statusOptions = [
  { value: '', label: 'すべて' },
  { value: 'draft', label: 'draft' },
  { value: 'pending_qa', label: 'pending_qa' },
  { value: 'pending_exec', label: 'pending_exec' },
  { value: 'approved', label: 'approved' },
  { value: 'rejected', label: 'rejected' },
  { value: 'sent', label: 'sent' },
  { value: 'paid', label: 'paid' },
  { value: 'cancelled', label: 'cancelled' },
  { value: 'received', label: 'received' },
  { value: 'acknowledged', label: 'acknowledged' },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 10)} ${date
    .toISOString()
    .slice(11, 19)}`;
};

export const Approvals: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId ?? '';
  const userGroupIds = auth?.groupIds ?? [];
  const isPrivileged = (auth?.roles ?? []).some((role) =>
    ['admin', 'mgmt', 'exec'].includes(role),
  );
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectMessage, setProjectMessage] = useState('');
  const [items, setItems] = useState<ApprovalInstance[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    flowType: '',
    status: 'pending_qa',
    projectId: '',
    approverGroupId: '',
    approverUserId: '',
    requesterId: '',
  });
  const [message, setMessage] = useState<MessageState>(null);
  const [listMessage, setListMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionState, setActionState] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const projectMap = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project]));
  }, [projects]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: ProjectOption[] }>('/projects');
      setProjects(res.items || []);
      setProjectMessage('');
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setProjectMessage('案件一覧の取得に失敗しました');
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.flowType) params.set('flowType', filters.flowType);
    if (filters.status) params.set('status', filters.status);
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.approverGroupId)
      params.set('approverGroupId', filters.approverGroupId.trim());
    if (filters.approverUserId)
      params.set('approverUserId', filters.approverUserId.trim());
    if (filters.requesterId)
      params.set('requesterId', filters.requesterId.trim());
    try {
      setIsLoading(true);
      setListMessage('');
      const query = params.toString();
      const res = await api<{ items: ApprovalInstance[] }>(
        `/approval-instances${query ? `?${query}` : ''}`,
      );
      setItems(res.items || []);
    } catch (err) {
      console.error('Failed to load approvals.', err);
      setItems([]);
      setListMessage('承認一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const renderProject = (projectId?: string | null) => {
    if (!projectId) return '-';
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const canActOnItem = (item: ApprovalInstance) => {
    if (!isPrivileged) return false;
    if (item.currentStep === null || item.currentStep === undefined) {
      return false;
    }
    const currentSteps = item.steps.filter(
      (step) =>
        step.stepOrder === item.currentStep && step.status === 'pending_qa',
    );
    if (!currentSteps.length) return false;
    return currentSteps.some((step) => {
      if (step.approverUserId) return step.approverUserId === userId;
      if (step.approverGroupId) {
        return userGroupIds.includes(step.approverGroupId);
      }
      return true;
    });
  };

  const updateReason = (id: string, value: string) => {
    setReasons((prev) => ({ ...prev, [id]: value }));
  };

  const setActionLoading = (id: string, isBusy: boolean) => {
    setActionState((prev) => ({ ...prev, [id]: isBusy }));
  };

  const actOnApproval = async (id: string, action: 'approve' | 'reject') => {
    try {
      setActionLoading(id, true);
      setMessage(null);
      await api(`/approval-instances/${id}/act`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          reason: reasons[id]?.trim() || undefined,
        }),
      });
      setMessage({
        text: action === 'approve' ? '承認しました' : '却下しました',
        type: 'success',
      });
      loadApprovals();
    } catch (err) {
      console.error('Approval action failed.', err);
      setMessage({
        text:
          action === 'approve' ? '承認に失敗しました' : '却下に失敗しました',
        type: 'error',
      });
    } finally {
      setActionLoading(id, false);
    }
  };

  const formatStep = (step: ApprovalStep) => {
    const target = step.approverUserId || step.approverGroupId || '-';
    return `#${step.stepOrder + 1} ${target} (${step.status})`;
  };

  return (
    <div>
      <h2>承認一覧</h2>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select
            value={filters.flowType}
            onChange={(e) =>
              setFilters({ ...filters, flowType: e.target.value })
            }
          >
            {flowTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={filters.projectId}
            onChange={(e) =>
              setFilters({ ...filters, projectId: e.target.value })
            }
          >
            <option value="">案件: すべて</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} / {project.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={filters.approverGroupId}
            onChange={(e) =>
              setFilters({ ...filters, approverGroupId: e.target.value })
            }
            placeholder="承認グループID"
          />
          <input
            type="text"
            value={filters.approverUserId}
            onChange={(e) =>
              setFilters({ ...filters, approverUserId: e.target.value })
            }
            placeholder="承認者ID"
          />
          <input
            type="text"
            value={filters.requesterId}
            onChange={(e) =>
              setFilters({ ...filters, requesterId: e.target.value })
            }
            placeholder="起案者ID"
          />
          <button
            className="button secondary"
            onClick={loadApprovals}
            disabled={isLoading}
          >
            {isLoading ? '読み込み中' : '再読込'}
          </button>
        </div>
      </div>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      {listMessage && <p style={{ color: '#dc2626' }}>{listMessage}</p>}
      {message && (
        <p
          style={{
            color: message.type === 'error' ? '#dc2626' : '#16a34a',
            marginBottom: 8,
          }}
        >
          {message.text}
        </p>
      )}
      <ul className="list">
        {items.map((item) => {
          const isActionable =
            item.status === 'pending_qa' || item.status === 'pending_exec';
          const canAct = isActionable && canActOnItem(item);
          const busy = actionState[item.id];
          return (
            <li key={item.id}>
              <div style={{ fontWeight: 600 }}>
                <span className="badge">{item.status}</span> {item.flowType} /{' '}
                {item.targetTable}:{item.targetId}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                案件: {renderProject(item.projectId)} / 起案:{' '}
                {item.createdBy || '-'}/ 作成: {formatDateTime(item.createdAt)}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                ルール: {item.rule?.name || item.rule?.id || '-'} / ステップ:{' '}
                {item.currentStep ?? '-'} / {item.steps.length}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                承認者: {item.steps.map(formatStep).join(' / ') || '-'}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  value={reasons[item.id] || ''}
                  onChange={(e) => updateReason(item.id, e.target.value)}
                  placeholder="却下理由 (任意)"
                  style={{ minWidth: 200 }}
                  disabled={!canAct || busy}
                />
                <button
                  className="button"
                  onClick={() => actOnApproval(item.id, 'approve')}
                  disabled={!canAct || busy}
                >
                  承認
                </button>
                <button
                  className="button secondary"
                  onClick={() => actOnApproval(item.id, 'reject')}
                  disabled={!canAct || busy}
                >
                  却下
                </button>
                {isActionable && !canAct && (
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    承認対象外
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li>データなし</li>}
      </ul>
    </div>
  );
};
