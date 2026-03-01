import React, { useEffect, useMemo, useState } from 'react';
import { api, apiResponse, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';

type LeaveRequest = {
  id: string;
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  minutes?: number | null;
  startTimeMinutes?: number | null;
  endTimeMinutes?: number | null;
  status: string;
  notes?: string | null;
};

type LeaderLeaveRequest = {
  id: string;
  userId: string;
  userDisplayName?: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  minutes?: number | null;
  startTimeMinutes?: number | null;
  endTimeMinutes?: number | null;
  status: string;
  visibleProjectIds?: string[];
};

type LeaveSubmitError = {
  error?: {
    code?: string;
    message?: string;
    conflictCount?: number;
    existingMinutes?: number;
    requestedLeaveMinutes?: number;
    totalMinutes?: number;
    defaultWorkdayMinutes?: number;
    conflicts?: {
      id: string;
      projectId: string;
      taskId?: string | null;
      workDate: string;
      minutes: number;
    }[];
  };
};

type LeaveDraftExtra = {
  detailsOpen: boolean;
  noConsultationConfirmed: boolean;
  noConsultationReason: string;
};

type LeaveSetting = {
  timeUnitMinutes: number;
  defaultWorkdayMinutes: number;
};

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string) {
  if (typeof value === 'string' && value.length >= 10) {
    const datePart = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

function formatClock(minutes: number) {
  const safeMinutes = Math.max(0, Math.min(24 * 60, minutes));
  const hours = String(Math.floor(safeMinutes / 60)).padStart(2, '0');
  const mins = String(safeMinutes % 60).padStart(2, '0');
  return `${hours}:${mins}`;
}

function parseClock(value: string) {
  const trimmed = value.trim();
  const matched = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatLeaveDuration(item: {
  hours?: number | null;
  minutes?: number | null;
  startTimeMinutes?: number | null;
  endTimeMinutes?: number | null;
}) {
  if (
    item.startTimeMinutes !== null &&
    item.startTimeMinutes !== undefined &&
    item.endTimeMinutes !== null &&
    item.endTimeMinutes !== undefined
  ) {
    const totalMinutes =
      item.minutes ?? Math.max(0, item.endTimeMinutes - item.startTimeMinutes);
    return `${formatClock(item.startTimeMinutes)}-${formatClock(item.endTimeMinutes)} / ${totalMinutes}min`;
  }
  if (item.hours !== null && item.hours !== undefined) {
    return `${item.hours}h`;
  }
  if (item.minutes !== null && item.minutes !== undefined) {
    return `${item.minutes}min`;
  }
  return '';
}

const buildInitialForm = () => {
  const today = formatDateInput(new Date());
  return {
    requestUnit: 'daily' as 'daily' | 'hourly',
    leaveType: 'paid',
    startDate: today,
    endDate: today,
    hours: '',
    startTime: '',
    endTime: '',
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
  const [draftExtraById, setDraftExtraById] = useState<
    Record<string, LeaveDraftExtra>
  >({});
  const [leaderItems, setLeaderItems] = useState<LeaderLeaveRequest[]>([]);
  const [leaderMessage, setLeaderMessage] = useState('');
  const [leaveSetting, setLeaveSetting] = useState<LeaveSetting>({
    timeUnitMinutes: 10,
    defaultWorkdayMinutes: 480,
  });

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
    const loadLeaveSetting = async () => {
      try {
        const res = await api<LeaveSetting>('/leave-settings');
        if (
          Number.isInteger(res.timeUnitMinutes) &&
          res.timeUnitMinutes > 0 &&
          Number.isInteger(res.defaultWorkdayMinutes) &&
          res.defaultWorkdayMinutes > 0
        ) {
          setLeaveSetting({
            timeUnitMinutes: res.timeUnitMinutes,
            defaultWorkdayMinutes: res.defaultWorkdayMinutes,
          });
        }
      } catch {
        // noop: fallback defaults are used when leave-setting API is unavailable.
      }
    };
    void load({ silent: true });
    void loadLeaveSetting();
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
    const requestUnit = form.requestUnit;
    const payload: {
      userId: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      hours?: number;
      startTime?: string;
      endTime?: string;
      notes?: string;
    } = {
      userId,
      leaveType,
      startDate,
      endDate,
      notes: form.notes.trim() || undefined,
    };
    if (requestUnit === 'hourly') {
      if (!form.startTime || !form.endTime) {
        setMessage('時間休では開始時刻/終了時刻が必須です');
        return;
      }
      if (startDate !== endDate) {
        setMessage('時間休は同一日で入力してください');
        return;
      }
      const startMinutes = parseClock(form.startTime);
      const endMinutes = parseClock(form.endTime);
      if (startMinutes === null || endMinutes === null) {
        setMessage('開始時刻/終了時刻は HH:MM で入力してください');
        return;
      }
      if (endMinutes <= startMinutes) {
        setMessage('終了時刻は開始時刻より後にしてください');
        return;
      }
      if (
        startMinutes % leaveSetting.timeUnitMinutes !== 0 ||
        endMinutes % leaveSetting.timeUnitMinutes !== 0
      ) {
        setMessage(
          `時刻は ${leaveSetting.timeUnitMinutes} 分単位で入力してください`,
        );
        return;
      }
      payload.startTime = form.startTime;
      payload.endTime = form.endTime;
    } else {
      const hoursRaw = form.hours.trim();
      if (hoursRaw) {
        const parsedHours = Number(hoursRaw);
        if (!Number.isFinite(parsedHours) || parsedHours < 0) {
          setMessage('時間が不正です');
          return;
        }
        if (!Number.isInteger(parsedHours)) {
          setMessage('時間は整数で入力してください');
          return;
        }
        payload.hours = parsedHours;
      }
    }
    try {
      const created = await api<LeaveRequest>('/leave-requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setItems((prev) => [created, ...prev]);
      setMessage('作成しました');
      setSubmitConflict(undefined);
      setForm(buildInitialForm());
    } catch (err) {
      setMessage('作成に失敗しました');
    }
  };

  const hourlyMinutes = useMemo(() => {
    if (form.requestUnit !== 'hourly') return null;
    const startMinutes = parseClock(form.startTime);
    const endMinutes = parseClock(form.endTime);
    if (startMinutes === null || endMinutes === null) return null;
    if (endMinutes <= startMinutes) return null;
    return endMinutes - startMinutes;
  }, [form.endTime, form.requestUnit, form.startTime]);

  const submit = async (id: string) => {
    setSubmitConflict(undefined);
    try {
      const extra = draftExtraById[id];
      const submitPayload = {
        noConsultationConfirmed: extra?.noConsultationConfirmed || undefined,
        noConsultationReason: extra?.noConsultationReason?.trim() || undefined,
      };
      const res = await apiResponse(`/leave-requests/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify(submitPayload),
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
      if (payload.error?.code === 'TIME_ENTRY_OVERBOOKED') {
        setSubmitConflict(payload.error);
        setMessage('工数と時間休の合計が所定労働時間を超過します');
        return;
      }
      if (payload.error?.code === 'NO_CONSULTATION_REASON_REQUIRED') {
        setMessage(
          '相談証跡が未添付の場合は「相談無し」の確認と理由の入力が必要です',
        );
        return;
      }
      setMessage('申請に失敗しました');
    } catch {
      setMessage('申請に失敗しました');
    }
  };

  const loadLeaderItems = async () => {
    if (!canOperate) {
      setLeaderMessage('ログインしてください');
      return;
    }
    const res = await apiResponse('/leave-requests/leader?limit=100');
    if (res.ok) {
      const payload = (await res.json()) as { items?: LeaderLeaveRequest[] };
      setLeaderItems(payload.items || []);
      setLeaderMessage('上長向け一覧を読み込みました');
      return;
    }
    if (res.status === 403) {
      setLeaderItems([]);
      setLeaderMessage(
        '上長一覧はプロジェクト管理者（または admin/mgmt）のみ閲覧できます',
      );
      return;
    }
    setLeaderItems([]);
    setLeaderMessage('上長向け一覧の読み込みに失敗しました');
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
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>申請単位</span>
            <select
              aria-label="休暇申請単位"
              value={form.requestUnit}
              onChange={(e) =>
                setForm((prev) => {
                  const requestUnit =
                    e.target.value === 'hourly' ? 'hourly' : 'daily';
                  if (requestUnit === 'hourly') {
                    return {
                      ...prev,
                      requestUnit,
                      endDate: prev.startDate,
                      hours: '',
                    };
                  }
                  return {
                    ...prev,
                    requestUnit,
                    startTime: '',
                    endTime: '',
                  };
                })
              }
            >
              <option value="daily">終日</option>
              <option value="hourly">時間休</option>
            </select>
          </label>
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
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  startDate: e.target.value,
                  endDate:
                    prev.requestUnit === 'hourly'
                      ? e.target.value
                      : prev.endDate,
                }))
              }
            />
          </label>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>終了</span>
            <input
              aria-label="休暇終了日"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              disabled={form.requestUnit === 'hourly'}
            />
          </label>
          {form.requestUnit === 'hourly' ? (
            <>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span>開始時刻</span>
                <input
                  aria-label="時間休開始時刻"
                  type="time"
                  step={leaveSetting.timeUnitMinutes * 60}
                  value={form.startTime}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, startTime: e.target.value }))
                  }
                />
              </label>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span>終了時刻</span>
                <input
                  aria-label="時間休終了時刻"
                  type="time"
                  step={leaveSetting.timeUnitMinutes * 60}
                  value={form.endTime}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, endTime: e.target.value }))
                  }
                />
              </label>
              <span style={{ fontSize: 12 }}>
                {hourlyMinutes !== null
                  ? `申請時間: ${hourlyMinutes}分`
                  : '申請時間: --'}
                {` / 最小単位: ${leaveSetting.timeUnitMinutes}分`}
              </span>
            </>
          ) : (
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
          )}
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
                {formatDateLabel(item.workDate)} / {item.minutes}min / project:
                {item.projectId}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="list" style={{ marginTop: 12 }}>
        {items.map((item) => {
          const duration = formatLeaveDuration(item);
          return (
            <li key={item.id}>
              <span className="badge">{item.status}</span> {item.leaveType} /{' '}
              {formatDateLabel(item.startDate)}〜{formatDateLabel(item.endDate)}
              {duration ? ` / ${duration}` : ''}
              <div>
                <button
                  className="button"
                  onClick={() => submit(item.id)}
                  disabled={item.status !== 'draft'}
                >
                  申請
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    setDraftExtraById((prev) => {
                      const current = prev[item.id];
                      const next: LeaveDraftExtra = {
                        detailsOpen: !(current?.detailsOpen ?? false),
                        noConsultationConfirmed:
                          current?.noConsultationConfirmed ?? false,
                        noConsultationReason:
                          current?.noConsultationReason ?? '',
                      };
                      return { ...prev, [item.id]: next };
                    })
                  }
                >
                  詳細
                </button>
              </div>
              {draftExtraById[item.id]?.detailsOpen && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ marginBottom: 12 }}>
                    <AnnotationsCard
                      targetKind="leave_request"
                      targetId={item.id}
                      title="相談証跡/メモ"
                    />
                  </div>
                  <div
                    className="row"
                    style={{
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <label
                      className="row"
                      style={{ gap: 6, alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        checked={
                          draftExtraById[item.id]?.noConsultationConfirmed ??
                          false
                        }
                        onChange={(e) =>
                          setDraftExtraById((prev) => ({
                            ...prev,
                            [item.id]: {
                              detailsOpen: prev[item.id]?.detailsOpen ?? true,
                              noConsultationConfirmed: e.target.checked,
                              noConsultationReason:
                                prev[item.id]?.noConsultationReason ?? '',
                            },
                          }))
                        }
                        disabled={item.status !== 'draft'}
                      />
                      <span>
                        相談無し（証跡未添付の場合に必須。理由を入力してください）
                      </span>
                    </label>
                  </div>
                  <div>
                    <textarea
                      aria-label="相談無しの理由"
                      value={
                        draftExtraById[item.id]?.noConsultationReason ?? ''
                      }
                      onChange={(e) =>
                        setDraftExtraById((prev) => ({
                          ...prev,
                          [item.id]: {
                            detailsOpen: prev[item.id]?.detailsOpen ?? true,
                            noConsultationConfirmed:
                              prev[item.id]?.noConsultationConfirmed ?? false,
                            noConsultationReason: e.target.value,
                          },
                        }))
                      }
                      placeholder="相談無しの理由（証跡未添付の場合に必須）"
                      style={{ width: '100%', minHeight: 72 }}
                      disabled={item.status !== 'draft'}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <div
          className="row"
          style={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <strong>上長向け一覧（申請後・理由非表示）</strong>
          <button className="button secondary" onClick={loadLeaderItems}>
            上長向け一覧を読み込み
          </button>
        </div>
        {leaderMessage ? (
          <p style={{ marginTop: 8, marginBottom: 8 }}>{leaderMessage}</p>
        ) : null}
        <ul className="list">
          {leaderItems.map((item) => {
            const duration = formatLeaveDuration(item);
            return (
              <li key={item.id}>
                <span className="badge">{item.status}</span>{' '}
                {item.userDisplayName
                  ? `${item.userDisplayName} (${item.userId})`
                  : item.userId}{' '}
                / {item.leaveType} / {formatDateLabel(item.startDate)}〜
                {formatDateLabel(item.endDate)}
                {duration ? ` / ${duration}` : ''}
                {item.visibleProjectIds?.length
                  ? ` / project: ${item.visibleProjectIds.join(', ')}`
                  : ''}
              </li>
            );
          })}
          {leaderItems.length === 0 ? <li>データなし</li> : null}
        </ul>
      </div>
    </div>
  );
};
