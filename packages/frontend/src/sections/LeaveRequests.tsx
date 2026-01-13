import React, { useEffect, useMemo, useState } from 'react';
import { api, apiResponse, getAuthState } from '../api';

type LeaveRequest = {
  id: string;
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  status: string;
  notes?: string | null;
};

type LeaveSubmitError = {
  error?: {
    code?: string;
    message?: string;
    conflictCount?: number;
    conflicts?: {
      id: string;
      projectId: string;
      taskId?: string | null;
      workDate: string;
      minutes: number;
    }[];
  };
};

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const buildInitialForm = () => {
  const today = formatDateInput(new Date());
  return {
    leaveType: 'paid',
    startDate: today,
    endDate: today,
    hours: '',
    notes: '',
  };
};

export const LeaveRequests: React.FC = () => {
  const auth = getAuthState();
  const userId = auth?.userId || '';
  const [form, setForm] = useState(() => buildInitialForm());
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [message, setMessage] = useState('');
  const [submitConflict, setSubmitConflict] =
    useState<LeaveSubmitError['error']>(undefined);

  const canOperate = useMemo(() => Boolean(userId), [userId]);

  const load = async (options?: { silent?: boolean }) => {
    if (!canOperate) {
      if (!options?.silent) setMessage('ログインしてください');
      return;
    }
    try {
      const res = await api<{ items: LeaveRequest[] }>(
        `/leave-requests?userId=${encodeURIComponent(userId)}`,
      );
      setItems(res.items || []);
      if (!options?.silent) setMessage('読み込みました');
    } catch (err) {
      setItems([]);
      setMessage('読み込みに失敗しました');
    }
  };

  useEffect(() => {
    void load({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!canOperate) {
      setMessage('ログインしてください');
      return;
    }
    const leaveType = form.leaveType.trim();
    if (!leaveType) {
      setMessage('休暇種別は必須です');
      return;
    }
    const startDate = form.startDate;
    const endDate = form.endDate;
    if (!startDate || !endDate) {
      setMessage('開始日/終了日は必須です');
      return;
    }
    const hoursRaw = form.hours.trim();
    const hours = hoursRaw ? Number(hoursRaw) : null;
    if (hoursRaw && (!Number.isFinite(hours) || hours < 0)) {
      setMessage('時間が不正です');
      return;
    }
    if (hoursRaw && !Number.isInteger(hours)) {
      setMessage('時間は整数で入力してください');
      return;
    }
    try {
      const created = await api<LeaveRequest>('/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          leaveType,
          startDate,
          endDate,
          hours: hours ?? undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      setItems((prev) => [created, ...prev]);
      setMessage('作成しました');
      setSubmitConflict(undefined);
      setForm(buildInitialForm());
    } catch (err) {
      setMessage('作成に失敗しました');
    }
  };

  const submit = async (id: string) => {
    setSubmitConflict(undefined);
    try {
      const res = await apiResponse(`/leave-requests/${id}/submit`, {
        method: 'POST',
      });
      if (res.ok) {
        const updated = (await res.json()) as LeaveRequest;
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        setMessage('申請しました');
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as LeaveSubmitError;
      if (payload.error?.code === 'TIME_ENTRY_CONFLICT') {
        setSubmitConflict(payload.error);
        setMessage(
          `休暇期間に工数が存在します（${payload.error.conflictCount ?? 0}件）`,
        );
        return;
      }
      setMessage('申請に失敗しました');
    } catch {
      setMessage('申請に失敗しました');
    }
  };

  return (
    <div>
      <h2>休暇</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="button secondary" onClick={() => load()}>
          読み込み
        </button>
      </div>
      {message && <p>{message}</p>}
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <strong>新規申請</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            aria-label="休暇種別"
            value={form.leaveType}
            onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
            placeholder="例: paid"
          />
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>開始</span>
            <input
              aria-label="休暇開始日"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>終了</span>
            <input
              aria-label="休暇終了日"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </label>
          <input
            aria-label="休暇時間(任意)"
            type="number"
            min={0}
            step={1}
            value={form.hours}
            onChange={(e) => setForm({ ...form, hours: e.target.value })}
            placeholder="時間(任意, 整数)"
            inputMode="numeric"
          />
          <input
            aria-label="備考(任意)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="備考(任意)"
          />
          <button className="button" onClick={create}>
            作成
          </button>
        </div>
      </div>
      {submitConflict?.conflicts?.length ? (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <strong>工数の重複</strong>
          <p style={{ marginTop: 8, marginBottom: 8, fontSize: 12 }}>
            休暇期間に工数が登録されています。工数を修正/削除してから再申請してください。
          </p>
          <ul className="list">
            {submitConflict.conflicts.map((item) => (
              <li key={item.id}>
                {new Date(item.workDate).toLocaleDateString()} / {item.minutes}
                min / project:{item.projectId}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="list" style={{ marginTop: 12 }}>
        {items.map((item) => (
          <li key={item.id}>
            <span className="badge">{item.status}</span> {item.leaveType} /{' '}
            {new Date(item.startDate).toLocaleDateString()}〜
            {new Date(item.endDate).toLocaleDateString()}
            {item.hours !== null && item.hours !== undefined
              ? ` / ${item.hours}h`
              : ''}
            <div>
              <button
                className="button"
                onClick={() => submit(item.id)}
                disabled={item.status !== 'draft'}
              >
                申請
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
    </div>
  );
};
