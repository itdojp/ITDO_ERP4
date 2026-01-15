import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Button, Card, EmptyState, Input } from '../ui';

type JobResult = Record<string, unknown> | null;

type JobState = {
  result: JobResult;
  error: string;
  loading: boolean;
};

type JobKey =
  | 'alerts'
  | 'approvalEscalations'
  | 'dataQuality'
  | 'reportSubscriptions'
  | 'reportDeliveries'
  | 'notificationDeliveries'
  | 'recurringProjects'
  | 'integrations';

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildInitialState = (): Record<JobKey, JobState> => ({
  alerts: { result: null, error: '', loading: false },
  approvalEscalations: { result: null, error: '', loading: false },
  dataQuality: { result: null, error: '', loading: false },
  reportSubscriptions: { result: null, error: '', loading: false },
  reportDeliveries: { result: null, error: '', loading: false },
  notificationDeliveries: { result: null, error: '', loading: false },
  recurringProjects: { result: null, error: '', loading: false },
  integrations: { result: null, error: '', loading: false },
});

export const AdminJobs: React.FC = () => {
  const [jobs, setJobs] = useState<Record<JobKey, JobState>>(buildInitialState);
  const [reportDryRun, setReportDryRun] = useState(false);
  const [reportRetryDryRun, setReportRetryDryRun] = useState(false);
  const [notificationDryRun, setNotificationDryRun] = useState(false);
  const [notificationLimit, setNotificationLimit] = useState('50');

  const notificationLimitError = useMemo(() => {
    if (!notificationLimit.trim()) return '';
    const parsed = Number(notificationLimit);
    if (!Number.isFinite(parsed)) return 'limit は有効な数値で入力してください';
    if (parsed < 1 || parsed > 200) return 'limit は 1-200 で入力してください';
    return '';
  }, [notificationLimit]);

  const updateJob = (key: JobKey, next: Partial<JobState>) => {
    setJobs((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...next },
    }));
  };

  const runJob = async (
    key: JobKey,
    path: string,
    body?: Record<string, unknown>,
  ) => {
    try {
      updateJob(key, { loading: true, error: '' });
      const result = await api<JobResult>(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      updateJob(key, { result, loading: false });
    } catch (err) {
      updateJob(key, {
        error: 'ジョブ実行に失敗しました',
        loading: false,
      });
    }
  };

  const runAlerts = () => runJob('alerts', '/jobs/alerts/run');
  const runEscalations = () =>
    runJob('approvalEscalations', '/jobs/approval-escalations/run');
  const runDataQuality = () => runJob('dataQuality', '/jobs/data-quality/run');
  const runReportSubscriptions = () =>
    runJob('reportSubscriptions', '/jobs/report-subscriptions/run', {
      dryRun: reportDryRun,
    });
  const runReportDeliveries = () =>
    runJob('reportDeliveries', '/jobs/report-deliveries/retry', {
      dryRun: reportRetryDryRun,
    });
  const runNotificationDeliveries = () => {
    if (notificationLimitError) {
      updateJob('notificationDeliveries', { error: notificationLimitError });
      return;
    }
    const limit = notificationLimit.trim()
      ? Number(notificationLimit)
      : undefined;
    runJob('notificationDeliveries', '/jobs/notification-deliveries/run', {
      dryRun: notificationDryRun,
      ...(limit ? { limit } : {}),
    });
  };
  const runRecurringProjects = () =>
    runJob('recurringProjects', '/jobs/recurring-projects/run');
  const runIntegrations = () =>
    runJob('integrations', '/jobs/integrations/run');

  const renderResult = (key: JobKey) => {
    const state = jobs[key];
    if (state.error) {
      return <Alert variant="error">{state.error}</Alert>;
    }
    if (!state.result) {
      return <EmptyState title="未実行" />;
    }
    return (
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 12,
          color: '#0f172a',
        }}
      >
        {formatJson(state.result)}
      </pre>
    );
  };

  return (
    <div>
      <h2>運用ジョブ</h2>
      <Card padding="small">
        <h3 style={{ marginTop: 0 }}>アラート/承認/品質</h3>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <Button onClick={runAlerts} loading={jobs.alerts.loading}>
            アラート計算
          </Button>
          <Button
            variant="secondary"
            onClick={runEscalations}
            loading={jobs.approvalEscalations.loading}
          >
            承認エスカレーション
          </Button>
          <Button
            variant="secondary"
            onClick={runDataQuality}
            loading={jobs.dataQuality.loading}
          >
            データ品質チェック
          </Button>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div>
            <strong>アラート計算</strong>
            {renderResult('alerts')}
          </div>
          <div>
            <strong>承認エスカレーション</strong>
            {renderResult('approvalEscalations')}
          </div>
          <div>
            <strong>データ品質チェック</strong>
            {renderResult('dataQuality')}
          </div>
        </div>
      </Card>

      <Card padding="small">
        <h3 style={{ marginTop: 0 }}>レポート配信</h3>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <label className="badge" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reportDryRun}
              onChange={(e) => setReportDryRun(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            dryRun
          </label>
          <Button
            onClick={runReportSubscriptions}
            loading={jobs.reportSubscriptions.loading}
          >
            予約レポート実行
          </Button>
          <label className="badge" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reportRetryDryRun}
              onChange={(e) => setReportRetryDryRun(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            dryRun
          </label>
          <Button
            variant="secondary"
            onClick={runReportDeliveries}
            loading={jobs.reportDeliveries.loading}
          >
            配信リトライ
          </Button>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div>
            <strong>予約レポート実行</strong>
            {renderResult('reportSubscriptions')}
          </div>
          <div>
            <strong>配信リトライ</strong>
            {renderResult('reportDeliveries')}
          </div>
        </div>
      </Card>

      <Card padding="small">
        <h3 style={{ marginTop: 0 }}>通知配信</h3>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <label className="badge" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={notificationDryRun}
              onChange={(e) => setNotificationDryRun(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            dryRun
          </label>
          <Input
            label="limit"
            type="number"
            min={1}
            max={200}
            value={notificationLimit}
            onChange={(e) => setNotificationLimit(e.target.value)}
            error={notificationLimitError || undefined}
          />
          <Button
            onClick={runNotificationDeliveries}
            loading={jobs.notificationDeliveries.loading}
          >
            通知配信
          </Button>
        </div>
        <div style={{ marginTop: 12 }}>
          {renderResult('notificationDeliveries')}
        </div>
      </Card>

      <Card padding="small">
        <h3 style={{ marginTop: 0 }}>定期案件/外部連携</h3>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <Button
            onClick={runRecurringProjects}
            loading={jobs.recurringProjects.loading}
          >
            定期案件生成
          </Button>
          <Button
            variant="secondary"
            onClick={runIntegrations}
            loading={jobs.integrations.loading}
          >
            連携ジョブ実行
          </Button>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div>
            <strong>定期案件生成</strong>
            {renderResult('recurringProjects')}
          </div>
          <div>
            <strong>連携ジョブ実行</strong>
            {renderResult('integrations')}
          </div>
        </div>
      </Card>
    </div>
  );
};
