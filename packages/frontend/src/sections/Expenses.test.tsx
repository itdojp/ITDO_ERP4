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

const { api, getAuthState, useProjects, enqueueOfflineItem, isOfflineError } =
  vi.hoisted(() => ({
    api: vi.fn(),
    getAuthState: vi.fn(),
    useProjects: vi.fn(),
    enqueueOfflineItem: vi.fn(),
    isOfflineError: vi.fn(),
  }));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../hooks/useProjects', () => ({ useProjects }));
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: ({ targetId }: { targetId: string }) => (
    <div>annotations:{targetId}</div>
  ),
}));
vi.mock('../utils/offlineQueue', () => ({
  enqueueOfflineItem,
  isOfflineError,
}));
vi.mock('../ui', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <section>
        <h3>{title}</h3>
        <div>{children}</div>
        <div>{footer}</div>
      </section>
    ) : null,
  Drawer: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <section>
        <h3>{title}</h3>
        <div>{children}</div>
        <div>{footer}</div>
      </section>
    ) : null,
}));

import { Expenses } from './Expenses';

type ExpenseRecord = {
  id: string;
  projectId: string;
  userId: string;
  category: string;
  amount: number;
  currency: string;
  incurredOn: string;
  status: string;
  settlementStatus?: 'paid' | 'unpaid' | string;
  paidAt?: string | null;
  paidBy?: string | null;
  receiptUrl?: string | null;
  isShared?: boolean | null;
};

const demoProjects = [
  { id: 'demo-project', code: 'PRJ', name: 'Demo Project' },
  { id: 'project-2', code: 'OPS', name: 'Operations' },
];

function buildExpense(overrides?: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id: 'expense-1',
    projectId: 'demo-project',
    userId: 'user-1',
    category: '交通費',
    amount: 1000,
    currency: 'JPY',
    incurredOn: '2026-03-27',
    status: 'approved',
    settlementStatus: 'unpaid',
    paidAt: null,
    paidBy: null,
    receiptUrl: null,
    isShared: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(enqueueOfflineItem).mockReset();
  vi.mocked(isOfflineError).mockReset();
  vi.mocked(getAuthState).mockReturnValue({
    token: 'token',
    userId: 'user-1',
    roles: ['member'],
    projectIds: ['demo-project'],
  });
  vi.mocked(useProjects).mockReturnValue({
    projects: demoProjects,
    projectMessage: '',
  });
  vi.mocked(enqueueOfflineItem).mockResolvedValue(undefined);
  vi.mocked(isOfflineError).mockReturnValue(false);
});

