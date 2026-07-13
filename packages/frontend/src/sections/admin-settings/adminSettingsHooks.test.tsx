import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminSettingsAccountingMappingRules } from './useAdminSettingsAccountingMappingRules';
import { useAdminSettingsIntegrations } from './useAdminSettingsIntegrations';
import { getApprovalRuleSeriesKey } from './adminSettingsModel';
import { useAdminSettingsPolicyResources } from './useAdminSettingsPolicyResources';
import { useAdminSettingsReconciliation } from './useAdminSettingsReconciliation';
import { useAdminSettingsTemplates } from './useAdminSettingsTemplates';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../api', () => ({ api }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderAdminHook<T>(
  hook: (options: {
    setMessage: (message: string) => void;
    logError: (label: string, err: unknown) => void;
  }) => T,
) {
  const setMessage = vi.fn();
  const logError = vi.fn();
  const rendered = renderHook(() => hook({ setMessage, logError }));
  return { ...rendered, setMessage, logError };
}

describe('AdminSettings resource hooks', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('prevents duplicate integration setting submits while a save is in-flight', async () => {
    const postSetting = deferred<Record<string, never>>();
    api.mockImplementation((path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/integration-settings' && method === 'POST') {
        return postSetting.promise;
      }
      if (path === '/integration-settings' && method === 'GET') {
        return Promise.resolve({ items: [] });
      }
      throw new Error(`Unhandled api path: ${method} ${path}`);
    });

    const { result } = renderAdminHook(useAdminSettingsIntegrations);
    act(() => {
      result.current.setForm({
        type: 'hr',
        name: 'HRIS',
        provider: 'demo',
        status: 'active',
        schedule: '',
        configJson: '{}',
      });
    });

    let firstSubmit!: Promise<void>;
    let secondSubmit!: Promise<void>;
    await act(async () => {
      firstSubmit = result.current.submit();
      secondSubmit = result.current.submit();
      await waitFor(() => {
        expect(
          api.mock.calls.filter(
            ([path, init]) =>
              path === '/integration-settings' &&
              ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
          ),
        ).toHaveLength(1);
      });
      postSetting.resolve({});
      await Promise.all([firstSubmit, secondSubmit]);
    });

    expect(api).toHaveBeenCalledWith('/integration-settings', {
      method: 'POST',
      body: JSON.stringify({
        type: 'hr',
        name: 'HRIS',
        provider: 'demo',
        status: 'active',
        config: {},
      }),
    });
  });

  it('auto-selects the first PDF template for the active template kind', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/pdf-templates') {
        return Promise.resolve({
          items: [
            {
              id: 'pdf-invoice',
              name: 'Invoice',
              kind: 'invoice',
              version: '1',
            },
            {
              id: 'pdf-estimate',
              name: 'Estimate',
              kind: 'estimate',
              version: '1',
            },
          ],
        });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    const { result } = renderAdminHook(useAdminSettingsTemplates);

    await act(async () => {
      await result.current.loadPdfTemplates();
    });
    await waitFor(() =>
      expect(result.current.form.templateId).toBe('pdf-invoice'),
    );

    act(() => {
      result.current.setForm((current) => ({ ...current, kind: 'estimate' }));
    });

    await waitFor(() =>
      expect(result.current.form.templateId).toBe('pdf-estimate'),
    );
  });

  it('ignores stale reconciliation details after the period key changes', async () => {
    const details = deferred<{ periodKey: string; items: unknown[] }>();
    api.mockImplementation((path: string) => {
      if (path === '/integrations/reconciliation/details?periodKey=2026-03') {
        return details.promise;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    const { result } = renderAdminHook(useAdminSettingsReconciliation);
    act(() => {
      result.current.setPeriodKey('2026-03');
    });

    let loadPromise!: Promise<void>;
    await act(async () => {
      loadPromise = result.current.loadDetails();
      await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
      result.current.setPeriodKey('2026-04');
      details.resolve({ periodKey: '2026-03', items: [] });
      await loadPromise;
    });

    expect(result.current.details).toBeNull();
    expect(result.current.detailsLoading).toBe(false);
  });

  it('validates accounting mapping rule dependent required fields before API calls', async () => {
    const { result, setMessage } = renderAdminHook(
      useAdminSettingsAccountingMappingRules,
    );

    act(() => {
      result.current.setForm({
        mappingKey: 'invoice_sales',
        debitAccountCode: '1100',
        debitAccountName: '',
        debitSubaccountCode: '',
        requireDebitSubaccountCode: true,
        creditAccountCode: '4000',
        creditAccountName: '',
        creditSubaccountCode: '',
        requireCreditSubaccountCode: false,
        departmentCode: '',
        requireDepartmentCode: false,
        taxCode: 'TAX10',
        isActive: true,
      });
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(api).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(
      '借方枝番必須を有効にする場合は借方枝番を入力してください',
    );
  });

  it('validates ActionPolicy JSON before issuing mutation requests', async () => {
    const { result, setMessage } = renderAdminHook(
      useAdminSettingsPolicyResources,
    );

    act(() => {
      result.current.actionPolicies.setForm((current) => ({
        ...current,
        actionKey: 'approve',
        subjectsJson: '{invalid',
      }));
    });

    await act(async () => {
      await result.current.actionPolicies.submit();
    });

    expect(api).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith('subjects のJSONが不正です');
  });

  it('loads approval-rule audit logs per series and merges version history', async () => {
    const activeRule = {
      id: 'rule-current',
      flowType: 'expense',
      ruleKey: 'expense-default',
      version: 2,
      isActive: true,
      conditions: {},
      steps: [],
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      effectiveFrom: '2026-07-11T00:00:00.000Z',
      effectiveTo: null,
      supersedesRuleId: 'rule-previous',
    };
    const previousRule = {
      ...activeRule,
      id: 'rule-previous',
      version: 1,
      updatedAt: '2026-07-09T00:00:00.000Z',
      effectiveFrom: '2026-07-09T00:00:00.000Z',
      effectiveTo: '2026-07-11T00:00:00.000Z',
      supersedesRuleId: null,
    };
    api.mockImplementation((path: string) => {
      if (path === '/approval-rules') {
        return Promise.resolve({ items: [activeRule, previousRule] });
      }
      if (
        path ===
        '/audit-logs?targetTable=approval_rules&targetId=rule-current&limit=50&format=json'
      ) {
        return Promise.resolve({
          items: [
            { id: 'log-2', createdAt: '2026-07-12T00:00:00.000Z' },
            { id: 'log-1', createdAt: '2026-07-11T12:00:00.000Z' },
          ],
        });
      }
      if (
        path ===
        '/audit-logs?targetTable=approval_rules&targetId=rule-previous&limit=50&format=json'
      ) {
        return Promise.resolve({
          items: [
            { id: 'log-1', createdAt: '2026-07-11T12:00:00.000Z' },
            { id: 'log-0', createdAt: '2026-07-08T00:00:00.000Z' },
          ],
        });
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    const { result } = renderAdminHook(useAdminSettingsPolicyResources);

    await act(async () => {
      await result.current.approvalRules.loadApprovalRules();
    });

    await act(async () => {
      await result.current.approvalRules.loadAuditLogs(activeRule);
    });

    const seriesKey = getApprovalRuleSeriesKey(activeRule);
    await waitFor(() =>
      expect(result.current.approvalRules.auditLogs[seriesKey]).toEqual([
        { id: 'log-2', createdAt: '2026-07-12T00:00:00.000Z' },
        { id: 'log-1', createdAt: '2026-07-11T12:00:00.000Z' },
        { id: 'log-0', createdAt: '2026-07-08T00:00:00.000Z' },
      ]),
    );
    expect(result.current.approvalRules.auditSelected[seriesKey]).toBe('log-2');
    expect(result.current.approvalRules.auditOpen[seriesKey]).toBe(true);
  });
});
