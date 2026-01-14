import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  parentId?: string | null;
  customerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string | null;
  planHours?: number | null;
  budgetCost?: number | null;
};

type Customer = {
  id: string;
  code: string;
  name: string;
};

type ProjectMemberRole = 'member' | 'leader';

type ProjectMember = {
  id: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt?: string;
  updatedAt?: string;
};

type ProjectMemberForm = {
  userId: string;
  role: ProjectMemberRole;
};

type ProjectMemberCandidate = {
  userId: string;
  displayName?: string | null;
  department?: string | null;
};

type ProjectMemberBulkResult = {
  added: number;
  skipped: number;
  failed: number;
  failures?: Array<{ userId: string | null; reason: string }>;
};

type DueDateRule = {
  type: 'periodEndPlusOffset';
  offsetDays: number;
};

type RecurringProjectTemplate = {
  id: string;
  projectId: string;
  frequency?: string | null;
  nextRunAt?: string | null;
  timezone?: string | null;
  defaultAmount?: number | string | null;
  defaultCurrency?: string | null;
  defaultTaxRate?: number | string | null;
  defaultTerms?: string | null;
  defaultMilestoneName?: string | null;
  billUpon?: string | null;
  dueDateRule?: DueDateRule | null;
  shouldGenerateEstimate?: boolean | null;
  shouldGenerateInvoice?: boolean | null;
  isActive?: boolean | null;
};

type RecurringGenerationLog = {
  id: string;
  templateId: string;
  projectId: string;
  periodKey: string;
  runAt: string;
  status: string;
  message?: string | null;
  estimateId?: string | null;
  invoiceId?: string | null;
  milestoneId?: string | null;
  createdAt?: string | null;
};

type RecurringJobRunResult = {
  processed: number;
  results: Array<{
    templateId: string;
    projectId: string;
    status: 'created' | 'skipped' | 'error';
    message?: string;
    estimateId?: string;
    invoiceId?: string;
    milestoneId?: string;
  }>;
};

const emptyProject = {
  code: '',
  name: '',
  status: 'draft',
  parentId: '',
  customerId: '',
  startDate: '',
  endDate: '',
  planHours: '',
  budgetCost: '',
  reasonText: '',
};

const emptyMemberForm: ProjectMemberForm = {
  userId: '',
  role: 'member',
};

const defaultRecurringTemplateForm = {
  frequency: 'monthly',
  defaultAmount: '',
  defaultCurrency: 'JPY',
  defaultTaxRate: '',
  defaultTerms: '',
  defaultMilestoneName: '',
  billUpon: 'date',
  dueDateOffsetDays: '',
  shouldGenerateEstimate: false,
  shouldGenerateInvoice: true,
  isActive: true,
  nextRunAt: '',
  timezone: '',
};

const statusOptions = [
  { value: 'draft', label: '起案中' },
  { value: 'active', label: '進行中' },
  { value: 'on_hold', label: '保留' },
  { value: 'closed', label: '完了' },
];

const memberRoleOptions: { value: ProjectMemberRole; label: string }[] = [
  { value: 'member', label: 'メンバー' },
  { value: 'leader', label: 'リーダー' },
];

const errorDetail = (err: unknown) => {
  if (err instanceof Error && err.message) {
    return ` (${err.message})`;
  }
  return '';
};

const parseNumberInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric < 0) return undefined;
  return numeric;
};

const toDatetimeLocal = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
};

const toDateInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const parseDueDateOffsetDays = (value?: DueDateRule | null) => {
  if (!value) return '';
  if (value.type !== 'periodEndPlusOffset') return '';
  const offset = Number(value.offsetDays);
  if (!Number.isFinite(offset)) return '';
  return String(offset);
};

