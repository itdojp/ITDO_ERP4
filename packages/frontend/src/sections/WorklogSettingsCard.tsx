import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type WorklogSetting = {
  id: string;
  editableDays?: number | null;
};

export const WorklogSettingsCard: React.FC = () => {
  const [editableDays, setEditableDays] = useState(14);
  const [editableDaysInput, setEditableDaysInput] = useState('14');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const normalizeEditableDays = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    if (normalized < 1) return 1;
    if (normalized > 365) return 365;
    return normalized;
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const res = await api<WorklogSetting>('/worklog-settings');
      if (typeof res.editableDays === 'number') {
        setEditableDays(res.editableDays);
        setEditableDaysInput(String(res.editableDays));
      }
    } catch (err) {
      console.error('Failed to load worklog settings.', err);
      setMessage('日報/工数設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const normalized = normalizeEditableDays(editableDaysInput);
      if (!normalized) {
        setMessage('1〜365 の数値を入力してください');
        setIsLoading(false);
        return;
      }
      await api<WorklogSetting>('/worklog-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editableDays: normalized }),
      });
      setEditableDays(normalized);
      setEditableDaysInput(String(normalized));
      setMessage('保存しました');
    } catch (err) {
      console.error('Failed to update worklog settings.', err);
      setMessage('保存に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [editableDays]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>日報/工数 訂正ポリシー</strong>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
        遡及可能期間（workDate/reportDate 基準）
      </div>
      {message && <div style={{ marginTop: 8 }}>{message}</div>}
      <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          期間（日）
          <input
            type="number"
            min={1}
            max={365}
            value={editableDaysInput}
            onChange={(e) => setEditableDaysInput(e.target.value)}
            onBlur={() => {
              const normalized = normalizeEditableDays(editableDaysInput);
              if (normalized) {
                setEditableDays(normalized);
                setEditableDaysInput(String(normalized));
              }
            }}
            disabled={isLoading}
            style={{ width: 120 }}
          />
        </label>
        <button className="button" onClick={save} disabled={isLoading}>
          保存
        </button>
        <button
          className="button secondary"
          onClick={load}
          disabled={isLoading}
        >
          再読込
        </button>
      </div>
    </div>
  );
};
