import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSettings } from './AdminSettings';

const { api, getAuthState } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
}));

const { alertDraftState } = vi.hoisted(() => ({
  alertDraftState: {
    isDirty: false,
    status: 'idle',
    lastSavedAt: null as string | null,
    errorMessage: '',
    hasRestorableDraft: false,
    restoreDraft: vi.fn(),
    saveNow: vi.fn(),
    clearDraft: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api, getAuthState }));

type AlertCardProps = {
  items: unknown[];
  wizard: {
    labels: { cancel: string };
    onCancel: () => void;
  };
  onReload: () => void | Promise<void>;
  onEdit: (item: unknown) => void;
};

type TemplateCardProps = {
  templateForm: { kind: string; templateId: string };
  items: unknown[];
  setTemplateForm: React.Dispatch<
    React.SetStateAction<{ kind: string; templateId: string }>
  >;
  onEdit: (item: unknown) => void;
};

type ReportSubscriptionsCardProps = {
  items: unknown[];
  deliveries: unknown[];
  reportDeliveryFilterId: string;
  setReportDeliveryFilterId: (value: string) => void;
  onShowDeliveries: (subscriptionId?: string) => void | Promise<void>;
};

type IntegrationSettingsCardProps = {
  items: unknown[];
  runs: unknown[];
  metrics: unknown;
  integrationRunFilterId: string;
  setIntegrationRunFilterId: (value: string) => void;
  onShowRuns: (settingId?: string) => void | Promise<void>;
};

vi.mock('../ui', () => ({
  PolicyFormBuilder: () => <div data-testid="policy-form-builder" />,
  createLocalStorageDraftAutosaveAdapter: () => ({ kind: 'local-storage' }),
  useDraftAutosave: () => alertDraftState,
}));

vi.mock('./ChatSettingsCard', () => ({
  ChatSettingsCard: () => <div data-testid="chat-settings-card" />,
}));
vi.mock('./ChatRoomSettingsCard', () => ({
  ChatRoomSettingsCard: () => <div data-testid="chat-room-settings-card" />,
}));
vi.mock('./GroupManagementCard', () => ({
  GroupManagementCard: () => <div data-testid="group-management-card" />,
}));
vi.mock('./ScimSettingsCard', () => ({
  ScimSettingsCard: () => <div data-testid="scim-settings-card" />,
}));
vi.mock('./RateCardSettingsCard', () => ({
  RateCardSettingsCard: () => <div data-testid="rate-card-settings-card" />,
}));
vi.mock('./WorklogSettingsCard', () => ({
  WorklogSettingsCard: () => <div data-testid="worklog-settings-card" />,
}));
vi.mock('./admin-settings/AuditHistoryPanel', () => ({
  AuditHistoryPanel: () => <div data-testid="audit-history-panel" />,
}));
vi.mock('./admin-settings/AlertSettingsCard', () => ({
  AlertSettingsCard: (props: AlertCardProps) => (
    <div data-testid="alert-settings-card">
      <div data-testid="alert-items-count">{props.items.length}</div>
      <div data-testid="alert-cancel-label">{props.wizard.labels.cancel}</div>
      <button
        data-testid="alert-cancel"
        onClick={() => props.wizard.onCancel()}
      >
        cancel-alert
      </button>
      <button
        data-testid="alert-edit"
        onClick={() => {
          const firstItem = props.items[0];
          if (firstItem) {
            // 編集モード遷移を検証するための最小モック。
            props.onEdit(firstItem);
          }
        }}
      >
        edit-alert
      </button>
      <button data-testid="alert-reload" onClick={props.onReload}>
        reload-alert
      </button>
    </div>
  ),
}));
vi.mock('./admin-settings/TemplateSettingsCard', () => ({
  TemplateSettingsCard: (props: TemplateCardProps) => (
    <div data-testid="template-settings-card">
      <div data-testid="template-current-id">
        {props.templateForm.templateId || '-'}
      </div>
      <div data-testid="template-current-kind">{props.templateForm.kind}</div>
      <div data-testid="template-item-count">{props.items.length}</div>
      <button
        data-testid="template-kind-estimate"
        onClick={() =>
          props.setTemplateForm((prev) => ({
            ...prev,
            kind: 'estimate',
            templateId: '',
          }))
        }
      >
        estimate
      </button>
      <button
        data-testid="template-kind-estimate-keep"
        onClick={() =>
          props.setTemplateForm((prev) => ({
            ...prev,
            kind: 'estimate',
            templateId: 'pdf-estimate',
          }))
        }
      >
        estimate-keep
      </button>
      <button
        data-testid="template-kind-estimate-preserve-current"
        onClick={() =>
          props.setTemplateForm((prev) => ({
            ...prev,
            kind: 'estimate',
            templateId: prev.templateId,
          }))
        }
      >
        estimate-preserve-current
      </button>
      <button
        data-testid="template-start-edit"
        onClick={() => {
          const firstItem = props.items[0];
          if (firstItem) {
            props.onEdit(firstItem);
          }
        }}
      >
        edit-template
      </button>
    </div>
  ),
}));
vi.mock('./admin-settings/ReportSubscriptionsCard', () => ({
  ReportSubscriptionsCard: (props: ReportSubscriptionsCardProps) => (
    <div data-testid="report-subscriptions-card">
      <div data-testid="report-items-count">{props.items.length}</div>
      <div data-testid="report-deliveries-count">{props.deliveries.length}</div>
      <div data-testid="report-delivery-filter">
        {props.reportDeliveryFilterId || '-'}
      </div>
      <button
        data-testid="report-show-deliveries"
        onClick={() => {
          props.setReportDeliveryFilterId('sub-1');
          void props.onShowDeliveries('sub-1');
        }}
      >
        load-deliveries
      </button>
      <button
        data-testid="report-show-all-deliveries"
        onClick={() => void props.onShowDeliveries()}
      >
        load-all-deliveries
      </button>
    </div>
  ),
}));
vi.mock('./admin-settings/IntegrationSettingsCard', () => ({
  IntegrationSettingsCard: (props: IntegrationSettingsCardProps) => (
    <div data-testid="integration-settings-card">
      <div data-testid="integration-items-count">{props.items.length}</div>
      <div data-testid="integration-runs-count">{props.runs.length}</div>
      <div data-testid="integration-metrics-present">
        {props.metrics ? 'yes' : 'no'}
      </div>
      <div data-testid="integration-filter">
        {props.integrationRunFilterId || '-'}
      </div>
      <button
        data-testid="integration-show-runs"
        onClick={() => {
          props.setIntegrationRunFilterId('setting-1');
          void props.onShowRuns('setting-1');
        }}
      >
        load-runs
      </button>
      <button
        data-testid="integration-show-all-runs"
        onClick={() => void props.onShowRuns()}
      >
        load-all-runs
      </button>
    </div>
  ),
}));

function mockApiRoute(path: string) {
  if (path === '/alert-settings') {
    return Promise.resolve({
      items: [
        {
          id: 'alert-1',
          type: 'budget_overrun',
          threshold: 10,
          period: 'month',
        },
      ],
    });
  }
  if (path === '/approval-rules') {
    return Promise.resolve({ items: [] });
  }
  if (path === '/action-policies') {
    return Promise.resolve({ items: [] });
  }
  if (path === '/chat-ack-templates') {
    return Promise.resolve({ items: [] });
  }
  if (path === '/template-settings') {
    return Promise.resolve({
      items: [
        {
          id: 'template-setting-1',
          kind: 'invoice',
          templateId: 'pdf-invoice',
          numberRule: 'INV-YYYY',
          isDefault: true,
        },
      ],
    });
  }
  if (path === '/pdf-templates') {
    return Promise.resolve({
      items: [
        {
          id: 'pdf-invoice',
          name: 'Invoice Template',
          kind: 'invoice',
          version: '1',
        },
        {
          id: 'pdf-estimate',
          name: 'Estimate Template',
          kind: 'estimate',
          version: '1',
        },
      ],
    });
  }
  if (path === '/integration-settings') {
    return Promise.resolve({
      items: [
        { id: 'setting-1', type: 'crm', name: 'CRM Sync', status: 'active' },
      ],
    });
  }
  if (path === '/report-subscriptions') {
    return Promise.resolve({
      items: [
        {
          id: 'sub-1',
          reportKey: 'sales',
          name: 'Sales Digest',
          isEnabled: true,
        },
      ],
    });
  }
  if (path === '/report-deliveries?subscriptionId=sub-1') {
    return Promise.resolve({
      items: [{ id: 'delivery-1', subscriptionId: 'sub-1', status: 'sent' }],
    });
  }
  if (path === '/report-deliveries') {
    return Promise.resolve({ items: [] });
  }
  if (path === '/integration-runs?settingId=setting-1&limit=50') {
    return Promise.resolve({
      items: [{ id: 'run-1', settingId: 'setting-1', status: 'success' }],
    });
  }
  if (path === '/integration-runs?limit=50') {
    return Promise.resolve({
      items: [{ id: 'run-2', settingId: 'setting-2', status: 'queued' }],
    });
  }
  if (path === '/integration-runs/metrics?settingId=setting-1&days=30') {
    return Promise.resolve({
      successCount: 1,
      failedCount: 0,
      avgDurationMs: 1200,
      lastSuccessAt: '2026-03-28T00:00:00.000Z',
      lastFailureAt: null,
    });
  }
  if (path === '/integration-runs/metrics?days=30') {
    return Promise.resolve({
      successCount: 2,
      failedCount: 1,
      avgDurationMs: 900,
      lastSuccessAt: '2026-03-29T00:00:00.000Z',
      lastFailureAt: '2026-03-29T12:00:00.000Z',
    });
  }
  return Promise.resolve({ items: [] });
}

describe('AdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation((path: string) => mockApiRoute(path));
    vi.mocked(getAuthState).mockReturnValue({ roles: ['system_admin'] });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads child card data on mount and renders static cards', async () => {
    render(<AdminSettings />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/alert-settings');
      expect(api).toHaveBeenCalledWith('/approval-rules');
      expect(api).toHaveBeenCalledWith('/action-policies');
      expect(api).toHaveBeenCalledWith('/chat-ack-templates');
      expect(api).toHaveBeenCalledWith('/template-settings');
      expect(api).toHaveBeenCalledWith('/pdf-templates');
      expect(api).toHaveBeenCalledWith('/integration-settings');
      expect(api).toHaveBeenCalledWith('/report-subscriptions');
    });

    expect(await screen.findByTestId('alert-items-count')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('template-item-count')).toHaveTextContent('1');
    expect(screen.getByTestId('integration-items-count')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('report-items-count')).toHaveTextContent('1');
    expect(screen.getByTestId('chat-settings-card')).toBeInTheDocument();
    expect(screen.getByTestId('group-management-card')).toBeInTheDocument();
  });

  it('selects the first template for the active kind and updates when the kind changes', async () => {
    render(<AdminSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-invoice',
      );
    });

    fireEvent.click(screen.getByTestId('template-kind-estimate'));

    await waitFor(() => {
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-estimate',
      );
    });
  });

  it('preserves a still-valid template selection when the kind changes', async () => {
    render(<AdminSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-invoice',
      );
    });

    fireEvent.click(
      screen.getByTestId('template-kind-estimate-preserve-current'),
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-current-kind')).toHaveTextContent(
        'estimate',
      );
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-estimate',
      );
    });
  });

  it('skips template auto-selection while editing an existing template', async () => {
    render(<AdminSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-invoice',
      );
    });

    fireEvent.click(screen.getByTestId('template-start-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-invoice',
      );
    });

    fireEvent.click(
      screen.getByTestId('template-kind-estimate-preserve-current'),
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-current-kind')).toHaveTextContent(
        'estimate',
      );
      expect(screen.getByTestId('template-current-id')).toHaveTextContent(
        'pdf-invoice',
      );
    });
  });

  it('loads report deliveries and integration runs through child callbacks', async () => {
    render(<AdminSettings />);

    await screen.findByTestId('report-subscriptions-card');

    fireEvent.click(screen.getByTestId('report-show-deliveries'));
    fireEvent.click(screen.getByTestId('integration-show-runs'));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/report-deliveries?subscriptionId=sub-1',
      );
      expect(api).toHaveBeenCalledWith(
        '/integration-runs?settingId=setting-1&limit=50',
      );
      expect(api).toHaveBeenCalledWith(
        '/integration-runs/metrics?settingId=setting-1&days=30',
      );
    });

    expect(screen.getByTestId('report-delivery-filter')).toHaveTextContent(
      'sub-1',
    );
    expect(screen.getByTestId('report-deliveries-count')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('integration-filter')).toHaveTextContent(
      'setting-1',
    );
    expect(screen.getByTestId('integration-runs-count')).toHaveTextContent('1');
    expect(screen.getByTestId('integration-metrics-present')).toHaveTextContent(
      'yes',
    );
  });

  it('reloads report deliveries and integration runs without an identifier', async () => {
    render(<AdminSettings />);

    await screen.findByTestId('report-subscriptions-card');

    fireEvent.click(screen.getByTestId('report-show-all-deliveries'));
    fireEvent.click(screen.getByTestId('integration-show-all-runs'));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/report-deliveries');
      expect(api).toHaveBeenCalledWith('/integration-runs?limit=50');
      expect(api).toHaveBeenCalledWith('/integration-runs/metrics?days=30');
    });

    expect(screen.getByTestId('report-delivery-filter')).toHaveTextContent('-');
    expect(screen.getByTestId('report-deliveries-count')).toHaveTextContent(
      '0',
    );
    expect(screen.getByTestId('integration-filter')).toHaveTextContent('-');
    expect(screen.getByTestId('integration-runs-count')).toHaveTextContent('1');
    expect(screen.getByTestId('integration-metrics-present')).toHaveTextContent(
      'yes',
    );
  });

  it('updates the alert cancel label in edit mode and clears the draft on cancel', async () => {
    render(<AdminSettings />);

    await screen.findByTestId('alert-settings-card');
    expect(screen.getByTestId('alert-cancel-label')).toHaveTextContent(
      'クリア',
    );

    fireEvent.click(screen.getByTestId('alert-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('alert-cancel-label')).toHaveTextContent(
        'キャンセル',
      );
    });

    fireEvent.click(screen.getByTestId('alert-cancel'));

    await waitFor(() => {
      expect(alertDraftState.clearDraft).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('alert-cancel-label')).toHaveTextContent(
        'クリア',
      );
    });
  });
});
