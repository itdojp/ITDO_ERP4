import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  customerId?: string | null;
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

const emptyProject = {
  code: '',
  name: '',
  status: 'draft',
  customerId: '',
};

const emptyMemberForm: ProjectMemberForm = {
  userId: '',
  role: 'member',
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

  const customerMap = useMemo(() => {
    return new Map(customers.map((item) => [item.id, item]));
  }, [customers]);

  const projectPayload = useMemo(() => {
    const trimmedCustomerId = form.customerId.trim();
    return {
      code: form.code.trim(),
      name: form.name.trim(),
      status: form.status || 'draft',
      customerId: trimmedCustomerId.length > 0 ? trimmedCustomerId : null,
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

  const saveProject = async () => {
    if (!projectPayload.code || !projectPayload.name) {
      setMessage('コードと名称は必須です');
      return;
    }
    try {
      if (editingProjectId) {
        await api(`/projects/${editingProjectId}`, {
          method: 'PATCH',
          body: JSON.stringify(projectPayload),
        });
        setMessage('案件を更新しました');
      } else {
        await api('/projects', {
          method: 'POST',
          body: JSON.stringify(projectPayload),
        });
        setMessage('案件を追加しました');
      }
      setForm(emptyProject);
      setEditingProjectId(null);
      loadProjects();
    } catch (err) {
      console.error('Failed to save project.', err);
      setMessage(`案件の保存に失敗しました${errorDetail(err)}`);
    }
  };

  const editProject = (item: Project) => {
    setEditingProjectId(item.id);
    setForm({
      code: item.code || '',
      name: item.name || '',
      status: item.status || 'draft',
      customerId: item.customerId || '',
    });
  };

  const resetProject = () => {
    setForm(emptyProject);
    setEditingProjectId(null);
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
          return (
            <li key={item.id}>
              <span className="badge">{item.status}</span> {item.code} /{' '}
              {item.name}
              {customer && ` / ${customer.code} ${customer.name}`}
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
    </div>
  );
};
