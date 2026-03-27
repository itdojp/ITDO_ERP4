/* eslint-disable react/prop-types */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  api,
  getAuthState,
  useProjects,
  useProjectTasks,
  getDraftOwnerId,
  loadDraft,
  saveDraft,
  clearDraft,
  enqueueOfflineItem,
  isOfflineError,
  navigateToOpen,
} = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  useProjects: vi.fn(),
  useProjectTasks: vi.fn(),
  getDraftOwnerId: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  enqueueOfflineItem: vi.fn(),
  isOfflineError: vi.fn(),
  navigateToOpen: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../hooks/useProjects', () => ({ useProjects }));
vi.mock('../hooks/useProjectTasks', () => ({ useProjectTasks }));
vi.mock('../utils/drafts', () => ({
  getDraftOwnerId,
  loadDraft,
  saveDraft,
  clearDraft,
}));
vi.mock('../utils/offlineQueue', () => ({
  enqueueOfflineItem,
  isOfflineError,
}));
vi.mock('../utils/deepLink', () => ({ navigateToOpen }));
vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: (
    props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
    },
  ) => {
    const { children, loading: _loading, ...rest } = props;
    return (
      <button
        type="button"
        disabled={Boolean(props.disabled) || Boolean(props.loading)}
        {...rest}
      >
        {children}
      </button>
    );
  },
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  }) => (
    <section>
      <div>{title}</div>
      {description ? <div>{description}</div> : null}
      {action}
    </section>
  ),
  FilterBar: ({
    children,
    actions,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <section>
      <div>{children}</div>
      <div>{actions}</div>
    </section>
  ),
  Input: ({
    label,
    error,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    label?: string;
    error?: string;
  }) => (
    <label>
      <span>{label}</span>
      <input {...props} />
      {error ? <span>{error}</span> : null}
    </label>
  ),
  ListStatePanel: ({
    status,
    error,
    onRetry,
    emptyTitle,
  }: {
    status: string;
    count: number;
    error?: string;
    onRetry?: () => void;
    emptyTitle?: string;
  }) => (
    <section>
      {status === 'loading' ? <div>loading</div> : null}
      {status === 'error' ? <div>{error}</div> : null}
      {status !== 'loading' && status !== 'error' ? (
        <div>{emptyTitle}</div>
      ) : null}
      {onRetry ? <button onClick={onRetry}>再取得</button> : null}
    </section>
  ),
  Select: ({
    label,
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
    children?: React.ReactNode;
  }) => (
    <label>
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  ),
  Skeleton: () => <div>loading</div>,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  Textarea: ({
    label,
    ...props
  }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: string;
  }) => (
    <label>
      <span>{label}</span>
      <textarea {...props} />
    </label>
  ),
  Toast: ({
    title,
    description,
    onClose,
  }: {
    title: string;
    description: string;
    onClose?: () => void;
  }) => (
    <section>
      <strong>{title}</strong>
      <div>{description}</div>
      {onClose ? <button onClick={onClose}>閉じる</button> : null}
    </section>
  ),
  erpStatusDictionary: {},
}));

import { TimeEntries } from './TimeEntries';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.mocked(getAuthState).mockReturnValue({
    token: 'token',
    userId: 'user-1',
    roles: ['member'],
    projectIds: ['demo-project'],
  });
  vi.mocked(useProjects).mockReturnValue({
    projects: [
      { id: 'demo-project', code: 'PRJ', name: 'Demo Project' },
      { id: 'project-2', code: 'OPS', name: 'Operations' },
    ],
    projectMessage: '',
  });
  vi.mocked(useProjectTasks).mockReturnValue({
    tasks: [
      { id: 'task-1', name: 'Implementation' },
      { id: 'task-2', name: 'Review' },
    ],
    taskMessage: '',
    isLoading: false,
  });
  vi.mocked(getDraftOwnerId).mockReturnValue('draft-owner');
  vi.mocked(loadDraft).mockResolvedValue(null);
  vi.mocked(saveDraft).mockResolvedValue(undefined);
  vi.mocked(clearDraft).mockResolvedValue(undefined);
  vi.mocked(enqueueOfflineItem).mockResolvedValue(undefined);
  vi.mocked(isOfflineError).mockReturnValue(false);
});

