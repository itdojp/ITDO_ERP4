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

  const loadMembers = useCallback(async (projectId: string) => {
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
    } catch (err) {
      console.error('Failed to load project members.', err);
      setMembers([]);
      setMemberMessage(`メンバー一覧の取得に失敗しました${errorDetail(err)}`);
    } finally {
      setMemberLoading(false);
    }
  }, []);

  const toggleMembers = useCallback(
    (projectId: string) => {
      if (memberProjectId === projectId) {
        setMemberProjectId(null);
        setMembers([]);
        setMemberMessage('');
        setMemberForm(emptyMemberForm);
        return;
      }
      setMemberProjectId(projectId);
      setMemberForm(emptyMemberForm);
      setMemberMessage('');
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
    try {
      await api(`/projects/${memberProjectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: trimmedUserId, role }),
      });
      setMemberMessage('メンバーを保存しました');
      setMemberForm(emptyMemberForm);
      loadMembers(memberProjectId);
    } catch (err) {
      console.error('Failed to save project member.', err);
      setMemberMessage(`メンバーの保存に失敗しました${errorDetail(err)}`);
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
                    <select
                      aria-label="案件メンバーの権限"
                      value={memberForm.role}
                      onChange={(e) =>
                        setMemberForm({
                          ...memberForm,
                          role: e.target.value as ProjectMemberRole,
                        })
                      }
                      disabled={!isPrivileged}
                    >
                      {memberRoleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button className="button" onClick={saveMember}>
                      追加/更新
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => loadMembers(item.id)}
                    >
                      再読込
                    </button>
                  </div>
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
                                  aria-label="メンバー権限"
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
