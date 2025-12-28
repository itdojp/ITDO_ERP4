import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type AnalyticsItem = {
  bucket: string;
  users: number;
  entries: number;
  notGoodCount: number;
  notGoodRate: number;
  helpRequestedCount: number;
};

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

  const loadGroupAnalytics = useCallback(async () => {
    try {
      setIsLoadingGroup(true);
      setGroupError('');
      const query = buildQuery({
        from,
        to,
        minUsers,
        groupBy: 'group',
      });
      const response = await api<{ items: AnalyticsItem[] }>(`/wellbeing-analytics?${query}`);
      setGroupItems(response.items || []);
      setSelectedGroup((prev) => prev || response.items?.[0]?.bucket || '');
    } catch (error) {
      console.error('匿名集計の取得に失敗しました', error);
      setGroupError('匿名集計の取得に失敗しました');
    } finally {
      setIsLoadingGroup(false);
    }
  }, [buildQuery, from, minUsers, to]);

  const loadMonthlyAnalytics = useCallback(
    async (groupId: string) => {
      if (!groupId) {
        setMonthlyItems([]);
        return;
      }
      try {
        setIsLoadingMonthly(true);
        setMonthlyError('');
        const query = buildQuery({
          from,
          to,
          minUsers,
          groupBy: 'month',
          visibilityGroupId: groupId,
        });
        const response = await api<{ items: AnalyticsItem[] }>(`/wellbeing-analytics?${query}`);
        setMonthlyItems(response.items || []);
      } catch (error) {
        console.error('時系列集計の取得に失敗しました', error);
        setMonthlyError('時系列集計の取得に失敗しました');
      } finally {
        setIsLoadingMonthly(false);
      }
    },
    [buildQuery, from, minUsers, to],
  );

  useEffect(() => {
    void loadGroupAnalytics();
  }, [loadGroupAnalytics]);

  useEffect(() => {
    void loadMonthlyAnalytics(selectedGroup);
  }, [loadMonthlyAnalytics, selectedGroup]);

  const groupOptions = useMemo(
    () => groupItems.map((item) => item.bucket),
    [groupItems],
  );

  const formatRate = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div>
      <h2>匿名集計（人事向け）</h2>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          開始日
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ marginLeft: 6 }}
          />
        </label>
        <label>
          終了日
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ marginLeft: 6 }}
          />
        </label>
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
        <button className="button secondary" onClick={loadGroupAnalytics} disabled={isLoadingGroup}>
          {isLoadingGroup ? '更新中...' : '更新'}
        </button>
      </div>
      <p className="badge" style={{ marginTop: 8 }}>{minUsers}人未満は非表示</p>
      {groupError && <p style={{ color: '#dc2626' }}>{groupError}</p>}
      <ul className="list">
        {groupItems.map((item) => (
          <li key={item.bucket}>
            <strong>{item.bucket}</strong> ({item.users}人)
            <div>
              Not Good: {formatRate(item.notGoodRate)} ({item.notGoodCount}/{item.entries}) / ヘルプ要請: {item.helpRequestedCount}件
            </div>
          </li>
        ))}
        {groupItems.length === 0 && !groupError && <li>表示可能なデータなし</li>}
      </ul>
      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <strong>時系列</strong>
          <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
            <option value="">グループを選択</option>
            {groupOptions.map((groupId) => (
              <option key={groupId} value={groupId}>
                {groupId}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            onClick={() => loadMonthlyAnalytics(selectedGroup)}
            disabled={!selectedGroup || isLoadingMonthly}
          >
            {isLoadingMonthly ? '更新中...' : '更新'}
          </button>
        </div>
        {monthlyError && <p style={{ color: '#dc2626' }}>{monthlyError}</p>}
        <ul className="list">
          {monthlyItems.map((item) => (
            <li key={item.bucket}>
              <strong>{item.bucket}</strong> / Not Good: {formatRate(item.notGoodRate)} ({item.notGoodCount}/{item.entries}) / ヘルプ要請: {item.helpRequestedCount}件
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
