import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, apiResponse, authStateRef, downloadResponseAsFile, useProjects } =
  vi.hoisted(() => ({
    api: vi.fn(),
    apiResponse: vi.fn(),
    authStateRef: {
      current: { userId: 'user-1', projectIds: ['proj-1'] },
    },
    downloadResponseAsFile: vi.fn(),
    useProjects: vi.fn(),
  }));

vi.mock('../api', () => ({
  api,
  apiResponse,
  getAuthState: () => authStateRef.current,
}));
vi.mock('../hooks/useProjects', () => ({ useProjects }));
vi.mock('../utils/download', () => ({ downloadResponseAsFile }));

import { Reports } from './Reports';

type UseProjectsResult = ReturnType<typeof useProjects>;

const defaultProjectsResult: UseProjectsResult = {
  projects: [
    { id: 'proj-1', code: 'P001', name: 'Project One' },
    { id: 'proj-2', code: 'P002', name: 'Project Two' },
  ],
  projectMessage: '',
  loadProjects: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  authStateRef.current = { userId: 'user-1', projectIds: ['proj-1'] };
  vi.mocked(useProjects).mockReturnValue(defaultProjectsResult);
});

afterEach(() => {
  cleanup();
});

describe('Reports', () => {
  it('syncs default auth values and reloads baselines after auth update', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        items: [{ id: 'base-1', name: 'Baseline 1' }],
      })
      .mockResolvedValueOnce({
        items: [{ id: 'base-2', name: 'Baseline 2' }],
      });

    render(<Reports />);

    await screen.findByRole('option', { name: 'Baseline 1' });
    expect(screen.getAllByDisplayValue('user-1')).toHaveLength(2);
    expect(screen.getByLabelText('案件選択')).toHaveValue('proj-1');
    expect(api).toHaveBeenCalledWith('/projects/proj-1/baselines');

    authStateRef.current = { userId: 'user-2', projectIds: ['proj-2'] };
    window.dispatchEvent(new Event('erp4:auth-updated'));

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('user-2')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.getByLabelText('案件選択')).toHaveValue('proj-2');
    });
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/proj-2/baselines');
    });
    expect(
      await screen.findByRole('option', { name: 'Baseline 2' }),
    ).toBeInTheDocument();
  });

  it('validates required inputs before running dependent reports', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] });

    render(<Reports />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects/proj-1/baselines');
    });

    fireEvent.change(screen.getByLabelText('案件選択'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'PJ別工数' }));
    expect(screen.getByText('案件を選択してください')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '管理会計サマリCSV' }));
    expect(screen.getByText('from/to を入力してください')).toBeInTheDocument();
    expect(apiResponse).not.toHaveBeenCalled();
  });

  it('loads project effort and formats plan variance', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/projects/proj-1/baselines') {
        return { items: [{ id: 'base-1', name: 'Baseline 1' }] };
      }
      if (
        path === '/reports/project-effort/proj-1?from=2026-03-01&to=2026-03-31'
      ) {
        return {
          projectId: 'proj-1',
          planHours: 8,
          totalMinutes: 600,
          varianceMinutes: 120,
          totalExpenses: 5000,
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<Reports />);

    fireEvent.change(screen.getByPlaceholderText('from (YYYY-MM-DD)'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByPlaceholderText('to (YYYY-MM-DD)'), {
      target: { value: '2026-03-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'PJ別工数' }));

    expect(
      await screen.findByText('プロジェクト別工数を取得しました'),
    ).toBeInTheDocument();
    expect(screen.getByText('Project: P001 / Project One')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Plan: 8\.00h \/ Actual: 10\.00h \/ Var: \+2\.00h（超過）/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Expenses: ¥${(5000).toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it('requires userIds before loading project profit by group and then renders the report', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/projects/proj-1/baselines') {
        return { items: [{ id: 'base-1', name: 'Baseline 1' }] };
      }
      if (
        path ===
        '/reports/project-profit/proj-1/by-group?userIds=user-1%2Cuser-2'
      ) {
        return {
          projectId: 'proj-1',
          allocationMethod: 'minutes',
          currency: 'JPY',
          userIds: ['user-1', 'user-2'],
          totals: {
            revenue: 10000,
            vendorCost: 1000,
            laborCost: 2000,
            expenseCost: 500,
            totalMinutes: 800,
          },
          group: {
            laborCost: 2000,
            expenseCost: 500,
            allocatedVendorCost: 1000,
            allocatedRevenue: 10000,
            totalCost: 3500,
            grossProfit: 6500,
            grossMargin: 0.65,
            minutes: 800,
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<Reports />);

    const userIdsInput = screen.getByPlaceholderText('userIds (a,b,c)');
    fireEvent.change(userIdsInput, { target: { value: '' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'PJ採算（グループ別）' }),
    );
    expect(screen.getByText('userIds を入力してください')).toBeInTheDocument();

    fireEvent.change(userIdsInput, { target: { value: 'user-1, user-2' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'PJ採算（グループ別）' }),
    );

    expect(
      await screen.findByText('PJ採算（グループ別）を取得しました'),
    ).toBeInTheDocument();
    expect(screen.getByText('Users: user-1, user-2')).toBeInTheDocument();
    expect(screen.getByText(/Margin: 65\.00%/)).toBeInTheDocument();
  });

  it('loads mixed-currency management accounting and downloads csv', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/projects/proj-1/baselines') {
        return { items: [{ id: 'base-1', name: 'Baseline 1' }] };
      }
      if (
        path ===
        '/reports/management-accounting/summary?from=2026-03-01&to=2026-03-31'
      ) {
        return {
          from: '2026-03-01',
          to: '2026-03-31',
          projectCount: 2,
          mixedCurrency: true,
          currencyBreakdown: [
            {
              currency: 'JPY',
              projectCount: 1,
              revenue: 10000,
              directCost: 3000,
              laborCost: 1200,
              vendorCost: 1000,
              expenseCost: 800,
              grossProfit: 7000,
              grossMargin: 0.7,
              totalMinutes: 400,
              deliveryDueCount: 1,
              deliveryDueAmount: 500,
              redProjectCount: 1,
              topRedProjects: [
                {
                  projectId: 'proj-1',
                  projectCode: 'P001',
                  projectName: 'Project One',
                  grossProfit: -500,
                  grossMargin: -0.05,
                },
              ],
            },
          ],
          revenue: null,
          directCost: null,
          laborCost: null,
          vendorCost: null,
          expenseCost: null,
          grossProfit: null,
          grossMargin: null,
          totalMinutes: 400,
          overtimeTotalMinutes: 60,
          deliveryDueCount: 1,
          deliveryDueAmount: null,
          redProjectCount: 1,
          topRedProjects: [],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    const response = { ok: true } as Response;
    vi.mocked(apiResponse).mockResolvedValue(response);
    vi.mocked(downloadResponseAsFile).mockResolvedValue(undefined);

    render(<Reports />);

    fireEvent.change(screen.getByPlaceholderText('from (YYYY-MM-DD)'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByPlaceholderText('to (YYYY-MM-DD)'), {
      target: { value: '2026-03-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: '管理会計サマリ' }));

    expect(
      await screen.findByText('管理会計サマリを取得しました'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '複数通貨を含むため、金額系 KPI は通貨別に表示しています。',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Currency: JPY / Projects: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Red projects: 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/P001 \/ Project One/).length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByRole('button', { name: '管理会計サマリCSV' }));

    await waitFor(() => {
      expect(apiResponse).toHaveBeenCalledWith(
        '/reports/management-accounting/summary?from=2026-03-01&to=2026-03-31&format=csv',
      );
    });
    expect(downloadResponseAsFile).toHaveBeenCalledWith(
      response,
      'management-accounting-summary-2026-03-01-to-2026-03-31.csv',
    );
    expect(
      screen.getByText('管理会計サマリCSVを出力しました'),
    ).toBeInTheDocument();
  });
});
