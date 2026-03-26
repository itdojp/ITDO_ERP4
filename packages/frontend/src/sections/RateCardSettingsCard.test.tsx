import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../api', () => ({ api }));

vi.mock('../ui', () => ({
  ConfirmActionDialog: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        {description ? <div>{description}</div> : null}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    ) : null,
}));

import { RateCardSettingsCard } from './RateCardSettingsCard';

type RateCard = {
  id: string;
  projectId?: string | null;
  role: string;
  workType?: string | null;
  unitPrice: number | string;
  validFrom: string;
  validTo?: string | null;
  currency: string;
};

const PROJECTS = {
  items: [
    { id: 'project-1', code: 'P001', name: 'Alpha' },
    { id: 'project-2', code: 'P002', name: 'Beta' },
  ],
};

const RATE_CARDS: RateCard[] = [
  {
    id: 'rc-1',
    projectId: 'project-1',
    role: 'consultant',
    workType: '分析',
    unitPrice: 10000,
    validFrom: '2026-01-01',
    validTo: null,
    currency: 'JPY',
  },
  {
    id: 'rc-2',
    projectId: null,
    role: 'default',
    workType: null,
    unitPrice: 6000,
    validFrom: '2026-02-01',
    validTo: '2026-12-31',
    currency: 'USD',
  },
];

function hasCall(path: string, method: string, body?: string) {
  return api.mock.calls.some(([targetPath, options]) => {
    if (targetPath !== path) return false;
    const request = options as { method?: string; body?: string } | undefined;
    if (request?.method !== method) return false;
    return body === undefined || request.body === body;
  });
}

function expectMessage(text: string) {
  expect(
    screen.getByText((_, node) => node?.textContent === text),
  ).toBeInTheDocument();
}

function getBadge(text: string) {
  return screen.getByText(
    (_, node) =>
      node?.tagName === 'SPAN' &&
      node.classList.contains('badge') &&
      node.textContent === text,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  api.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('RateCardSettingsCard', () => {
  it('loads rate cards with normalized filters and renders project labels', async () => {
    api.mockImplementation(async (path: string) => {
      if (path === '/projects') return PROJECTS;
      if (
        path ===
        '/rate-cards?projectId=project-1&includeGlobal=0&active=0&workType=Consulting'
      ) {
        return { items: RATE_CARDS };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('案件フィルタ')).toHaveValue('');
    });

    fireEvent.change(screen.getByLabelText('案件フィルタ'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(screen.getByLabelText('global を含む'));
    fireEvent.click(screen.getByLabelText('有効のみ'));
    fireEvent.change(screen.getByLabelText('workTypeフィルタ'), {
      target: { value: ' Consulting ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/rate-cards?projectId=project-1&includeGlobal=0&active=0&workType=Consulting',
      );
    });

    expectMessage('取得しました');
    expect(getBadge('P001 / Alpha')).toBeInTheDocument();
    expect(getBadge('(global)')).toBeInTheDocument();
    expect(
      screen.getByText('分析 / 10000 JPY / 2026-01-01〜-'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('(default) / 6000 USD / 2026-02-01〜2026-12-31'),
    ).toBeInTheDocument();
  });

  it('validates required role and unitPrice before creating', async () => {
    api.mockResolvedValue(PROJECTS);

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.change(screen.getByLabelText('role'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expectMessage('role は必須です');
    expect(hasCall('/rate-cards', 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText('role'), {
      target: { value: 'engineer' },
    });
    fireEvent.change(screen.getByLabelText('unitPrice'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expectMessage('unitPrice は 1 以上で入力してください');
    expect(hasCall('/rate-cards', 'POST')).toBe(false);
  });

  it('creates a rate card with normalized nullable fields and reloads', async () => {
    api.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        const method = options?.method ?? 'GET';
        if (path === '/projects') return PROJECTS;
        if (path === '/rate-cards' && method === 'POST')
          return { id: 'rc-new' };
        if (path === '/rate-cards?includeGlobal=1&active=1') {
          return {
            items: [
              {
                id: 'rc-new',
                projectId: null,
                role: 'analyst',
                workType: null,
                unitPrice: 7500,
                validFrom: '2026-03-01',
                validTo: null,
                currency: 'JPY',
              },
            ],
          };
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.change(screen.getByLabelText('role'), {
      target: { value: ' analyst ' },
    });
    fireEvent.change(screen.getByLabelText('workType'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByLabelText('unitPrice'), {
      target: { value: '7500' },
    });
    fireEvent.change(screen.getByLabelText('validFrom'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByLabelText('validTo'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      expect(
        hasCall(
          '/rate-cards',
          'POST',
          JSON.stringify({
            projectId: null,
            role: 'analyst',
            workType: null,
            unitPrice: 7500,
            currency: 'JPY',
            validFrom: '2026-03-01',
            validTo: null,
          }),
        ),
      ).toBe(true);
      expect(api).toHaveBeenCalledWith('/rate-cards?includeGlobal=1&active=1');
    });

    expectMessage('取得しました');
    expect(getBadge('(global)')).toBeInTheDocument();
    expect(
      screen.getByText('(default) / 7500 JPY / 2026-03-01〜-'),
    ).toBeInTheDocument();
  });

  it('shows load failures and empty states', async () => {
    api.mockImplementation(async (path: string) => {
      if (path === '/projects') return PROJECTS;
      if (path === '/rate-cards?includeGlobal=1&active=1') {
        throw new Error('load failed');
      }
      throw new Error(`unexpected path: ${path}`);
    });

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      expectMessage('取得に失敗しました');
    });

    expect(screen.getByText('データなし')).toBeInTheDocument();
  });

  it('shows disable fallback labels and disables rate cards after confirmation', async () => {
    api.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        const method = options?.method ?? 'GET';
        if (path === '/projects') return PROJECTS;
        if (path === '/rate-cards?includeGlobal=1&active=1') {
          return {
            items: [
              {
                id: 'rc-missing',
                projectId: 'missing-project',
                role: 'reviewer',
                workType: null,
                unitPrice: 9000,
                validFrom: '2026-04-01',
                validTo: null,
                currency: 'JPY',
              },
            ],
          };
        }
        if (path === '/rate-cards/rc-missing/disable' && method === 'POST') {
          return {};
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<RateCardSettingsCard />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.click(screen.getByRole('button', { name: '取得' }));

    await waitFor(() => {
      expect(screen.getByText('missing-project')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '無効化' }));

    expect(screen.getByText('この単価を無効化しますか？')).toBeInTheDocument();
    expect(
      screen.getByText('missing-project / reviewer / (default)'),
    ).toBeInTheDocument();

    const dialog = screen.getByText('この単価を無効化しますか？')
      .parentElement as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: '無効化' }));

    await waitFor(() => {
      expect(hasCall('/rate-cards/rc-missing/disable', 'POST')).toBe(true);
      expect(api).toHaveBeenCalledWith('/rate-cards?includeGlobal=1&active=1');
    });
  });
});
