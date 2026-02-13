import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiResponse, getAuthState } from '../api';
import { navigateToOpen } from '../utils/deepLink';

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

type ChatAckLink = {
  id: string;
  ackRequestId: string;
  messageId: string;
  targetTable: string;
  targetId: string;
  flowType?: string | null;
  actionKey?: string | null;
  templateId?: string | null;
  createdAt: string;
  createdBy?: string | null;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;

type AnnotationInternalRef = {
  kind: string;
  id: string;
  label?: string;
};

type AnnotationEvidence = {
  targetKind: string;
  targetId: string;
  notes?: string | null;
  externalUrls?: string[];
  internalRefs?: AnnotationInternalRef[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type ChatMessagePreview = {
  id: string;
  roomId: string;
  createdAt: string;
  excerpt?: string;
  room?: {
    id?: string;
    type?: string;
    projectId?: string | null;
  };
};

type FilterState = {
  flowType: string;
  status: string;
  projectId: string;
  approverGroupId: string;
  approverUserId: string;
  requesterId: string;
};

type ApprovalActionErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: {
      reason?: string;
      guardFailures?: Array<{
        type?: string;
        reason?: string;
        details?: {
          missingAckRequestIds?: string[];
          requests?: Array<{
            id?: string;
            reason?: string;
            dueAt?: string | null;
            requiredCount?: number;
            ackedCount?: number;
          }>;
        };
      }>;
    };
  };
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

function toSafeExternalHref(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

function resolveAnnotationTarget(
  targetTable: string,
  targetId: string,
): { kind: string; id: string } | null {
  const normalized = targetTable.trim().toLowerCase();
  switch (normalized) {
    case 'estimate':
    case 'estimates':
      return { kind: 'estimate', id: targetId };
    case 'invoice':
    case 'invoices':
      return { kind: 'invoice', id: targetId };
    case 'purchase_order':
    case 'purchase_orders':
      return { kind: 'purchase_order', id: targetId };
    case 'vendor_quote':
    case 'vendor_quotes':
      return { kind: 'vendor_quote', id: targetId };
    case 'vendor_invoice':
    case 'vendor_invoices':
      return { kind: 'vendor_invoice', id: targetId };
    case 'expense':
    case 'expenses':
      return { kind: 'expense', id: targetId };
    case 'project':
    case 'projects':
      return { kind: 'project', id: targetId };
    case 'customer':
    case 'customers':
      return { kind: 'customer', id: targetId };
    case 'vendor':
    case 'vendors':
      return { kind: 'vendor', id: targetId };
    default:
      return null;
  }
}

function buildPolicyDeniedMessage(payload: ApprovalActionErrorPayload) {
  const guardFailures = payload.error?.details?.guardFailures;
  if (!Array.isArray(guardFailures) || guardFailures.length === 0) {
    return '承認ルールにより操作できません';
  }
  const chatAckFailure = guardFailures.find(
    (failure) => failure?.type === 'chat_ack_completed',
  );
  if (!chatAckFailure) {
    return '承認ルールにより操作できません';
  }
  const details = chatAckFailure.details;
  const requests = Array.isArray(details?.requests) ? details.requests : [];
  if (requests.length > 0) {
    const first = requests[0];
    const reason = first?.reason || 'incomplete';
    if (reason === 'expired') {
      return '確認依頼リンクに期限超過の未確認ユーザがいます';
    }
    return '確認依頼リンクで未確認ユーザが残っています';
  }
  const missing = Array.isArray(details?.missingAckRequestIds)
    ? details?.missingAckRequestIds
    : [];
  if (missing.length > 0) {
    return '確認依頼リンクが不足しています（未解決の参照あり）';
  }
  return '確認依頼リンクの完了条件を満たしていません';
}

export const Approvals: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId ?? '';
  const userGroupIds = useMemo(() => auth?.groupIds ?? [], [auth?.groupIds]);
  const userGroupAccountIds = useMemo(
    () => auth?.groupAccountIds ?? [],
    [auth?.groupAccountIds],
  );
  const actorGroupIds = useMemo(
    () => new Set([...userGroupIds, ...userGroupAccountIds]),
    [userGroupIds, userGroupAccountIds],
  );
  const isPrivileged = (auth?.roles ?? []).some((role) =>
    ['admin', 'mgmt', 'exec'].includes(role),
  );
  const canManageAckLinks = (auth?.roles ?? []).some((role) =>
    ['admin', 'mgmt'].includes(role),
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
  const [ackLinkItems, setAckLinkItems] = useState<
    Record<string, ChatAckLink[]>
  >({});
  const [ackLinkLoading, setAckLinkLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [ackLinkErrors, setAckLinkErrors] = useState<Record<string, string>>(
    {},
  );
  const [ackLinkInputs, setAckLinkInputs] = useState<Record<string, string>>(
    {},
  );
  const [ackLinkSaving, setAckLinkSaving] = useState<Record<string, boolean>>(
    {},
  );
  const [evidenceOpen, setEvidenceOpen] = useState<Record<string, boolean>>({});
  const [evidenceLoading, setEvidenceLoading] = useState<
    Record<string, boolean>
  >({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>(
    {},
  );
  const [evidenceItems, setEvidenceItems] = useState<
    Record<string, AnnotationEvidence | null>
  >({});
  const [chatPreviewLoading, setChatPreviewLoading] = useState<
    Record<string, boolean>
  >({});
  const [chatPreviewErrors, setChatPreviewErrors] = useState<
    Record<string, string>
  >({});
  const [chatPreviews, setChatPreviews] = useState<
    Record<string, ChatMessagePreview | null>
  >({});

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
        return actorGroupIds.has(step.approverGroupId);
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

  const setAckLinkLoadingFor = (id: string, isBusy: boolean) => {
    setAckLinkLoading((prev) => ({ ...prev, [id]: isBusy }));
  };

  const actOnApproval = async (id: string, action: 'approve' | 'reject') => {
    try {
      setActionLoading(id, true);
      setMessage(null);
      const res = await apiResponse(`/approval-instances/${id}/act`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          reason: reasons[id]?.trim() || undefined,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as ApprovalActionErrorPayload;
      if (!res.ok) {
        let text =
          action === 'approve' ? '承認に失敗しました' : '却下に失敗しました';
        if (payload.error?.code === 'REASON_REQUIRED') {
          text = '理由入力が必要です（管理者上書き）';
        } else if (payload.error?.code === 'ACTION_POLICY_DENIED') {
          text = buildPolicyDeniedMessage(payload);
        } else if (payload.error?.message) {
          text = payload.error.message;
        }
        setMessage({ text, type: 'error' });
        return;
      }
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

  const extractChatMessageId = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const markdownMatch = trimmed.match(/\(([^)]+)\)/);
    const raw = markdownMatch ? markdownMatch[1] : trimmed;
    const openIndex = raw.indexOf('open?');
    if (openIndex >= 0) {
      const query = raw.slice(openIndex + 5).split('#', 1)[0];
      const params = new URLSearchParams(query);
      if (params.get('kind') === 'chat_message') {
        const id = params.get('id');
        if (id && id.trim()) return id.trim();
      }
    }
    return trimmed;
  };

  const loadAckLinks = useCallback(async (approvalId: string) => {
    try {
      setAckLinkLoadingFor(approvalId, true);
      setAckLinkErrors((prev) => ({ ...prev, [approvalId]: '' }));
      const res = await api<{ items: ChatAckLink[] }>(
        `/chat-ack-links?targetTable=approval_instances&targetId=${approvalId}`,
      );
      setAckLinkItems((prev) => ({
        ...prev,
        [approvalId]: res.items || [],
      }));
    } catch (error) {
      console.error('Failed to load chat ack links.', error);
      setAckLinkItems((prev) => ({ ...prev, [approvalId]: [] }));
      setAckLinkErrors((prev) => ({
        ...prev,
        [approvalId]: '参照リンクの取得に失敗しました',
      }));
    } finally {
      setAckLinkLoadingFor(approvalId, false);
    }
  }, []);

  const createAckLink = useCallback(
    async (approvalId: string) => {
      const input = ackLinkInputs[approvalId] || '';
      const messageId = extractChatMessageId(input);
      if (!messageId) {
        setAckLinkErrors((prev) => ({
          ...prev,
          [approvalId]: '発言URL / Markdown / messageId を入力してください',
        }));
        return;
      }
      try {
        setAckLinkSaving((prev) => ({ ...prev, [approvalId]: true }));
        setAckLinkErrors((prev) => ({ ...prev, [approvalId]: '' }));
        const res = await apiResponse('/chat-ack-links', {
          method: 'POST',
          body: JSON.stringify({
            messageId,
            targetTable: 'approval_instances',
            targetId: approvalId,
          }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string };
          };
          const code = payload?.error?.code;
          const message =
            code === 'DUPLICATE_LINK'
              ? '既に登録済みです'
              : code === 'TARGET_NOT_FOUND'
                ? '対象の承認データが見つかりません'
                : code === 'NOT_FOUND'
                  ? '確認依頼が見つかりません'
                  : '参照リンクの作成に失敗しました';
          setAckLinkErrors((prev) => ({ ...prev, [approvalId]: message }));
          return;
        }
        setAckLinkInputs((prev) => ({ ...prev, [approvalId]: '' }));
        await loadAckLinks(approvalId);
      } catch (error) {
        console.error('Failed to create chat ack link.', error);
        setAckLinkErrors((prev) => ({
          ...prev,
          [approvalId]: '参照リンクの作成に失敗しました',
        }));
      } finally {
        setAckLinkSaving((prev) => ({ ...prev, [approvalId]: false }));
      }
    },
    [ackLinkInputs, loadAckLinks],
  );

  const deleteAckLink = useCallback(
    async (approvalId: string, linkId: string) => {
      if (!window.confirm('参照リンクを削除しますか？')) return;
      try {
        setAckLinkSaving((prev) => ({ ...prev, [approvalId]: true }));
        setAckLinkErrors((prev) => ({ ...prev, [approvalId]: '' }));
        const res = await apiResponse(`/chat-ack-links/${linkId}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          throw new Error(`delete failed: ${res.status}`);
        }
        await loadAckLinks(approvalId);
      } catch (error) {
        console.error('Failed to delete chat ack link.', error);
        setAckLinkErrors((prev) => ({
          ...prev,
          [approvalId]: '参照リンクの削除に失敗しました',
        }));
      } finally {
        setAckLinkSaving((prev) => ({ ...prev, [approvalId]: false }));
      }
    },
    [loadAckLinks],
  );

  const loadEvidence = useCallback(async (item: ApprovalInstance) => {
    const target = resolveAnnotationTarget(item.targetTable, item.targetId);
    if (!target) {
      setEvidenceItems((prev) => ({ ...prev, [item.id]: null }));
      setEvidenceErrors((prev) => ({
        ...prev,
        [item.id]:
          'この承認対象は注釈エビデンス表示の対象外です（対応予定）',
      }));
      return;
    }
    try {
      setEvidenceLoading((prev) => ({ ...prev, [item.id]: true }));
      setEvidenceErrors((prev) => ({ ...prev, [item.id]: '' }));
      const res = await apiResponse(`/annotations/${target.kind}/${target.id}`);
      const payload = (await res.json().catch(() => ({}))) as AnnotationEvidence;
      if (!res.ok) {
        setEvidenceItems((prev) => ({ ...prev, [item.id]: null }));
        setEvidenceErrors((prev) => ({
          ...prev,
          [item.id]: 'エビデンスの取得に失敗しました',
        }));
        return;
      }
      setEvidenceItems((prev) => ({ ...prev, [item.id]: payload }));
    } catch (error) {
      console.error('Failed to load annotation evidence.', error);
      setEvidenceItems((prev) => ({ ...prev, [item.id]: null }));
      setEvidenceErrors((prev) => ({
        ...prev,
        [item.id]: 'エビデンスの取得に失敗しました',
      }));
    } finally {
      setEvidenceLoading((prev) => ({ ...prev, [item.id]: false }));
    }
  }, []);

  const toggleEvidence = useCallback(
    (item: ApprovalInstance) => {
      setEvidenceOpen((prev) => {
        const nextOpen = !prev[item.id];
        if (nextOpen && !evidenceItems[item.id] && !evidenceLoading[item.id]) {
          loadEvidence(item).catch(() => undefined);
        }
        return { ...prev, [item.id]: nextOpen };
      });
    },
    [evidenceItems, evidenceLoading, loadEvidence],
  );

  const loadChatPreview = useCallback(async (messageId: string) => {
    if (!messageId.trim()) return;
    if (chatPreviews[messageId] || chatPreviewLoading[messageId]) return;
    try {
      setChatPreviewLoading((prev) => ({ ...prev, [messageId]: true }));
      setChatPreviewErrors((prev) => ({ ...prev, [messageId]: '' }));
      const res = await apiResponse(`/chat-messages/${messageId}`);
      const payload = (await res.json().catch(() => ({}))) as ChatMessagePreview & {
        error?: { code?: string };
      };
      if (!res.ok) {
        const code = payload?.error?.code;
        const message =
          code === 'FORBIDDEN_PROJECT' ||
          code === 'FORBIDDEN_ROOM_MEMBER' ||
          code === 'FORBIDDEN_EXTERNAL_ROOM'
            ? '権限が不足しているため発言を表示できません'
            : code === 'NOT_FOUND'
              ? '発言が見つかりません'
              : '発言プレビューの取得に失敗しました';
        setChatPreviewErrors((prev) => ({ ...prev, [messageId]: message }));
        return;
      }
      setChatPreviews((prev) => ({ ...prev, [messageId]: payload }));
    } catch (error) {
      console.error('Failed to load chat message preview.', error);
      setChatPreviewErrors((prev) => ({
        ...prev,
        [messageId]: '発言プレビューの取得に失敗しました',
      }));
    } finally {
      setChatPreviewLoading((prev) => ({ ...prev, [messageId]: false }));
    }
  }, [chatPreviewLoading, chatPreviews]);

  useEffect(() => {
    const messageIds = new Set<string>();
    for (const item of items) {
      if (!evidenceOpen[item.id]) continue;
      const evidence = evidenceItems[item.id];
      if (!evidence || !Array.isArray(evidence.internalRefs)) continue;
      for (const ref of evidence.internalRefs) {
        if (ref?.kind !== 'chat_message' || typeof ref?.id !== 'string') {
          continue;
        }
        const id = ref.id.trim();
        if (!id) continue;
        messageIds.add(id);
      }
    }
    for (const messageId of messageIds) {
      loadChatPreview(messageId).catch(() => undefined);
    }
  }, [evidenceItems, evidenceOpen, items, loadChatPreview]);

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
          const ackLinks = ackLinkItems[item.id] || [];
          const ackLoading = ackLinkLoading[item.id] || false;
          const ackError = ackLinkErrors[item.id] || '';
          const ackInput = ackLinkInputs[item.id] || '';
          const ackBusy = ackLinkSaving[item.id] || false;
          const evidenceVisible = evidenceOpen[item.id] || false;
          const evidenceBusy = evidenceLoading[item.id] || false;
          const evidenceError = evidenceErrors[item.id] || '';
          const evidence = evidenceItems[item.id];
          const evidenceRefs = Array.isArray(evidence?.internalRefs)
            ? evidence?.internalRefs
            : [];
          const chatEvidenceRefs = evidenceRefs.filter(
            (ref) => ref.kind === 'chat_message' && typeof ref.id === 'string',
          );
          const externalEvidenceUrls = Array.isArray(evidence?.externalUrls)
            ? evidence?.externalUrls
            : [];
          const evidenceNotes =
            typeof evidence?.notes === 'string' ? evidence.notes.trim() : '';
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
              {canManageAckLinks && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    borderRadius: 8,
                    background: '#f8fafc',
                  }}
                >
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <strong>確認依頼リンク</strong>
                    <button
                      className="button secondary"
                      onClick={() => loadAckLinks(item.id)}
                      disabled={ackLoading}
                    >
                      {ackLoading ? '更新中' : '更新'}
                    </button>
                  </div>
                  {ackError && (
                    <div style={{ marginTop: 6, color: '#dc2626' }}>
                      {ackError}
                    </div>
                  )}
                  <div
                    className="row"
                    style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}
                  >
                    <input
                      type="text"
                      value={ackInput}
                      onChange={(e) =>
                        setAckLinkInputs((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      placeholder="発言URL / Markdown / messageId"
                      style={{ minWidth: 260 }}
                      disabled={ackBusy}
                    />
                    <button
                      className="button"
                      onClick={() => createAckLink(item.id)}
                      disabled={ackBusy}
                    >
                      追加
                    </button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {ackLinks.length === 0 && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        登録済みリンクはありません
                      </div>
                    )}
                    {ackLinks.map((link) => (
                      <div
                        key={link.id}
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          marginTop: 6,
                        }}
                      >
                        <span className="badge">
                          {link.templateId ? 'テンプレ' : '手動'}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          {link.messageId}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          / {formatDateTime(link.createdAt)}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          / {link.flowType || '-'}:{link.actionKey || '-'}
                        </span>
                        <button
                          className="button secondary"
                          onClick={() =>
                            navigateToOpen({
                              kind: 'chat_message',
                              id: link.messageId,
                            })
                          }
                        >
                          開く
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => deleteAckLink(item.id, link.id)}
                          disabled={ackBusy}
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  borderRadius: 8,
                  background: '#f8fafc',
                }}
              >
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <strong>エビデンス（注釈）</strong>
                  <button
                    className="button secondary"
                    onClick={() => toggleEvidence(item)}
                  >
                    {evidenceVisible ? '隠す' : '表示'}
                  </button>
                  {evidence?.updatedAt && (
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      最終更新: {formatDateTime(evidence.updatedAt)}
                      {evidence.updatedBy ? ` / ${evidence.updatedBy}` : ''}
                    </span>
                  )}
                </div>
                {evidenceVisible && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    {evidenceBusy && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        エビデンスを読み込み中...
                      </div>
                    )}
                    {evidenceError && (
                      <div style={{ color: '#dc2626', fontSize: 12 }}>
                        {evidenceError}
                      </div>
                    )}
                    {!evidenceBusy && !evidenceError && (
                      <>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          外部URL: {externalEvidenceUrls.length} 件 / チャット参照:{' '}
                          {chatEvidenceRefs.length} 件
                        </div>
                        {evidenceNotes && (
                          <div style={{ fontSize: 12, color: '#0f172a' }}>
                            メモ: {evidenceNotes}
                          </div>
                        )}
                        {externalEvidenceUrls.length > 0 && (
                          <div style={{ display: 'grid', gap: 4 }}>
                            {externalEvidenceUrls.map((url, index) => {
                              const safeHref = toSafeExternalHref(url);
                              if (!safeHref) {
                                return (
                                  <span
                                    key={`${url}:${index}`}
                                    style={{ fontSize: 12, color: '#0f172a' }}
                                  >
                                    {url}
                                  </span>
                                );
                              }
                              return (
                                <a
                                  key={`${url}:${index}`}
                                  href={safeHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ fontSize: 12, color: '#2563eb' }}
                                >
                                  {url}
                                </a>
                              );
                            })}
                          </div>
                        )}
                        {chatEvidenceRefs.length === 0 &&
                          externalEvidenceUrls.length === 0 &&
                          !evidenceNotes && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              登録済みエビデンスはありません
                            </div>
                          )}
                        {chatEvidenceRefs.map((ref, index) => {
                          const messageId = ref.id;
                          const preview = chatPreviews[messageId];
                          const previewBusy = chatPreviewLoading[messageId];
                          const previewError = chatPreviewErrors[messageId];
                          return (
                            <div
                              key={`${messageId}:${index}`}
                              style={{
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                padding: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                }}
                              >
                                <span className="badge">chat_message</span>
                                <span style={{ fontSize: 12, color: '#64748b' }}>
                                  {ref.label || messageId}
                                </span>
                                <button
                                  className="button secondary"
                                  onClick={() =>
                                    navigateToOpen({
                                      kind: 'chat_message',
                                      id: messageId,
                                    })
                                  }
                                >
                                  開く
                                </button>
                                <button
                                  className="button secondary"
                                  onClick={() =>
                                    loadChatPreview(messageId).catch(
                                      () => undefined,
                                    )
                                  }
                                  disabled={previewBusy}
                                >
                                  {previewBusy ? '取得中' : 'プレビュー'}
                                </button>
                              </div>
                              {previewError && (
                                <div
                                  style={{
                                    marginTop: 6,
                                    color: '#dc2626',
                                    fontSize: 12,
                                  }}
                                >
                                  {previewError}
                                </div>
                              )}
                              {preview && (
                                <div
                                  style={{
                                    marginTop: 6,
                                    fontSize: 12,
                                    color: '#334155',
                                  }}
                                >
                                  <div>
                                    room: {preview.roomId} / 作成:
                                    {formatDateTime(preview.createdAt)}
                                  </div>
                                  <div style={{ marginTop: 4 }}>
                                    {preview.excerpt || '(抜粋なし)'}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
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