const toCsv = (headers: string[], rows: string[][]) => {
  const escapeValue = (value: string) => {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  const lines = [headers.map(escapeValue).join(',')];
  for (const row of rows) {
    lines.push(row.map((value) => escapeValue(value ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
};

const parseCsvRows = (text: string) => {
  // CSV parser supporting quoted fields compatible with toCsv.
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\r') {
      continue;
    } else if (char === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some((value) => value.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((value) => value.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
};

const normalizeCsvHeader = (value: string) => {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
};

export const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState(emptyProject);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingOriginalParentId, setEditingOriginalParentId] = useState<
    string | null
  >(null);
  const [message, setMessage] = useState('');
  const [memberProjectId, setMemberProjectId] = useState<string | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [memberForm, setMemberForm] =
    useState<ProjectMemberForm>(emptyMemberForm);
  const [memberMessage, setMemberMessage] = useState('');
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<
    Record<string, ProjectMemberRole>
  >({});
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidates, setCandidates] = useState<ProjectMemberCandidate[]>([]);
  const [candidateMessage, setCandidateMessage] = useState('');
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputId = 'project-members-csv-input';

  const auth = getAuthState();
  const isPrivileged = (auth?.roles ?? []).some((role) =>
    ['admin', 'mgmt'].includes(role),
  );

  const [recurringProjectId, setRecurringProjectId] = useState('');
  const [recurringTemplateId, setRecurringTemplateId] = useState<string | null>(
    null,
  );
  const [recurringForm, setRecurringForm] = useState(
    defaultRecurringTemplateForm,
  );
  const [recurringLogs, setRecurringLogs] = useState<RecurringGenerationLog[]>(
    [],
  );
  const [recurringJobResult, setRecurringJobResult] =
    useState<RecurringJobRunResult | null>(null);
  const [recurringMessage, setRecurringMessage] = useState('');
  const [recurringJobMessage, setRecurringJobMessage] = useState('');
  const [recurringLoading, setRecurringLoading] = useState(false);

  const customerMap = useMemo(() => {
    return new Map(customers.map((item) => [item.id, item]));
  }, [customers]);

  const projectMap = useMemo(() => {
    return new Map(projects.map((item) => [item.id, item]));
  }, [projects]);

  const trimmedParentId = form.parentId.trim();
  const nextParentId = trimmedParentId.length > 0 ? trimmedParentId : null;
  const parentChanged =
    editingProjectId !== null &&
    nextParentId !== (editingOriginalParentId ?? null);
  const trimmedReasonText = form.reasonText.trim();

  const projectPayload = useMemo(() => {
    const trimmedCustomerId = form.customerId.trim();
    const trimmedStartDate = form.startDate.trim();
    const trimmedEndDate = form.endDate.trim();
    const planHours = parseNumberInput(form.planHours);
    const budgetCost = parseNumberInput(form.budgetCost);
    return {
      code: form.code.trim(),
      name: form.name.trim(),
      status: form.status || 'draft',
      customerId: trimmedCustomerId.length > 0 ? trimmedCustomerId : null,
      startDate: trimmedStartDate.length > 0 ? trimmedStartDate : null,
      endDate: trimmedEndDate.length > 0 ? trimmedEndDate : null,
      planHours,
      budgetCost,
    };
  }, [form]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: Project[] }>('/projects');
      setProjects(res.items || []);
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setMessage(`案件一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api<{ items: Customer[] }>('/customers');
      setCustomers(res.items || []);
    } catch (err) {
      console.error('Failed to load customers.', err);
      setCustomers([]);
      setMessage(`顧客一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, []);

  const loadRecurringTemplate = useCallback(
    async (projectId: string) => {
      if (!isPrivileged) return;
      if (!projectId) return;
      setRecurringLoading(true);
      setRecurringMessage('');
      try {
        const template = await api<RecurringProjectTemplate | null>(
          `/projects/${projectId}/recurring-template`,
        );
        if (!template) {
          setRecurringTemplateId(null);
          setRecurringForm(defaultRecurringTemplateForm);
          setRecurringMessage('テンプレは未設定です');
          return;
        }
        setRecurringTemplateId(template.id);
        setRecurringForm({
          frequency: template.frequency || 'monthly',
          defaultAmount:
            template.defaultAmount === null ||
            template.defaultAmount === undefined
              ? ''
              : String(template.defaultAmount),
          defaultCurrency: template.defaultCurrency || 'JPY',
          defaultTaxRate:
            template.defaultTaxRate === null ||
            template.defaultTaxRate === undefined
              ? ''
              : String(template.defaultTaxRate),
          defaultTerms: template.defaultTerms || '',
          defaultMilestoneName: template.defaultMilestoneName || '',
          billUpon: template.billUpon || 'date',
          dueDateOffsetDays: parseDueDateOffsetDays(template.dueDateRule),
          shouldGenerateEstimate: template.shouldGenerateEstimate ?? false,
          shouldGenerateInvoice: template.shouldGenerateInvoice ?? true,
          isActive: template.isActive ?? true,
          nextRunAt: toDatetimeLocal(template.nextRunAt),
          timezone: template.timezone || '',
        });
        setRecurringMessage('テンプレを読み込みました');
      } catch (err) {
        console.error('Failed to load recurring template.', err);
        setRecurringTemplateId(null);
        setRecurringForm(defaultRecurringTemplateForm);
        setRecurringMessage(`テンプレの取得に失敗しました${errorDetail(err)}`);
      } finally {
        setRecurringLoading(false);
      }
    },
    [isPrivileged],
  );

  const loadRecurringLogs = useCallback(
    async (projectId: string) => {
      if (!isPrivileged) return;
      if (!projectId) return;
      setRecurringLoading(true);
      setRecurringMessage('');
      try {
        const res = await api<{ items: RecurringGenerationLog[] }>(
          `/projects/${projectId}/recurring-generation-logs?limit=50`,
        );
        setRecurringLogs(res.items || []);
        setRecurringMessage('生成ログを更新しました');
      } catch (err) {
        console.error('Failed to load recurring logs.', err);
        setRecurringLogs([]);
        setRecurringMessage(`生成ログの取得に失敗しました${errorDetail(err)}`);
      } finally {
        setRecurringLoading(false);
      }
    },
    [isPrivileged],
  );

  const saveRecurringTemplate = useCallback(async () => {
    if (!isPrivileged) return;
    if (!recurringProjectId) {
      setRecurringMessage('案件を選択してください');
      return;
    }
    const amount = parseNumberInput(recurringForm.defaultAmount);
    if (amount === undefined || amount < 1) {
      setRecurringMessage('デフォルト金額は1以上で入力してください');
      return;
    }
    const taxRate = parseNumberInput(recurringForm.defaultTaxRate);
    const offsetRaw = recurringForm.dueDateOffsetDays.trim();
    let dueDateRule: DueDateRule | null = null;
    if (offsetRaw) {
      const offsetDays = Number(offsetRaw);
      if (!Number.isFinite(offsetDays) || !Number.isInteger(offsetDays)) {
        setRecurringMessage('納期ルール(offsetDays)は整数で入力してください');
        return;
      }
      if (offsetDays < 0 || offsetDays > 365) {
        setRecurringMessage('納期ルール(offsetDays)は0〜365で入力してください');
        return;
      }
      dueDateRule = { type: 'periodEndPlusOffset', offsetDays };
    }
    const nextRunAtRaw = recurringForm.nextRunAt.trim();
    let nextRunAt: string | undefined;
    if (nextRunAtRaw) {
      const parsed = new Date(nextRunAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        setRecurringMessage('次回実行日時が不正です');
        return;
      }
      nextRunAt = parsed.toISOString();
    }
    setRecurringLoading(true);
    setRecurringMessage('');
    try {
      const payload: Record<string, unknown> = {
        frequency: recurringForm.frequency,
        defaultAmount: amount,
        defaultCurrency: recurringForm.defaultCurrency,
        shouldGenerateEstimate: recurringForm.shouldGenerateEstimate,
        shouldGenerateInvoice: recurringForm.shouldGenerateInvoice,
        isActive: recurringForm.isActive,
        dueDateRule: dueDateRule,
      };
      if (taxRate !== undefined) {
        payload.defaultTaxRate = taxRate;
      }
      if (recurringForm.defaultTerms.trim()) {
        payload.defaultTerms = recurringForm.defaultTerms.trim();
      }
      if (recurringForm.defaultMilestoneName.trim()) {
        payload.defaultMilestoneName =
          recurringForm.defaultMilestoneName.trim();
      }
      if (recurringForm.billUpon.trim()) {
        payload.billUpon = recurringForm.billUpon.trim();
      }
      if (recurringForm.timezone.trim()) {
        payload.timezone = recurringForm.timezone.trim();
      }
      if (nextRunAt) {
        payload.nextRunAt = nextRunAt;
      }
      const template = await api<RecurringProjectTemplate>(
        `/projects/${recurringProjectId}/recurring-template`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      setRecurringTemplateId(template.id);
      setRecurringMessage('保存しました');
      await loadRecurringLogs(recurringProjectId);
    } catch (err) {
      console.error('Failed to save recurring template.', err);
      setRecurringMessage(`保存に失敗しました${errorDetail(err)}`);
    } finally {
      setRecurringLoading(false);
    }
  }, [isPrivileged, loadRecurringLogs, recurringForm, recurringProjectId]);

  const runRecurringJob = useCallback(async () => {
    if (!isPrivileged) return;
    setRecurringJobMessage('');
    setRecurringLoading(true);
    try {
      const result = await api<RecurringJobRunResult>(
        '/jobs/recurring-projects/run',
        {
          method: 'POST',
          body: '{}',
        },
      );
      setRecurringJobResult(result);
      setRecurringJobMessage('ジョブを実行しました');
      if (recurringProjectId) {
        await loadRecurringLogs(recurringProjectId);
      }
    } catch (err) {
      console.error('Failed to run recurring job.', err);
      setRecurringJobResult(null);
      setRecurringJobMessage(`ジョブ実行に失敗しました${errorDetail(err)}`);
    } finally {
      setRecurringLoading(false);
    }
  }, [isPrivileged, loadRecurringLogs, recurringProjectId]);

  const saveProject = async () => {
    if (!projectPayload.code || !projectPayload.name) {
      setMessage('コードと名称は必須です');
      return;
    }
    if (editingProjectId && parentChanged && !trimmedReasonText) {
      setMessage('親案件を変更する場合は理由を入力してください');
      return;
    }
    try {
      if (editingProjectId) {
        await api(`/projects/${editingProjectId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...projectPayload,
            parentId: trimmedParentId,
            ...(trimmedReasonText ? { reasonText: trimmedReasonText } : {}),
          }),
        });
        setMessage('案件を更新しました');
      } else {
        const createPayload = {
          ...projectPayload,
          ...(trimmedParentId ? { parentId: trimmedParentId } : {}),
        };
        await api('/projects', {
          method: 'POST',
          body: JSON.stringify(createPayload),
        });
        setMessage('案件を追加しました');
      }
      setForm(emptyProject);
      setEditingProjectId(null);
      setEditingOriginalParentId(null);
      loadProjects();
    } catch (err) {
      console.error('Failed to save project.', err);
      setMessage(`案件の保存に失敗しました${errorDetail(err)}`);
    }
  };

  const editProject = (item: Project) => {
    setEditingProjectId(item.id);
    setEditingOriginalParentId(item.parentId ?? null);
    setForm({
      code: item.code || '',
      name: item.name || '',
      status: item.status || 'draft',
      parentId: item.parentId || '',
      customerId: item.customerId || '',
      startDate: toDateInput(item.startDate),
      endDate: toDateInput(item.endDate),
      planHours:
        item.planHours === null || item.planHours === undefined
          ? ''
          : String(item.planHours),
      budgetCost:
        item.budgetCost === null || item.budgetCost === undefined
          ? ''
          : String(item.budgetCost),
      reasonText: '',
    });
  };

  const resetProject = () => {
    setForm(emptyProject);
    setEditingProjectId(null);
    setEditingOriginalParentId(null);
  };

  const loadMembers = useCallback(
    async (projectId: string): Promise<ProjectMember[] | null> => {
      setMemberLoading(true);
      try {
        const res = await api<{ items: ProjectMember[] }>(
          `/projects/${projectId}/members`,
        );
        const items = res.items || [];
        setMembers(items);
        setMemberRoleDrafts(
          Object.fromEntries(items.map((item) => [item.userId, item.role])),
        );
        setMemberMessage('');
        return items;
      } catch (err) {
        console.error('Failed to load project members.', err);
        setMembers([]);
        setMemberMessage(`メンバー一覧の取得に失敗しました${errorDetail(err)}`);
        return null;
      } finally {
        setMemberLoading(false);
      }
    },
    [],
  );

  const toggleMembers = useCallback(
    (projectId: string) => {
      if (memberProjectId === projectId) {
        setMemberProjectId(null);
        setMembers([]);
        setMemberMessage('');
        setMemberForm(emptyMemberForm);
        setMemberRoleDrafts({});
        setCandidateQuery('');
        setCandidates([]);
        setCandidateMessage('');
        setImportFile(null);
        return;
      }
      setMemberProjectId(projectId);
      setMemberForm(emptyMemberForm);
      setMemberMessage('');
      setMemberRoleDrafts({});
      setCandidateQuery('');
      setCandidates([]);
      setCandidateMessage('');
      setImportFile(null);
      loadMembers(projectId);
    },
    [loadMembers, memberProjectId],
  );

  const saveMember = async () => {
    if (!memberProjectId) return;
    const trimmedUserId = memberForm.userId.trim();
    if (!trimmedUserId) {
      setMemberMessage('ユーザIDは必須です');
      return;
    }
    const role = isPrivileged ? memberForm.role : 'member';
    const existing = members.find((item) => item.userId === trimmedUserId);
    if (existing) {
      if (existing.role === role) {
        setMemberMessage('すでに登録済みです');
        return;
      }
      if (isPrivileged) {
        setMemberRoleDrafts((prev) => ({
          ...prev,
          [trimmedUserId]: role,
        }));
        setMemberMessage(
          '既存メンバーです。権限変更は一覧の「権限更新」を使用してください。',
        );
      } else {
        setMemberMessage('既存メンバーの権限変更は管理者のみ可能です。');
      }
      return;
    }
    try {
      await api(`/projects/${memberProjectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: trimmedUserId, role }),
      });
      setMemberMessage('メンバーを保存しました');
      setMemberForm(emptyMemberForm);
      setCandidateQuery('');
      setCandidates([]);
      setCandidateMessage('');
      loadMembers(memberProjectId);
    } catch (err) {
      console.error('Failed to save project member.', err);
      setMemberMessage(`メンバーの保存に失敗しました${errorDetail(err)}`);
    }
  };

  const searchCandidates = async () => {
    if (!memberProjectId) return;
    const query = candidateQuery.trim();
    if (query.length < 2) {
      setCandidateMessage('2文字以上で検索してください');
      setCandidates([]);
      return;
    }
    setCandidateLoading(true);
    try {
      const res = await api<{ items: ProjectMemberCandidate[] }>(
        `/projects/${memberProjectId}/member-candidates?q=${encodeURIComponent(
          query,
        )}`,
      );
      const items = res.items || [];
      setCandidates(items);
      setCandidateMessage(items.length ? '' : '候補がありません');
    } catch (err) {
      console.error('Failed to search member candidates.', err);
      setCandidateMessage(`候補の取得に失敗しました${errorDetail(err)}`);
      setCandidates([]);
    } finally {
      setCandidateLoading(false);
    }
  };

  const clearCandidates = () => {
    setCandidateQuery('');
    setCandidates([]);
    setCandidateMessage('');
  };

  const selectCandidate = (candidate: ProjectMemberCandidate) => {
    setMemberForm((prev) => ({ ...prev, userId: candidate.userId }));
  };

  const exportMembersCsv = async () => {
    if (!memberProjectId) return;
    let items = members;
    if (!items.length) {
      const fetched = await loadMembers(memberProjectId);
      if (!fetched) return;
      items = fetched;
    }
    if (!items.length) {
      setMemberMessage('エクスポート対象のメンバーがありません');
      return;
    }
    const headers = ['userId', 'role'];
    const rows = items.map((member) => [member.userId, member.role]);
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `project-members-${memberProjectId}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const importMembersCsv = async () => {
    if (!memberProjectId || !importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const rows = parseCsvRows(text);
      if (rows.length === 0) {
        setMemberMessage('CSVにデータがありません');
        return;
      }
      const header = rows[0].map((value) => normalizeCsvHeader(value));
      const hasHeader = header.includes('userid');
      const dataRows = hasHeader ? rows.slice(1) : rows;
      if (dataRows.length === 0) {
        setMemberMessage('CSVにデータがありません');
        return;
      }
      const seen = new Set<string>();
      const items: Array<{ userId: string; role: ProjectMemberRole }> = [];
      let skipped = 0;
      let failed = 0;
      const failedRows: string[] = [];
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
        const row = dataRows[rowIndex];
        const displayIndex = rowIndex + (hasHeader ? 2 : 1);
        const userId = (row[0] || '').trim();
        if (!userId) {
          failed += 1;
          if (failedRows.length < 5) {
            failedRows.push(`${displayIndex}行目: (空欄)`);
          }
          continue;
        }
        if (seen.has(userId)) {
          skipped += 1;
          continue;
        }
        seen.add(userId);
        const rawRole = (row[1] || '').toLowerCase();
        const requestedRole =
          rawRole === 'leader' || rawRole === 'member' ? rawRole : 'member';
        const role = isPrivileged ? requestedRole : 'member';
        items.push({ userId, role });
      }
      if (!items.length) {
        setMemberMessage(
          `インポート対象がありません (スキップ ${skipped} 件 / 失敗 ${failed} 件)`,
        );
        return;
      }
      const result = await api<ProjectMemberBulkResult>(
        `/projects/${memberProjectId}/members/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({ items }),
        },
      );
      const totalAdded = result.added;
      const totalSkipped = result.skipped + skipped;
      const totalFailed = result.failed + failed;
      const failureSamples: string[] = [...failedRows];
      const backendSamples =
        result.failures?.map((failure) =>
          failure.userId
            ? `${failure.userId}: ${failure.reason}`
            : failure.reason,
        ) || [];
      for (const sample of backendSamples) {
        if (failureSamples.length >= 5) break;
        failureSamples.push(sample);
      }
      const failureDetail = failureSamples.length
        ? ` (例: ${failureSamples.join(', ')})`
        : '';
      setMemberMessage(
        `インポート完了: 追加 ${totalAdded} 件 / スキップ ${totalSkipped} 件 / 失敗 ${totalFailed} 件${failureDetail}`,
      );
      setImportFile(null);
      await loadMembers(memberProjectId);
    } catch (err) {
      console.error('Failed to import project members.', err);
      setMemberMessage(`インポートに失敗しました${errorDetail(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const updateMemberRole = async (member: ProjectMember) => {
    if (!memberProjectId) return;
    const nextRole = memberRoleDrafts[member.userId] || member.role;
    if (nextRole === member.role) {
      setMemberMessage('変更がありません');
      return;
    }
    try {
      await api(`/projects/${memberProjectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: member.userId, role: nextRole }),
      });
      setMemberMessage('メンバー権限を更新しました');
      loadMembers(memberProjectId);
    } catch (err) {
      console.error('Failed to update project member role.', err);
      setMemberMessage(`メンバー権限の更新に失敗しました${errorDetail(err)}`);
    }
  };

  const removeMember = async (member: ProjectMember) => {
    if (!memberProjectId) return;
    try {
      await api(
        `/projects/${memberProjectId}/members/${encodeURIComponent(
          member.userId,
        )}`,
        { method: 'DELETE' },
      );
      setMemberMessage('メンバーを削除しました');
      loadMembers(memberProjectId);
    } catch (err) {
      console.error('Failed to remove project member.', err);
      setMemberMessage(`メンバー削除に失敗しました${errorDetail(err)}`);
    }
  };

  useEffect(() => {
    loadProjects();
    loadCustomers();
  }, [loadProjects, loadCustomers]);

  useEffect(() => {
    if (!isPrivileged) return;
    if (recurringProjectId) return;
    if (projects.length === 0) return;
    setRecurringProjectId(projects[0].id);
  }, [isPrivileged, projects, recurringProjectId]);

  useEffect(() => {
    if (!isPrivileged) return;
    if (!recurringProjectId) return;
    loadRecurringTemplate(recurringProjectId);
    loadRecurringLogs(recurringProjectId);
  }, [
    isPrivileged,
    loadRecurringLogs,
    loadRecurringTemplate,
    recurringProjectId,
  ]);

  return (
    <div>
      <h2>案件</h2>
      <div className="row">
        <input
          type="text"
          placeholder="コード"
          aria-label="案件コード"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <input
          type="text"
          placeholder="名称"
          aria-label="案件名称"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          aria-label="案件ステータス"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select
          aria-label="親案件選択"
          value={form.parentId}
          onChange={(e) => setForm({ ...form, parentId: e.target.value })}
        >
          <option value="">親なし</option>
          {projects
            .filter((item) => item.id !== editingProjectId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} / {item.name}
              </option>
            ))}
        </select>
        <select
          aria-label="顧客選択"
          value={form.customerId}
          onChange={(e) => setForm({ ...form, customerId: e.target.value })}
        >
          <option value="">顧客未設定</option>
          {customers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} / {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="date"
          aria-label="開始日"
          value={form.startDate}
          onChange={(e) => setForm({ ...form, startDate: e.target.value })}
        />
        <input
          type="date"
          aria-label="終了日"
          value={form.endDate}
          onChange={(e) => setForm({ ...form, endDate: e.target.value })}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="number"
          inputMode="decimal"
          placeholder="予定工数 (h)"
          aria-label="予定工数"
          value={form.planHours}
          onChange={(e) => setForm({ ...form, planHours: e.target.value })}
          min={0}
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="予算コスト"
          aria-label="予算コスト"
          value={form.budgetCost}
          onChange={(e) => setForm({ ...form, budgetCost: e.target.value })}
          min={0}
        />
      </div>
      {editingProjectId && (
        <div style={{ marginTop: 8 }}>
          <textarea
            placeholder={
              parentChanged
                ? '親案件の変更理由（必須）'
                : '親案件の変更理由（親変更時のみ必須）'
            }
            aria-label="親案件の変更理由"
            value={form.reasonText}
            onChange={(e) => setForm({ ...form, reasonText: e.target.value })}
            style={{ width: '100%', minHeight: 60 }}
            disabled={!parentChanged}
          />
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="button" onClick={saveProject}>
          {editingProjectId ? '更新' : '追加'}
        </button>
        <button className="button secondary" onClick={resetProject}>
          クリア
        </button>
        <button className="button secondary" onClick={loadProjects}>
          再読込
        </button>
      </div>
      {message && <p>{message}</p>}
      <ul className="list">
        {projects.map((item) => {
          const customer = item.customerId
            ? customerMap.get(item.customerId)
            : undefined;
          const parent = item.parentId ? projectMap.get(item.parentId) : null;
          const startDate = toDateInput(item.startDate);
          const endDate = toDateInput(item.endDate);
          const periodLabel =
            startDate || endDate
              ? `${startDate || '未設定'}〜${endDate || '未設定'}`
              : '';
          return (
            <li key={item.id}>
              <span className="badge">{item.status}</span> {item.code} /{' '}
              {item.name}
              {parent && ` / 親: ${parent.code} ${parent.name}`}
              {customer && ` / ${customer.code} ${customer.name}`}
              {periodLabel && ` / 期間: ${periodLabel}`}
              {item.planHours !== null &&
                item.planHours !== undefined &&
                ` / 予定工数: ${item.planHours}h`}
              {item.budgetCost !== null &&
                item.budgetCost !== undefined &&
                ` / 予算コスト: ${item.budgetCost}${
                  item.currency ? ` ${item.currency}` : ''
                }`}
              <button
                className="button secondary"
                style={{ marginLeft: 8 }}
                onClick={() => editProject(item)}
              >
                編集
              </button>
              <button
                className="button secondary"
                style={{ marginLeft: 8 }}
                onClick={() => toggleMembers(item.id)}
              >
                {memberProjectId === item.id
                  ? 'メンバー閉じる'
                  : 'メンバー管理'}
              </button>
              {memberProjectId === item.id && (
                <div className="card" style={{ marginTop: 12 }}>
                  <h3>メンバー管理</h3>
                  <div className="row">
                    <input
                      type="text"
                      placeholder="ユーザID (email等)"
                      aria-label="案件メンバーのユーザID"
                      value={memberForm.userId}
                      onChange={(e) =>
                        setMemberForm({ ...memberForm, userId: e.target.value })
                      }
                    />
                    {isPrivileged ? (
                      <select
                        aria-label="案件メンバーの権限"
                        value={memberForm.role}
                        onChange={(e) =>
                          setMemberForm({
                            ...memberForm,
                            role: e.target.value as ProjectMemberRole,
                          })
                        }
                      >
                        {memberRoleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        aria-label="案件メンバーの権限"
                        style={{ alignSelf: 'center' }}
                      >
                        権限: メンバー (固定)
                      </span>
                    )}
                    <button className="button" onClick={saveMember}>
                      追加
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => loadMembers(item.id)}
                    >
                      再読込
                    </button>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      placeholder="候補検索 (2文字以上)"
                      aria-label="メンバー候補検索"
                      value={candidateQuery}
                      onChange={(e) => setCandidateQuery(e.target.value)}
                    />
                    <button
                      className="button secondary"
                      onClick={searchCandidates}
                      disabled={candidateLoading}
                    >
                      検索
                    </button>
                    <button
                      className="button secondary"
                      onClick={clearCandidates}
                    >
                      クリア
                    </button>
                  </div>
                  {candidateMessage && <p>{candidateMessage}</p>}
                  {candidateLoading && <p>候補検索中...</p>}
                  {candidates.length > 0 && (
                    <ul className="list">
                      {candidates.map((candidate) => (
                        <li key={candidate.userId}>
                          {candidate.displayName
                            ? `${candidate.displayName} / `
                            : ''}
                          {candidate.userId}
                          {candidate.department && ` (${candidate.department})`}
                          <button
                            className="button secondary"
                            style={{ marginLeft: 8 }}
                            onClick={() => selectCandidate(candidate)}
                          >
                            選択
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="button secondary"
                      onClick={exportMembersCsv}
                    >
                      CSVエクスポート
                    </button>
                    <label className="button secondary" htmlFor={importInputId}>
                      CSVファイル選択
                    </label>
                    <input
                      id={importInputId}
                      type="file"
                      accept=".csv,text/csv"
                      aria-label="メンバーCSVインポート"
                      style={{ display: 'none' }}
                      onChange={(e) =>
                        setImportFile(e.target.files?.[0] || null)
                      }
                    />
                    <button
                      className="button"
                      onClick={importMembersCsv}
                      disabled={!importFile || importing}
                    >
                      CSVインポート
                    </button>
                  </div>
                  {importFile && (
                    <p style={{ marginTop: 4 }}>選択中: {importFile.name}</p>
                  )}
                  <p style={{ marginTop: 8 }}>
                    CSVは userId,role の2列（roleは
                    member/leader）で作成してください。
                  </p>
                  {memberMessage && <p>{memberMessage}</p>}
                  {memberLoading ? (
                    <p>読み込み中...</p>
                  ) : (
                    <ul className="list">
                      {members.map((member) => {
                        const draftRole =
                          memberRoleDrafts[member.userId] || member.role;
                        const canRemove =
                          isPrivileged || member.role !== 'leader';
                        return (
                          <li key={member.userId}>
                            <span className="badge">{member.role}</span>{' '}
                            {member.userId}
                            {isPrivileged && (
                              <>
                                <select
                                  aria-label="案件メンバーの権限"
                                  value={draftRole}
                                  onChange={(e) =>
                                    setMemberRoleDrafts((prev) => ({
                                      ...prev,
                                      [member.userId]: e.target
                                        .value as ProjectMemberRole,
                                    }))
                                  }
                                  style={{ marginLeft: 8 }}
                                >
                                  {memberRoleOptions.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="button secondary"
                                  style={{ marginLeft: 8 }}
                                  onClick={() => updateMemberRole(member)}
                                >
                                  権限更新
                                </button>
                              </>
                            )}
                            <button
                              className="button secondary"
                              style={{ marginLeft: 8 }}
                              onClick={() => removeMember(member)}
                              disabled={!canRemove}
                            >
                              削除
                            </button>
                          </li>
                        );
                      })}
                      {members.length === 0 && <li>メンバーなし</li>}
                    </ul>
                  )}
                  {!isPrivileged && (
                    <p style={{ marginTop: 8 }}>
                      リーダー権限の付与・変更は管理者のみ可能です。
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {projects.length === 0 && <li>データなし</li>}
      </ul>

      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <h3>定期案件テンプレ（MVP）</h3>
        {!isPrivileged && (
          <p style={{ marginTop: 8 }}>
            管理者/管理部（admin/mgmt）のみ利用できます。
          </p>
        )}
        {isPrivileged && (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select
                aria-label="定期テンプレ案件選択"
                value={recurringProjectId}
                onChange={(e) => setRecurringProjectId(e.target.value)}
                disabled={recurringLoading}
              >
                <option value="">案件を選択</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} / {project.name}
                  </option>
                ))}
              </select>
              <button
                className="button secondary"
                onClick={() => loadRecurringTemplate(recurringProjectId)}
                disabled={!recurringProjectId || recurringLoading}
              >
                テンプレ再読込
              </button>
              <button
                className="button secondary"
                onClick={() => loadRecurringLogs(recurringProjectId)}
                disabled={!recurringProjectId || recurringLoading}
              >
                ログ更新
              </button>
            </div>
            {recurringTemplateId && (
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                templateId: {recurringTemplateId}
              </div>
            )}
            {recurringMessage && <p>{recurringMessage}</p>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label>
                頻度
                <select
                  aria-label="定期頻度"
                  value={recurringForm.frequency}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      frequency: e.target.value,
                    }))
                  }
                  disabled={recurringLoading}
                >
                  <option value="monthly">毎月</option>
                  <option value="quarterly">四半期</option>
                  <option value="semiannual">半年</option>
                  <option value="annual">年次</option>
                </select>
              </label>
              <label>
                デフォルト金額
                <input
                  aria-label="定期デフォルト金額"
                  type="number"
                  value={recurringForm.defaultAmount}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      defaultAmount: e.target.value,
                    }))
                  }
                  min={0}
                  disabled={recurringLoading}
                />
              </label>
              <label>
                通貨
                <select
                  aria-label="定期通貨"
                  value={recurringForm.defaultCurrency}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      defaultCurrency: e.target.value,
                    }))
                  }
                  disabled={recurringLoading}
                >
                  <option value="JPY">JPY</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <label>
                税率(任意)
                <input
                  aria-label="定期税率"
                  type="number"
                  value={recurringForm.defaultTaxRate}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      defaultTaxRate: e.target.value,
                    }))
                  }
                  step="0.01"
                  min={0}
                  disabled={recurringLoading}
                />
              </label>
              <label>
                請求タイミング(任意)
                <select
                  aria-label="定期請求タイミング"
                  value={recurringForm.billUpon}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      billUpon: e.target.value,
                    }))
                  }
                  disabled={recurringLoading}
                >
                  <option value="date">日付</option>
                  <option value="acceptance">検収</option>
                  <option value="time">工数</option>
                </select>
              </label>
              <label>
                納期ルール(offsetDays)
                <input
                  aria-label="定期納期オフセット"
                  type="number"
                  value={recurringForm.dueDateOffsetDays}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      dueDateOffsetDays: e.target.value,
                    }))
                  }
                  min={0}
                  max={365}
                  step={1}
                  placeholder="空で無効（0=月末）"
                  disabled={recurringLoading}
                />
              </label>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label>
                マイルストーン名(任意)
                <input
                  aria-label="定期マイルストーン名"
                  value={recurringForm.defaultMilestoneName}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      defaultMilestoneName: e.target.value,
                    }))
                  }
                  disabled={recurringLoading}
                />
              </label>
              <label>
                次回実行日時(任意)
                <input
                  aria-label="定期次回実行日時"
                  type="datetime-local"
                  value={recurringForm.nextRunAt}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      nextRunAt: e.target.value,
                    }))
                  }
                  disabled={recurringLoading}
                />
              </label>
              <label>
                タイムゾーン(任意)
                <input
                  aria-label="定期タイムゾーン"
                  value={recurringForm.timezone}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      timezone: e.target.value,
                    }))
                  }
                  placeholder="Asia/Tokyo"
                  disabled={recurringLoading}
                />
              </label>
            </div>

            <div style={{ marginTop: 8 }}>
              <label>
                デフォルト文面(任意)
                <textarea
                  aria-label="定期デフォルト文面"
                  value={recurringForm.defaultTerms}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      defaultTerms: e.target.value,
                    }))
                  }
                  rows={3}
                  style={{ width: '100%' }}
                  disabled={recurringLoading}
                />
              </label>
            </div>

            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  aria-label="見積を生成"
                  type="checkbox"
                  checked={recurringForm.shouldGenerateEstimate}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      shouldGenerateEstimate: e.target.checked,
                    }))
                  }
                  disabled={recurringLoading}
                />
                見積を生成
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  aria-label="請求を生成"
                  type="checkbox"
                  checked={recurringForm.shouldGenerateInvoice}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      shouldGenerateInvoice: e.target.checked,
                    }))
                  }
                  disabled={recurringLoading}
                />
                請求を生成
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  aria-label="定期テンプレ有効"
                  type="checkbox"
                  checked={recurringForm.isActive}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({
                      ...prev,
                      isActive: e.target.checked,
                    }))
                  }
                  disabled={recurringLoading}
                />
                有効
              </label>
              <button
                className="button"
                onClick={saveRecurringTemplate}
                disabled={!recurringProjectId || recurringLoading}
              >
                保存
              </button>
              <button
                className="button secondary"
                onClick={runRecurringJob}
                disabled={recurringLoading}
              >
                ジョブ実行
              </button>
            </div>

            {recurringJobMessage && <p>{recurringJobMessage}</p>}
            {recurringJobResult && (
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                processed: {recurringJobResult.processed} / results:{' '}
                {
                  recurringJobResult.results.filter(
                    (r) => r.projectId === recurringProjectId,
                  ).length
                }
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <strong>生成ログ</strong>
              <ul className="list">
                {recurringLogs.map((log) => (
                  <li key={log.id}>
                    <span className="badge">{log.status}</span> {log.periodKey}{' '}
                    / {new Date(log.runAt).toLocaleString()}
                    {log.invoiceId && <> / invoice:{log.invoiceId}</>}
                    {log.estimateId && <> / estimate:{log.estimateId}</>}
                    {log.message && <> / {log.message}</>}
                  </li>
                ))}
                {recurringLogs.length === 0 && <li>ログなし</li>}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