describe('TimeEntries', () => {
  it('loads entries and opens the daily report for the selected date', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          id: 'entry-1',
          projectId: 'demo-project',
          workDate: '2026-03-25',
          minutes: 120,
          status: 'submitted',
          workType: '通常',
          location: 'office',
          notes: 'monthly close',
        },
      ],
    } as never);

    render(<TimeEntries />);

    expect(await screen.findByText(/PRJ \/ Demo Project/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('日付'), {
      target: { value: '2026-03-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: '日報を開く' }));

    expect(vi.mocked(navigateToOpen)).toHaveBeenCalledWith({
      kind: 'daily_report',
      id: '2026-03-31',
    });
  });

  it('restores a saved draft including the deferred project selection', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] } as never);
    vi.mocked(loadDraft).mockResolvedValue({
      projectId: 'project-2',
      taskId: 'task-2',
      workDate: '2026-03-20',
      minutes: 30,
      workType: '会議',
      location: 'remote',
      notes: 'draft note',
    });

    render(<TimeEntries />);

    await waitFor(() => {
      expect(screen.getByLabelText('案件選択')).toHaveValue('project-2');
    });
    expect(screen.getByLabelText('タスク選択')).toHaveValue('task-2');
    expect(screen.getByLabelText('日付')).toHaveValue('2026-03-20');
    expect(screen.getByLabelText('作業メモ')).toHaveValue('draft note');
    expect(vi.mocked(loadDraft)).toHaveBeenCalledWith('time-entry:draft-owner');
  });

  it('shows validation and hook error messages when the form is invalid', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] } as never);
    vi.mocked(useProjects).mockReturnValue({
      projects: [{ id: 'demo-project', code: 'PRJ', name: 'Demo Project' }],
      projectMessage: '案件一覧の取得に失敗しました',
    });
    vi.mocked(useProjectTasks).mockReturnValue({
      tasks: [],
      taskMessage: 'タスク一覧の取得に失敗しました',
      isLoading: false,
    });

    render(<TimeEntries />);

    fireEvent.change(screen.getByLabelText('工数 (分)'), {
      target: { value: '17' },
    });

    expect(
      screen.getAllByText('工数は15分単位で入力してください'),
    ).toHaveLength(2);
    expect(
      screen.getByText('案件一覧の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('タスク一覧の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled();
  });

  it('submits a valid entry, refreshes the list, and clears the draft', async () => {
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/time-entries' && !init) {
          return { items: [] } as never;
        }
        if (path === '/time-entries' && init?.method === 'POST') {
          return { id: 'saved-entry' } as never;
        }
        throw new Error(`Unhandled api call: ${path}`);
      },
    );

    render(<TimeEntries />);

    await screen.findByText('工数がありません');
    fireEvent.change(screen.getByLabelText('日付'), {
      target: { value: '2026-03-28' },
    });
    fireEvent.change(screen.getByLabelText('工数 (分)'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByLabelText('作業種別'), {
      target: { value: 'レビュー' },
    });
    fireEvent.change(screen.getByLabelText('場所'), {
      target: { value: 'remote' },
    });
    fireEvent.change(screen.getByLabelText('作業メモ'), {
      target: { value: 'ship checklist' },
    });
    fireEvent.change(screen.getByLabelText('タスク選択'), {
      target: { value: 'task-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(await screen.findByText('保存しました')).toBeInTheDocument();

    const postCall = vi
      .mocked(api)
      .mock.calls.find(
        ([path, init]) => path === '/time-entries' && init?.method === 'POST',
      );
    expect(postCall).toBeDefined();
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body).toMatchObject({
      projectId: 'demo-project',
      taskId: 'task-1',
      workDate: '2026-03-28',
      minutes: 120,
      workType: 'レビュー',
      location: 'remote',
      notes: 'ship checklist',
      userId: 'user-1',
    });
    expect(vi.mocked(clearDraft)).toHaveBeenCalledWith(
      'time-entry:draft-owner',
    );
    expect(screen.getByLabelText('作業メモ')).toHaveValue('');
  });

  it('shows a fetch error and reloads the list when retry succeeds', async () => {
    let attempts = 0;
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path !== '/time-entries') {
        throw new Error(`Unhandled api call: ${path}`);
      }
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary failure');
      }
      return {
        items: [
          {
            id: 'entry-2',
            projectId: 'demo-project',
            workDate: '2026-03-29',
            minutes: 90,
            status: 'draft',
          },
        ],
      } as never;
    });

    render(<TimeEntries />);

    expect(
      await screen.findByText('工数一覧の取得に失敗しました'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再取得' }));

    expect(await screen.findByText(/PRJ \/ Demo Project/)).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('queues the submission when the save fails offline', async () => {
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/time-entries' && !init) {
          return { items: [] } as never;
        }
        if (path === '/time-entries' && init?.method === 'POST') {
          throw new Error('offline');
        }
        throw new Error(`Unhandled api call: ${path}`);
      },
    );
    vi.mocked(isOfflineError).mockReturnValue(true);

    render(<TimeEntries />);

    await screen.findByText('工数がありません');
    fireEvent.change(screen.getByLabelText('日付'), {
      target: { value: '2026-03-30' },
    });
    fireEvent.change(screen.getByLabelText('工数 (分)'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(
      await screen.findByText('オフラインのため送信待ちに保存しました'),
    ).toBeInTheDocument();
    expect(vi.mocked(enqueueOfflineItem)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'time-entry',
        label: '工数 2026-03-30 45分',
        requests: [
          expect.objectContaining({
            path: '/time-entries',
            method: 'POST',
            body: expect.objectContaining({
              workDate: '2026-03-30',
              minutes: 45,
              userId: 'user-1',
            }),
          }),
        ],
      }),
    );
    expect(vi.mocked(clearDraft)).toHaveBeenCalledWith(
      'time-entry:draft-owner',
    );
  });
});
