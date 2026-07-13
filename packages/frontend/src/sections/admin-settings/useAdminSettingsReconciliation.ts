import { useCallback, useRef, useState } from 'react';
import { api } from '../../api';
import {
  currentPeriodKey,
  RECONCILIATION_PERIOD_KEY_PATTERN,
} from './adminSettingsModel';
import type {
  IntegrationReconciliationDetails,
  IntegrationReconciliationSummary,
} from './IntegrationReconciliationCard';
import type {
  AdminSettingsErrorLogger,
  AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type UseAdminSettingsReconciliationOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

export function useAdminSettingsReconciliation({
  setMessage,
  logError,
}: UseAdminSettingsReconciliationOptions) {
  const [periodKey, setPeriodKey] = useState<string>(currentPeriodKey);
  const [summary, setSummary] =
    useState<IntegrationReconciliationSummary | null>(null);
  const [details, setDetails] =
    useState<IntegrationReconciliationDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const detailsRequestId = useRef<number>(0);

  const clearDetails = useCallback(() => {
    setSummary(null);
    setDetails(null);
    setDetailsLoading(false);
    setDetailsError(null);
  }, []);

  const updatePeriodKey = useCallback(
    (value: string) => {
      detailsRequestId.current += 1;
      setPeriodKey(value);
      clearDetails();
    },
    [clearDetails],
  );

  const loadSummary = useCallback(async () => {
    const trimmedPeriodKey = periodKey.trim();
    if (!RECONCILIATION_PERIOD_KEY_PATTERN.test(trimmedPeriodKey)) {
      detailsRequestId.current += 1;
      clearDetails();
      setMessage('照合対象月は YYYY-MM 形式で入力してください');
      return;
    }
    try {
      const nextSummary = await api<IntegrationReconciliationSummary>(
        `/integrations/reconciliation/summary?periodKey=${encodeURIComponent(trimmedPeriodKey)}`,
      );
      detailsRequestId.current += 1;
      setSummary(nextSummary);
      setDetails(null);
      setDetailsLoading(false);
      setDetailsError(null);
      setMessage('連携照合サマリを取得しました');
    } catch (err) {
      logError('loadIntegrationReconciliationSummary failed', err);
      detailsRequestId.current += 1;
      clearDetails();
      setMessage('連携照合サマリの取得に失敗しました');
    }
  }, [clearDetails, periodKey, logError, setMessage]);

  const loadDetails = useCallback(async () => {
    const trimmedPeriodKey = periodKey.trim();
    if (!RECONCILIATION_PERIOD_KEY_PATTERN.test(trimmedPeriodKey)) {
      setDetails(null);
      setDetailsError('照合対象月は YYYY-MM 形式で入力してください');
      setMessage('照合対象月は YYYY-MM 形式で入力してください');
      return;
    }
    const requestId = detailsRequestId.current + 1;
    detailsRequestId.current = requestId;
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const nextDetails = await api<IntegrationReconciliationDetails>(
        `/integrations/reconciliation/details?periodKey=${encodeURIComponent(trimmedPeriodKey)}`,
      );
      if (detailsRequestId.current !== requestId) {
        return;
      }
      if (nextDetails.periodKey !== trimmedPeriodKey) {
        setDetails(null);
        setDetailsError('連携照合詳細の対象月がリクエストと一致しません');
        setMessage('連携照合詳細の対象月がリクエストと一致しません');
        return;
      }
      setDetails(nextDetails);
      setMessage('連携照合詳細を取得しました');
    } catch (err) {
      if (detailsRequestId.current !== requestId) {
        return;
      }
      logError('loadIntegrationReconciliationDetails failed', err);
      setDetails(null);
      setDetailsError('連携照合詳細の取得に失敗しました');
      setMessage('連携照合詳細の取得に失敗しました');
    } finally {
      if (detailsRequestId.current === requestId) {
        setDetailsLoading(false);
      }
    }
  }, [periodKey, logError, setMessage]);

  return {
    periodKey,
    setPeriodKey: updatePeriodKey,
    summary,
    details,
    detailsLoading,
    detailsError,
    loadSummary,
    loadDetails,
  };
}
