import { useCallback, useRef, useState } from 'react';
import { api } from '../../api';
import {
  createDefaultIntegrationForm,
  type IntegrationRun,
  type IntegrationSetting,
} from './adminSettingsModel';
import type { IntegrationRunMetrics } from './IntegrationSettingsCard';
import {
  parseAdminSettingsJson,
  type AdminSettingsErrorLogger,
  type AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type UseAdminSettingsIntegrationsOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

export function useAdminSettingsIntegrations({
  setMessage,
  logError,
}: UseAdminSettingsIntegrationsOptions) {
  const [items, setItems] = useState<IntegrationSetting[]>([]);
  const [runs, setRuns] = useState<IntegrationRun[]>([]);
  const [metrics, setMetrics] = useState<IntegrationRunMetrics | null>(null);
  const [runFilterId, setRunFilterId] = useState<string>('');
  const [form, setForm] = useState(createDefaultIntegrationForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: IntegrationSetting[] }>(
        '/integration-settings',
      );
      setItems(res.items || []);
    } catch (err) {
      logError('loadIntegrationSettings failed', err);
      setItems([]);
    }
  }, [logError]);

  const loadRuns = useCallback(
    async (settingId?: string) => {
      const runQuery = new URLSearchParams();
      if (settingId) {
        runQuery.set('settingId', settingId);
      }
      runQuery.set('limit', '50');
      const runSuffix = runQuery.toString();
      const metricsQuery = new URLSearchParams();
      if (settingId) {
        metricsQuery.set('settingId', settingId);
      }
      metricsQuery.set('days', '30');
      const metricsSuffix = metricsQuery.toString();
      const [runsResult, metricsResult] = await Promise.allSettled([
        api<{ items: IntegrationRun[] }>(
          `/integration-runs${runSuffix ? `?${runSuffix}` : ''}`,
        ),
        api<IntegrationRunMetrics>(
          `/integration-runs/metrics${metricsSuffix ? `?${metricsSuffix}` : ''}`,
        ),
      ]);

      if (runsResult.status === 'fulfilled') {
        setRuns(runsResult.value.items || []);
      } else {
        logError('loadIntegrationRuns failed', runsResult.reason);
        setRuns([]);
      }

      if (metricsResult.status === 'fulfilled') {
        setMetrics(metricsResult.value || null);
      } else {
        logError('loadIntegrationRunMetrics failed', metricsResult.reason);
        setMetrics(null);
      }
    },
    [logError],
  );

  const resetForm = useCallback(() => {
    setForm(createDefaultIntegrationForm());
    setEditingId(null);
  }, []);

  const submit = useCallback(async () => {
    if (!form.type.trim()) {
      setMessage('連携種別を選択してください');
      return;
    }
    const config = parseAdminSettingsJson(
      'config',
      form.configJson,
      setMessage,
    );
    if (config === null) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const payload = {
      type: form.type,
      name: form.name.trim() || undefined,
      provider: form.provider.trim() || undefined,
      status: form.status || undefined,
      schedule: form.schedule.trim() || undefined,
      config: config || undefined,
    };
    try {
      if (editingId) {
        await api(`/integration-settings/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('連携設定を更新しました');
      } else {
        await api('/integration-settings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('連携設定を作成しました');
      }
      await load();
      resetForm();
    } catch (err) {
      logError('submitIntegrationSetting failed', err);
      setMessage('連携設定の保存に失敗しました');
    } finally {
      submitInFlightRef.current = false;
    }
  }, [editingId, form, load, logError, resetForm, setMessage]);

  const startEdit = useCallback((item: IntegrationSetting) => {
    setEditingId(item.id);
    setForm({
      type: item.type,
      name: item.name || '',
      provider: item.provider || '',
      status: item.status || 'active',
      schedule: item.schedule || '',
      configJson: item.config ? JSON.stringify(item.config, null, 2) : '',
    });
  }, []);

  const run = useCallback(
    async (id: string) => {
      try {
        await api(`/integration-settings/${id}/run`, { method: 'POST' });
        setMessage('連携を実行しました');
        await load();
      } catch (err) {
        logError('runIntegrationSetting failed', err);
        setMessage('連携の実行に失敗しました');
      }
    },
    [load, logError, setMessage],
  );

  return {
    items,
    runs,
    metrics,
    runFilterId,
    setRunFilterId,
    form,
    setForm,
    editingId,
    load,
    loadRuns,
    submit,
    resetForm,
    startEdit,
    run,
  };
}
