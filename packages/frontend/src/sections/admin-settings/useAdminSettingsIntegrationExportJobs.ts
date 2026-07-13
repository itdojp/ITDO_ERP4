import { useCallback, useState } from 'react';
import { api } from '../../api';
import { createClientIdempotencyKey } from './adminSettingsModel';
import type { IntegrationExportJobItem } from './IntegrationExportJobsCard';
import type {
  AdminSettingsErrorLogger,
  AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type UseAdminSettingsIntegrationExportJobsOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

export function useAdminSettingsIntegrationExportJobs({
  setMessage,
  logError,
}: UseAdminSettingsIntegrationExportJobsOptions) {
  const [items, setItems] = useState<IntegrationExportJobItem[]>([]);
  const [kindFilter, setKindFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [redispatchingId, setRedispatchingId] = useState<string | null>(null);

  const load = useCallback(
    async (options?: { suppressSuccessMessage?: boolean }) => {
      const query = new URLSearchParams();
      if (kindFilter.trim()) {
        query.set('kind', kindFilter.trim());
      }
      if (statusFilter.trim()) {
        query.set('status', statusFilter.trim());
      }
      query.set('limit', String(limit));
      query.set('offset', String(offset));
      setLoading(true);
      try {
        const result = await api<{ items: IntegrationExportJobItem[] }>(
          `/integrations/jobs/exports?${query.toString()}`,
        );
        setItems(result.items || []);
        if (!options?.suppressSuccessMessage) {
          setMessage('連携ジョブ一覧を取得しました');
        }
      } catch (err) {
        logError('loadIntegrationExportJobs failed', err);
        setItems([]);
        setMessage('連携ジョブ一覧の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    },
    [kindFilter, limit, offset, statusFilter, logError, setMessage],
  );

  const redispatch = useCallback(
    async (item: IntegrationExportJobItem) => {
      const idempotencyKey = createClientIdempotencyKey(
        `ui-redispatch-${item.kind}`,
      );
      setRedispatchingId(item.id);
      try {
        await api(
          `/integrations/jobs/exports/${item.kind}/${item.id}/redispatch`,
          {
            method: 'POST',
            body: JSON.stringify({ idempotencyKey }),
          },
        );
        await load({ suppressSuccessMessage: true });
        setMessage('連携ジョブを再出力しました');
      } catch (err) {
        logError('redispatchIntegrationExportJob failed', err);
        setMessage('連携ジョブの再出力に失敗しました');
      } finally {
        setRedispatchingId((current) => (current === item.id ? null : current));
      }
    },
    [load, logError, setMessage],
  );

  return {
    items,
    kindFilter,
    setKindFilter,
    statusFilter,
    setStatusFilter,
    limit,
    setLimit,
    offset,
    setOffset,
    loading,
    redispatchingId,
    load,
    redispatch,
  };
}
