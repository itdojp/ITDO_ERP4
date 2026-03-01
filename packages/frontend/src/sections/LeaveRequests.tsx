import React, { useEffect, useMemo, useState } from 'react';
import { api, apiResponse, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { navigateToOpen } from '../utils/deepLink';

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

type PaidLeaveShortageWarning = {
  code: 'PAID_LEAVE_ADVANCE_WARNING' | 'PAID_LEAVE_SHORTAGE_WARNING';
  message: string;
  shortageMinutes: number;
  advanceAllowed: boolean;
  withinAdvanceLimit: boolean;
  withinNextGrantWindow: boolean;
  nextGrantDueDate: string | null;
  daysUntilNextGrant: number | null;
};

type PaidLeaveBalance = {
  userId: string;
  asOfDate: string;
  paidLeaveBaseDate: string | null;
  nextGrantDueDate: string | null;
  totalGrantedMinutes: number;
  usedApprovedMinutes: number;
  reservedPendingMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  requestedMinutes: number;
  projectedRemainingMinutes: number;
  shortageWarning?: PaidLeaveShortageWarning | null;
};

type LeaveSubmitResponse = LeaveRequest & {
  shortageWarning?: PaidLeaveShortageWarning | null;
  paidLeaveBalance?: PaidLeaveBalance | null;
};

type LeaveDraftExtra = {
  detailsOpen: boolean;
  noConsultationConfirmed: boolean;
  noConsultationReason: string;
};

type LeaveSetting = {
  timeUnitMinutes: number;
  defaultWorkdayMinutes: number;
  paidLeaveAdvanceMaxMinutes?: number;
  paidLeaveAdvanceRequireNextGrantWithinDays?: number;
};

type LeaveTypeOption = {
  code: string;
  name: string;
  isPaid: boolean;
  unit: 'daily' | 'hourly' | 'mixed';
  attachmentPolicy: 'required' | 'optional' | 'none';
  active: boolean;
  displayOrder: number;
};

type PersonalGeneralAffairsRoomResponse = {
  roomId: string;
  name?: string | null;
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
  if (minute < 0 || minute > 59) return null;
  // Align with backend parser: allow 24:00 as end-of-day.
  if (hour === 24 && minute === 0) return 24 * 60;
  if (hour < 0 || hour > 23) return null;
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
  const [paidLeaveBalance, setPaidLeaveBalance] =
    useState<PaidLeaveBalance | null>(null);
  const [paidLeaveWarning, setPaidLeaveWarning] =
    useState<PaidLeaveShortageWarning | null>(null);
  const canManageLeaveGrant = Boolean(
    auth?.groupAccountIds?.includes('general_affairs'),
  );
  const [grantTargetUserId, setGrantTargetUserId] = useState(() => userId);
  const [profileBaseDate, setProfileBaseDate] = useState('');
  const [profileNextDueDate, setProfileNextDueDate] = useState('');
  const [grantMinutes, setGrantMinutes] = useState('480');
  const [grantDate, setGrantDate] = useState('');
  const [grantExpiresAt, setGrantExpiresAt] = useState('');
  const [grantReasonText, setGrantReasonText] = useState('');
  const [grantMessage, setGrantMessage] = useState('');
  const [leaveSetting, setLeaveSetting] = useState<LeaveSetting>({
    timeUnitMinutes: 10,
    defaultWorkdayMinutes: 480,
  });
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [openingPersonalGaRoom, setOpeningPersonalGaRoom] = useState(false);
  const [personalGaRoomError, setPersonalGaRoomError] = useState('');

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

  const loadPaidLeaveBalance = async (options?: {
    targetUserId?: string;
    silent?: boolean;
  }) => {
    if (!canOperate) return;
    const targetUserId = (options?.targetUserId || userId).trim();
    if (!targetUserId) return;
    try {
      const query = `?userId=${encodeURIComponent(targetUserId)}`;
      const balance = await api<PaidLeaveBalance>(
        `/leave-entitlements/balance${query}`,
      );
      setPaidLeaveBalance(balance);
      setPaidLeaveWarning(balance.shortageWarning ?? null);
    } catch {
      if (!options?.silent) {
        setMessage('有給残高の取得に失敗しました');
      }
    }
  };

  useEffect(() => {
    const loadLeaveMetadata = async () => {
      const [settingResult, leaveTypesResult] = await Promise.allSettled([
        api<LeaveSetting>('/leave-settings'),
        api<{ items?: LeaveTypeOption[] }>('/leave-types'),
      ]);
      if (settingResult.status === 'fulfilled') {
        const setting = settingResult.value;
        if (
          Number.isInteger(setting.timeUnitMinutes) &&
          setting.timeUnitMinutes > 0 &&
          Number.isInteger(setting.defaultWorkdayMinutes) &&
          setting.defaultWorkdayMinutes > 0
        ) {
          setLeaveSetting({
            timeUnitMinutes: setting.timeUnitMinutes,
            defaultWorkdayMinutes: setting.defaultWorkdayMinutes,
          });
        }
      }
      if (leaveTypesResult.status === 'fulfilled') {
        const items = Array.isArray(leaveTypesResult.value.items)
          ? leaveTypesResult.value.items
          : [];
        setLeaveTypes(items.filter((item) => item.active !== false));
      }
    };
    void load({ silent: true });
    void loadLeaveMetadata();
    void loadPaidLeaveBalance({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaveTypes.length) return;
    if (leaveTypes.some((item) => item.code === form.leaveType)) return;
    setForm((prev) => ({ ...prev, leaveType: leaveTypes[0].code }));
  }, [leaveTypes, form.leaveType]);

  const leaveTypeLabelByCode = useMemo(
    () =>
      new Map(
        leaveTypes.map((item) => [item.code, `${item.name} (${item.code})`]),
      ),
    [leaveTypes],
  );
  const selectedLeaveType = useMemo(
    () => leaveTypes.find((item) => item.code === form.leaveType) ?? null,
    [leaveTypes, form.leaveType],
  );
  const allowedRequestUnits = useMemo<Array<'daily' | 'hourly'>>(() => {
    if (selectedLeaveType?.unit === 'daily') return ['daily'];
    if (selectedLeaveType?.unit === 'hourly') return ['hourly'];
    return ['daily', 'hourly'];
  }, [selectedLeaveType]);
  const effectiveRequestUnit = allowedRequestUnits.includes(form.requestUnit)
    ? form.requestUnit
    : allowedRequestUnits[0];

  const normalizeRequestUnit = (
    prev: typeof form,
    requestUnit: 'daily' | 'hourly',
  ) => {
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
  };

  useEffect(() => {
    if (allowedRequestUnits.includes(form.requestUnit)) return;
    setForm((prev) => normalizeRequestUnit(prev, allowedRequestUnits[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedRequestUnits, form.requestUnit]);

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
    if (
      leaveTypes.length > 0 &&
      !leaveTypes.some((item) => item.code === leaveType)
    ) {
      setMessage('休暇種別が不正です');
      return;
    }
    const startDate = form.startDate;
    const endDate = form.endDate;
    if (!startDate || !endDate) {
      setMessage('開始日/終了日は必須です');
      return;
    }
    const requestUnit = effectiveRequestUnit;
    const payload: {
      userId: string;
      leaveType: string;
      leaveUnit?: 'daily' | 'hourly';
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
      leaveUnit: requestUnit,
      notes: form.notes.trim() || undefined,
    };
    if (selectedLeaveType?.unit === 'daily' && requestUnit === 'hourly') {
      setMessage('選択した休暇種別は終日申請のみ可能です');
      return;
    }
    if (selectedLeaveType?.unit === 'hourly' && requestUnit === 'daily') {
      setMessage('選択した休暇種別は時間休申請のみ可能です');
      return;
    }
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
      setPaidLeaveWarning(null);
      setForm(buildInitialForm());
      void loadPaidLeaveBalance({ silent: true });
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
        const updated = (await res.json()) as LeaveSubmitResponse;
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        const warning = updated.shortageWarning ?? null;
        setPaidLeaveWarning(warning);
        if (updated.paidLeaveBalance) {
          setPaidLeaveBalance(updated.paidLeaveBalance);
        } else {
          void loadPaidLeaveBalance({ silent: true });
        }
        setMessage(
          warning ? `申請しました（警告: ${warning.message}）` : '申請しました',
        );
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

  const openPersonalGaRoom = async () => {
    if (!canOperate) {
      setPersonalGaRoomError('ログインしてください');
      return;
    }
    setOpeningPersonalGaRoom(true);
    setPersonalGaRoomError('');
    try {
      const room = await api<PersonalGeneralAffairsRoomResponse>(
        '/chat-rooms/personal-general-affairs',
      );
      if (!room?.roomId) {
        throw new Error('総務チャットルームの取得に失敗しました');
      }
      navigateToOpen({ kind: 'room_chat', id: room.roomId });
    } catch (_e: unknown) {
      setPersonalGaRoomError('総務チャットルームの取得に失敗しました');
    } finally {
      setOpeningPersonalGaRoom(false);
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

  const upsertEntitlementProfile = async () => {
    const targetUserId = grantTargetUserId.trim();
    if (!targetUserId) {
      setGrantMessage('対象ユーザIDを入力してください');
      return;
    }
    if (!profileBaseDate.trim()) {
      setGrantMessage('基準日を入力してください');
      return;
    }
    try {
      await api('/leave-entitlements/profiles', {
        method: 'POST',
        body: JSON.stringify({
          userId: targetUserId,
          paidLeaveBaseDate: profileBaseDate.trim(),
          nextGrantDueDate: profileNextDueDate.trim() || null,
        }),
      });
      setGrantMessage('有給付与プロファイルを更新しました');
      void loadPaidLeaveBalance({ targetUserId, silent: true });
    } catch {
      setGrantMessage('有給付与プロファイルの更新に失敗しました');
    }
  };

  const createLeaveGrant = async () => {
    const targetUserId = grantTargetUserId.trim();
    const minutes = Number(grantMinutes.trim());
    const reasonText = grantReasonText.trim();
    if (!targetUserId) {
      setGrantMessage('対象ユーザIDを入力してください');
      return;
    }
    if (
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      !Number.isInteger(minutes)
    ) {
      setGrantMessage('付与分数は1以上の整数で入力してください');
      return;
    }
    if (!reasonText) {
      setGrantMessage('理由を入力してください');
      return;
    }
    try {
      await api('/leave-entitlements/grants', {
        method: 'POST',
        body: JSON.stringify({
          userId: targetUserId,
          grantedMinutes: minutes,
          grantDate: grantDate.trim() || undefined,
          expiresAt: grantExpiresAt.trim() || null,
          reasonText,
        }),
      });
      setGrantMessage('有給付与を登録しました');
      setGrantReasonText('');
      void loadPaidLeaveBalance({ targetUserId, silent: true });
    } catch {
      setGrantMessage('有給付与の登録に失敗しました');
    }
  };

  return (
    <div>
      <h2>休暇</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="button secondary" onClick={() => load()}>
          読み込み
        </button>
        <button
          className="button secondary"
          onClick={() => loadPaidLeaveBalance()}
          disabled={!canOperate}
        >
          有給残高を再計算
        </button>
      </div>
      {message && <p>{message}</p>}
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <strong>有給残高（概算）</strong>
        {paidLeaveBalance ? (
          <ul className="list" style={{ marginTop: 8 }}>
            <li>
              付与: {paidLeaveBalance.totalGrantedMinutes}min / 消化(承認済):{' '}
              {paidLeaveBalance.usedApprovedMinutes}min / 引当(申請中):{' '}
              {paidLeaveBalance.reservedPendingMinutes}min
            </li>
            <li>残高: {paidLeaveBalance.remainingMinutes}min</li>
            <li>
              基準日: {paidLeaveBalance.paidLeaveBaseDate ?? '-'} /
              次回付与予定: {paidLeaveBalance.nextGrantDueDate ?? '-'}
            </li>
          </ul>
        ) : (
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            有給残高は未取得です
          </p>
        )}
        {paidLeaveWarning ? (
          <p
            style={{
              marginTop: 8,
              marginBottom: 0,
              fontSize: 12,
              color:
                paidLeaveWarning.code === 'PAID_LEAVE_SHORTAGE_WARNING'
                  ? '#991b1b'
                  : '#92400e',
            }}
          >
            警告: {paidLeaveWarning.message}（不足:{' '}
            {paidLeaveWarning.shortageMinutes}min）
          </p>
        ) : null}
      </div>
      {canManageLeaveGrant ? (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <strong>総務向け: 有給付与管理</strong>
          {grantMessage ? (
            <p style={{ marginTop: 8, marginBottom: 0 }}>{grantMessage}</p>
          ) : null}
          <div
            className="row"
            style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 8 }}
          >
            <input
              aria-label="有給付与対象ユーザID"
              value={grantTargetUserId}
              onChange={(e) => setGrantTargetUserId(e.target.value)}
              placeholder="対象ユーザID"
            />
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span>基準日</span>
              <input
                aria-label="有給付与基準日"
                type="date"
                value={profileBaseDate}
                onChange={(e) => setProfileBaseDate(e.target.value)}
              />
            </label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span>次回付与予定日</span>
              <input
                aria-label="有給次回付与予定日"
                type="date"
                value={profileNextDueDate}
                onChange={(e) => setProfileNextDueDate(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              onClick={upsertEntitlementProfile}
            >
              プロファイル更新
            </button>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              aria-label="有給付与分数"
              type="number"
              min={1}
              step={1}
              value={grantMinutes}
              onChange={(e) => setGrantMinutes(e.target.value)}
              placeholder="付与分数"
            />
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span>付与日</span>
              <input
                aria-label="有給付与日"
                type="date"
                value={grantDate}
                onChange={(e) => setGrantDate(e.target.value)}
              />
            </label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span>失効日</span>
              <input
                aria-label="有給失効日"
                type="date"
                value={grantExpiresAt}
                onChange={(e) => setGrantExpiresAt(e.target.value)}
              />
            </label>
            <input
              aria-label="有給付与理由"
              value={grantReasonText}
              onChange={(e) => setGrantReasonText(e.target.value)}
              placeholder="理由（必須）"
              style={{ minWidth: 260 }}
            />
            <button className="button" onClick={createLeaveGrant}>
              付与登録
            </button>
          </div>
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <strong>新規申請</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>申請単位</span>
            <select
              aria-label="休暇申請単位"
              value={effectiveRequestUnit}
              onChange={(e) =>
                setForm((prev) =>
                  normalizeRequestUnit(
                    prev,
                    e.target.value === 'hourly' ? 'hourly' : 'daily',
                  ),
                )
              }
            >
              {allowedRequestUnits.includes('daily') ? (
                <option value="daily">終日</option>
              ) : null}
              {allowedRequestUnits.includes('hourly') ? (
                <option value="hourly">時間休</option>
              ) : null}
            </select>
          </label>
          {leaveTypes.length > 0 ? (
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span>休暇種別</span>
              <select
                aria-label="休暇種別"
                value={form.leaveType}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, leaveType: e.target.value }))
                }
              >
                {leaveTypes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input
              aria-label="休暇種別"
              value={form.leaveType}
              onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
              placeholder="例: paid"
            />
          )}
          {selectedLeaveType?.attachmentPolicy === 'required' ? (
            <span style={{ fontSize: 12 }}>
              この休暇種別は申請前に証跡添付が必須です（詳細の「相談証跡/メモ」に内部参照または外部URLを追加）。
            </span>
          ) : null}
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
                    effectiveRequestUnit === 'hourly'
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
              disabled={effectiveRequestUnit === 'hourly'}
            />
          </label>
          {effectiveRequestUnit === 'hourly' ? (
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
      {submitConflict?.code === 'TIME_ENTRY_OVERBOOKED' ? (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <strong>工数と時間休の合計超過</strong>
          <p style={{ marginTop: 8, marginBottom: 8, fontSize: 12 }}>
            所定労働時間を超えています。工数または時間休を調整してください。
          </p>
          <ul className="list">
            <li>
              既存工数: {submitConflict.existingMinutes ?? 0}min / 申請時間休:{' '}
              {submitConflict.requestedLeaveMinutes ?? 0}min
            </li>
            <li>
              合計: {submitConflict.totalMinutes ?? 0}min / 所定労働時間:{' '}
              {submitConflict.defaultWorkdayMinutes ?? 0}min
            </li>
            <li>
              超過:{' '}
              {Math.max(
                0,
                (submitConflict.totalMinutes ?? 0) -
                  (submitConflict.defaultWorkdayMinutes ?? 0),
              )}
              min
            </li>
          </ul>
          {submitConflict.conflicts?.length ? (
            <ul className="list" style={{ marginTop: 8 }}>
              {submitConflict.conflicts.map((item) => (
                <li key={item.id}>
                  {formatDateLabel(item.workDate)} / {item.minutes}min /
                  project:{item.projectId}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : submitConflict?.conflicts?.length ? (
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
              <span className="badge">{item.status}</span>{' '}
              {leaveTypeLabelByCode.get(item.leaveType) ?? item.leaveType} /{' '}
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
                  <div style={{ marginBottom: 12 }}>
                    <button
                      className="button secondary"
                      onClick={openPersonalGaRoom}
                      disabled={openingPersonalGaRoom || !canOperate}
                    >
                      {openingPersonalGaRoom
                        ? '総務へ相談チャットを開いています...'
                        : '総務へ相談チャットを開く'}
                    </button>
                    <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                      公開チャットに書きにくい事務連絡は個人総務チャットで相談し、共有可能な範囲を案件チャットへ共有してください。
                    </p>
                    {personalGaRoomError ? (
                      <p
                        role="alert"
                        style={{
                          marginTop: 8,
                          marginBottom: 0,
                          color: '#b00020',
                        }}
                      >
                        {personalGaRoomError}
                      </p>
                    ) : null}
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
                / {leaveTypeLabelByCode.get(item.leaveType) ?? item.leaveType} /{' '}
                {formatDateLabel(item.startDate)}〜
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
