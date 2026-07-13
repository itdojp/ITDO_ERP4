import { useCallback, useRef, useState } from 'react';
import { api } from '../../api';
import {
  createDefaultReportForm,
  parseCsv,
  type ReportDelivery,
  type ReportSubscription,
} from './adminSettingsModel';
import {
  parseAdminSettingsJson,
  type AdminSettingsErrorLogger,
  type AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type UseAdminSettingsReportsOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

export function useAdminSettingsReports({
  setMessage,
  logError,
}: UseAdminSettingsReportsOptions) {
  const [items, setItems] = useState<ReportSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<ReportDelivery[]>([]);
  const [form, setForm] = useState(createDefaultReportForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deliveryFilterId, setDeliveryFilterId] = useState<string>('');
  const [dryRun, setDryRun] = useState(true);
  const submitInFlightRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: ReportSubscription[] }>(
        '/report-subscriptions',
      );
      setItems(res.items || []);
    } catch (err) {
      logError('loadReportSubscriptions failed', err);
      setItems([]);
    }
  }, [logError]);

  const loadDeliveries = useCallback(
    async (subscriptionId?: string) => {
      try {
        const query = new URLSearchParams();
        if (subscriptionId) {
          query.set('subscriptionId', subscriptionId);
        }
        const suffix = query.toString();
        const res = await api<{ items: ReportDelivery[] }>(
          `/report-deliveries${suffix ? `?${suffix}` : ''}`,
        );
        setDeliveries(res.items || []);
      } catch (err) {
        logError('loadReportDeliveries failed', err);
        setDeliveries([]);
      }
    },
    [logError],
  );

  const resetForm = useCallback(() => {
    setForm(createDefaultReportForm());
    setEditingId(null);
  }, []);

  const submit = useCallback(async () => {
    const reportKey = form.reportKey.trim();
    if (!reportKey) {
      setMessage('reportKey を入力してください');
      return;
    }
    const params = parseAdminSettingsJson(
      'params',
      form.paramsJson,
      setMessage,
    );
    if (params === null) return;
    const recipients = parseAdminSettingsJson(
      'recipients',
      form.recipientsJson,
      setMessage,
    );
    if (recipients === null) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const channels = parseCsv(form.channels);
    const payload = {
      name: form.name.trim() || undefined,
      reportKey,
      format: form.format || undefined,
      schedule: form.schedule.trim() || undefined,
      params: params || undefined,
      recipients: recipients || undefined,
      channels: channels.length ? channels : undefined,
      isEnabled: form.isEnabled,
    };
    try {
      if (editingId) {
        await api(`/report-subscriptions/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('レポート購読を更新しました');
      } else {
        await api('/report-subscriptions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('レポート購読を作成しました');
      }
      await load();
      resetForm();
    } catch (err) {
      logError('submitReportSubscription failed', err);
      setMessage(editingId ? '更新に失敗しました' : '保存に失敗しました');
    } finally {
      submitInFlightRef.current = false;
    }
  }, [editingId, form, load, logError, resetForm, setMessage]);

  const startEdit = useCallback((item: ReportSubscription) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      reportKey: item.reportKey || '',
      format: item.format || 'csv',
      schedule: item.schedule || '',
      paramsJson: item.params ? JSON.stringify(item.params, null, 2) : '',
      recipientsJson: item.recipients
        ? JSON.stringify(item.recipients, null, 2)
        : '',
      channels: (item.channels || []).join(','),
      isEnabled: item.isEnabled ?? true,
    });
  }, []);

  const toggle = useCallback(
    async (item: ReportSubscription) => {
      const nextEnabled = !(item.isEnabled ?? true);
      try {
        await api(`/report-subscriptions/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isEnabled: nextEnabled }),
        });
        setMessage(
          nextEnabled
            ? 'レポート購読を有効化しました'
            : 'レポート購読を無効化しました',
        );
        await load();
      } catch (err) {
        logError('toggleReportSubscription failed', err);
        setMessage('レポート購読の更新に失敗しました');
      }
    },
    [load, logError, setMessage],
  );

  const run = useCallback(
    async (id: string) => {
      try {
        await api(`/report-subscriptions/${id}/run`, {
          method: 'POST',
          body: JSON.stringify({ dryRun }),
        });
        setMessage('レポートを実行しました');
        await load();
        if (!dryRun) {
          setDeliveryFilterId(id);
          await loadDeliveries(id);
        }
      } catch (err) {
        logError('runReportSubscription failed', err);
        setMessage('レポート実行に失敗しました');
      }
    },
    [dryRun, load, loadDeliveries, logError, setMessage],
  );

  const runAll = useCallback(async () => {
    try {
      const res = await api<{ count?: number }>(
        '/jobs/report-subscriptions/run',
        {
          method: 'POST',
          body: JSON.stringify({ dryRun }),
        },
      );
      const count = res?.count ?? 0;
      setMessage(`レポートを実行しました (${count}件)`);
      await load();
      if (!dryRun) {
        await loadDeliveries(deliveryFilterId || undefined);
      }
    } catch (err) {
      logError('runAllReportSubscriptions failed', err);
      setMessage('一括実行に失敗しました');
    }
  }, [deliveryFilterId, dryRun, load, loadDeliveries, logError, setMessage]);

  const showDeliveries = useCallback(
    async (subscriptionId?: string) => {
      setDeliveryFilterId(subscriptionId || '');
      await loadDeliveries(subscriptionId);
    },
    [loadDeliveries],
  );

  return {
    items,
    deliveries,
    form,
    setForm,
    editingId,
    deliveryFilterId,
    setDeliveryFilterId,
    dryRun,
    setDryRun,
    load,
    loadDeliveries,
    submit,
    resetForm,
    startEdit,
    toggle,
    run,
    runAll,
    showDeliveries,
  };
}