describe('Expenses', () => {
  it('filters visible expenses and clears the filters', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/expenses') {
        return {
          items: [
            buildExpense({
              id: 'expense-paid',
              category: '宿泊費',
              settlementStatus: 'paid',
              paidAt: '2026-03-20',
              receiptUrl: 'https://example.com/r1',
            }),
            buildExpense({
              id: 'expense-unpaid',
              category: '交通費',
              settlementStatus: 'unpaid',
              receiptUrl: null,
            }),
          ],
        } as never;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    render(<Expenses />);

    expect(await screen.findByText(/宿泊費/)).toBeInTheDocument();
    expect(screen.getByText(/交通費/)).toBeInTheDocument();
    expect(screen.getByText('領収書未登録: 1件')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('経費精算フィルタ'), {
      target: { value: 'paid' },
    });
    expect(screen.getByText(/宿泊費/)).toBeInTheDocument();
    expect(screen.queryByText(/交通費/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('経費領収書フィルタ'), {
      target: { value: 'without' },
    });
    expect(screen.getByText('データなし')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));
    expect(screen.getByText(/宿泊費/)).toBeInTheDocument();
    expect(screen.getByText(/交通費/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '未登録のみ表示' }));
    expect(screen.queryByText(/宿泊費/)).not.toBeInTheDocument();
    expect(screen.getByText(/交通費/)).toBeInTheDocument();
  });

  it('shows validation hints and keeps add disabled when form values are invalid', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] } as never);

    render(<Expenses />);

    await screen.findByText('データなし');
    fireEvent.change(screen.getByDisplayValue('1000'), {
      target: { value: '0' },
    });

    expect(
      screen.getByText('金額は1以上で入力してください'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue('0'), {
      target: { value: '1000' },
    });
    fireEvent.change(screen.getByPlaceholderText('通貨'), {
      target: { value: 'jp' },
    });
    expect(
      screen.getByText('通貨は3文字の英大文字で入力してください'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled();
  });

  it('filters items by paid date range and excludes entries without paidAt', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        buildExpense({
          id: 'expense-in-range',
          category: '宿泊費',
          settlementStatus: 'paid',
          paidAt: '2026-03-10T12:00:00.000Z',
        }),
        buildExpense({
          id: 'expense-next-day',
          category: '会議費',
          settlementStatus: 'paid',
          paidAt: '2026-03-12T00:00:00.000Z',
        }),
        buildExpense({
          id: 'expense-unpaid',
          category: '交通費',
          settlementStatus: 'unpaid',
          paidAt: null,
        }),
      ],
    } as never);

    render(<Expenses />);

    expect(await screen.findByText(/宿泊費/)).toBeInTheDocument();
    expect(screen.getByText(/会議費/)).toBeInTheDocument();
    expect(screen.getByText(/交通費/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('支払日開始'), {
      target: { value: '2026-03-10' },
    });
    fireEvent.change(screen.getByLabelText('支払日終了'), {
      target: { value: '2026-03-11' },
    });

    expect(screen.getByText(/宿泊費/)).toBeInTheDocument();
    expect(screen.queryByText(/会議費/)).not.toBeInTheDocument();
    expect(screen.queryByText(/交通費/)).not.toBeInTheDocument();
  });

  it('queues an expense when the save fails offline', async () => {
    const offlineError = new Error('offline');
    let loadCount = 0;
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/expenses' && !init?.method) {
          loadCount += 1;
          return { items: [] } as never;
        }
        if (path === '/expenses' && init?.method === 'POST') {
          throw offlineError;
        }
        throw new Error(`Unhandled api path: ${path}`);
      },
    );
    vi.mocked(isOfflineError).mockImplementation(
      (error) => error === offlineError,
    );

    render(<Expenses />);

    await screen.findByText('データなし');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      expect(enqueueOfflineItem).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'expense',
          requests: [
            expect.objectContaining({ path: '/expenses', method: 'POST' }),
          ],
        }),
      );
    });
    expect(
      screen.getByText('オフラインのため送信待ちに保存しました'),
    ).toBeInTheDocument();
    expect(loadCount).toBe(1);
  });

  it('shows an error when save fails outside offline mode', async () => {
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/expenses' && !init?.method) {
          return { items: [] } as never;
        }
        if (path === '/expenses' && init?.method === 'POST') {
          throw new Error('save failed');
        }
        throw new Error(`Unhandled api path: ${path}`);
      },
    );
    vi.mocked(isOfflineError).mockReturnValue(false);

    render(<Expenses />);

    await screen.findByText('データなし');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(await screen.findByText('保存に失敗しました')).toBeInTheDocument();
    expect(enqueueOfflineItem).not.toHaveBeenCalled();
  });

  it('marks an approved expense as paid', async () => {
    vi.mocked(getAuthState).mockReturnValue({
      token: 'token',
      userId: 'user-1',
      roles: ['mgmt'],
      projectIds: ['demo-project'],
    });
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/expenses' && !init?.method) {
          return {
            items: [buildExpense({ id: 'expense-1', category: '宿泊費' })],
          } as never;
        }
        if (
          path === '/expenses/expense-1/mark-paid' &&
          init?.method === 'POST'
        ) {
          return buildExpense({
            id: 'expense-1',
            category: '宿泊費',
            settlementStatus: 'paid',
            paidAt: '2026-03-28T00:00:00.000Z',
          }) as never;
        }
        throw new Error(`Unhandled api path: ${path}`);
      },
    );

    render(<Expenses />);

    expect(await screen.findByText(/宿泊費/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '支払済みにする' }));
    const dialog = screen.getByText('経費を支払済みに更新').closest('section');
    expect(dialog).not.toBeNull();
    fireEvent.change(
      within(dialog as HTMLElement).getByLabelText('支払更新理由'),
      {
        target: { value: '振込完了' },
      },
    );
    fireEvent.click(
      within(dialog as HTMLElement).getByRole('button', {
        name: '支払済みにする',
      }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/expenses/expense-1/mark-paid',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(screen.getByText('支払済みに更新しました')).toBeInTheDocument();
    expect(screen.getByText(/支払日: 2026-03-28/)).toBeInTheDocument();
  });

  it('requires a reason before unmarking a paid expense and updates the item', async () => {
    vi.mocked(getAuthState).mockReturnValue({
      token: 'token',
      userId: 'user-1',
      roles: ['admin'],
      projectIds: ['demo-project'],
    });
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/expenses' && !init?.method) {
          return {
            items: [
              buildExpense({
                id: 'expense-2',
                category: '備品',
                settlementStatus: 'paid',
                paidAt: '2026-03-25T00:00:00.000Z',
              }),
            ],
          } as never;
        }
        if (
          path === '/expenses/expense-2/unmark-paid' &&
          init?.method === 'POST'
        ) {
          return buildExpense({
            id: 'expense-2',
            category: '備品',
            settlementStatus: 'unpaid',
            paidAt: null,
          }) as never;
        }
        throw new Error(`Unhandled api path: ${path}`);
      },
    );

    render(<Expenses />);

    expect(await screen.findByText(/備品/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '支払取消' }));

    const dialog = screen
      .getByText('経費の支払済みを取り消し')
      .closest('section');
    expect(dialog).not.toBeNull();
    const submitButton = within(dialog as HTMLElement).getByRole('button', {
      name: '支払取消',
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(
      within(dialog as HTMLElement).getByLabelText('支払取消理由'),
      {
        target: { value: '誤登録' },
      },
    );
    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/expenses/expense-2/unmark-paid',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(screen.getByText('支払済みを取り消しました')).toBeInTheDocument();
    const itemRow = screen.getByText(/備品/).closest('li');
    expect(itemRow).not.toBeNull();
    expect(
      within(itemRow as HTMLElement).getByText('未払い'),
    ).toBeInTheDocument();
  });
});
