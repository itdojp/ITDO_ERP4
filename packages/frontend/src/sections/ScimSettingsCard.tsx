import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card } from '../ui';

type ScimStatus = {
  configured: boolean;
  pageMax: number;
};

function resolveScimBaseUrl() {
  if (typeof window === 'undefined') return '/scim/v2';
  try {
    return new URL('/scim/v2', window.location.origin).toString();
  } catch {
    return '/scim/v2';
  }
}

export const ScimSettingsCard: React.FC = () => {
  const [status, setStatus] = useState<ScimStatus | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const baseUrl = useMemo(resolveScimBaseUrl, []);

  const loadStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setMessage('');
      const res = await api<ScimStatus>('/scim/status');
      setStatus(res);
    } catch (err) {
      console.error('Failed to load SCIM status.', err);
      setStatus(null);
      setMessage('SCIM状態の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <Card padding="small">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>SCIM プロビジョニング</strong>
        <Button variant="secondary" onClick={loadStatus} loading={isLoading}>
          再読込
        </Button>
      </div>
      {message && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="error">{message}</Alert>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
        <div>
          状態:{' '}
          <span style={{ fontWeight: 600 }}>
            {status?.configured ? '有効' : '未設定'}
          </span>
        </div>
        <div>
          Base URL: <code>{baseUrl}</code>
        </div>
        <div>
          認可方式: Authorization: Bearer <code>{'{トークン}'}</code>
          （バックエンド環境変数 <code>SCIM_BEARER_TOKEN</code> の値）
        </div>
        <div>
          最大取得件数: {status ? status.pageMax : '-'}
        </div>
        {!status?.configured && (
          <div style={{ color: '#b45309' }}>
            SCIM_BEARER_TOKEN を設定し、バックエンドを再起動してください。
          </div>
        )}
      </div>
    </Card>
  );
};
