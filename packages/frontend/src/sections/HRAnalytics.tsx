import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../api';
import { DateRangePicker } from '../ui';

type AnalyticsItem = {
  bucket: string;
  users: number;
  entries: number;
  notGoodCount: number;
  notGoodRate: number;
  helpRequestedCount: number;
};

function getRangeError(fromValue: string, toValue: string) {
  if (!fromValue || !toValue) return '';
  const fromDate = new Date(fromValue);
  const toDate = new Date(toValue);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return '日付が不正です';
  }
  if (fromDate > toDate) {
    return '開始日は終了日以前にしてください';
  }
  return '';
}

export const HRAnalytics: React.FC = () => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minUsers, setMinUsers] = useState(5);
  const [groupItems, setGroupItems] = useState<AnalyticsItem[]>([]);
  const [monthlyItems, setMonthlyItems] = useState<AnalyticsItem[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groupError, setGroupError] = useState('');
  const [monthlyError, setMonthlyError] = useState('');
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [isLoadingMonthly, setIsLoadingMonthly] = useState(false);
  const initialLoadRef = useRef(false);
  const lastGroupRef = useRef('');

  const buildQuery = useCallback(
    (params: Record<string, string | number | undefined>) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === '') return;
        search.set(key, String(value));
      });
      return search.toString();
    },
    [],
  );

  const loadGroupAnalytics = useCallback(
    async (params: { from: string; to: string; minUsers: number }) => {
      const rangeError = getRangeError(params.from, params.to);
      if (rangeError) {
        setGroupError(rangeError);
        return;
      }
      setGroupError('');
      try {
        setIsLoadingGroup(true);
        const query = buildQuery({
          from: params.from,
          to: params.to,
          minUsers: params.minUsers,
          groupBy: 'group',
        });
        const response = await api<{ items: AnalyticsItem[] }>(
          `/wellbeing-analytics?${query}`,
        );
        setGroupItems(response.items || []);
        setSelectedGroup((prev) => prev || response.items?.[0]?.bucket || '');
      } catch (error) {
        console.error('匿名集計の取得に失敗しました', error);
        setGroupError('匿名集計の取得に失敗しました');
      } finally {
        setIsLoadingGroup(false);
      }
    },
    [buildQuery],
  );

  const loadMonthlyAnalytics = useCallback(
    async (
      groupId: string,
      params: { from: string; to: string; minUsers: number },
    ) => {
      if (!groupId) {
        setMonthlyItems([]);
        return;
      }
      const rangeError = getRangeError(params.from, params.to);
      if (rangeError) {
        setMonthlyError(rangeError);
        return;
      }
      try {
        setIsLoadingMonthly(true);
        setMonthlyError('');
        const query = buildQuery({
          from: params.from,
          to: params.to,
          minUsers: params.minUsers,
          groupBy: 'month',
          visibilityGroupId: groupId,
        });
        const response = await api<{ items: AnalyticsItem[] }>(
          `/wellbeing-analytics?${query}`,
        );
        setMonthlyItems(response.items || []);
      } catch (error) {
        console.error('時系列集計の取得に失敗しました', error);
        setMonthlyError('時系列集計の取得に失敗しました');
      } finally {
        setIsLoadingMonthly(false);
      }
    },
    [buildQuery],
  );

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    void loadGroupAnalytics({ from, to, minUsers });
  }, [loadGroupAnalytics, from, to, minUsers]);

  useEffect(() => {
    if (!selectedGroup) {
      setMonthlyItems([]);
      return;
    }
    if (lastGroupRef.current === selectedGroup) return;
    lastGroupRef.current = selectedGroup;
    void loadMonthlyAnalytics(selectedGroup, { from, to, minUsers });
  }, [loadMonthlyAnalytics, selectedGroup, from, to, minUsers]);

  const groupOptions = useMemo(
    () => groupItems.map((item) => item.bucket),
    [groupItems],
  );

  const formatRate = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div>
      <h2>匿名集計（人事向け）</h2>
      <div
        className="row"
        style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <DateRangePicker
          label="集計期間"
          fromLabel="開始日"
          toLabel="終了日"
          value={{ from, to }}
          onChange={(next) => {
            setFrom(next.from ?? '');
            setTo(next.to ?? '');
          }}
        />
        <label>
          閾値
          <input
            type="number"
            min={1}
            value={minUsers}
            onChange={(e) => {
              const next = Number(e.target.value);
              setMinUsers(Number.isFinite(next) && next > 0 ? next : 1);
            }}
            style={{ width: 72, marginLeft: 6 }}
          />
        </label>
        <button
          className="button secondary"
          onClick={() => loadGroupAnalytics({ from, to, minUsers })}
          disabled={isLoadingGroup}
        >
          {isLoadingGroup ? '更新中...' : '更新'}
        </button>
      </div>
      <p className="badge" style={{ marginTop: 8 }}>
        {minUsers}人未満は非表示
      </p>
      {groupError && <p style={{ color: '#dc2626' }}>{groupError}</p>}
      <ul className="list">
        {groupItems.map((item) => (
          <li key={item.bucket}>
            <strong>{item.bucket}</strong> ({item.users}人)
            <div>
              Not Good: {formatRate(item.notGoodRate)} ({item.notGoodCount}/
              {item.entries}) / ヘルプ要請: {item.helpRequestedCount}件
            </div>
          </li>
        ))}
        {groupItems.length === 0 && !groupError && (
          <li>表示可能なデータなし</li>
        )}
      </ul>
      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <strong>時系列</strong>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
          >
            <option value="">グループを選択</option>
            {groupOptions.map((groupId) => (
              <option key={groupId} value={groupId}>
                {groupId}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            onClick={() =>
              loadMonthlyAnalytics(selectedGroup, { from, to, minUsers })
            }
            disabled={!selectedGroup || isLoadingMonthly}
          >
            {isLoadingMonthly ? '更新中...' : '更新'}
          </button>
        </div>
        {monthlyError && <p style={{ color: '#dc2626' }}>{monthlyError}</p>}
        <ul className="list">
          {monthlyItems.map((item) => (
            <li key={item.bucket}>
              <strong>{item.bucket}</strong> / Not Good:{' '}
              {formatRate(item.notGoodRate)} ({item.notGoodCount}/{item.entries}
              ) / ヘルプ要請: {item.helpRequestedCount}件
            </li>
          ))}
          {selectedGroup && monthlyItems.length === 0 && !monthlyError && (
            <li>表示可能なデータなし</li>
          )}
        </ul>
      </div>
      <p style={{ fontSize: 12, color: '#475569' }}>
        個人特定を避けるため閾値未満は非表示。評価目的での利用は禁止。
      </p>
    </div>
  );
};
