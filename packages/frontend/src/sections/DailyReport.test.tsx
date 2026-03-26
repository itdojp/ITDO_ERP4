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
  loadDraft,
  saveDraft,
  clearDraft,
  getDraftOwnerId,
  enqueueOfflineItem,
  isOfflineError,
} = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  getDraftOwnerId: vi.fn(),
  enqueueOfflineItem: vi.fn(),
  isOfflineError: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../utils/drafts', () => ({
  clearDraft,
  getDraftOwnerId,
  loadDraft,
  saveDraft,
}));
vi.mock('../utils/offlineQueue', () => ({
  enqueueOfflineItem,
  isOfflineError,
}));
vi.mock('./HelpModal', () => ({
  HelpModal: ({ onClose }: { onClose: () => void }) => (
    <div>
      <span>HelpModal</span>
      <button type="button" onClick={onClose}>
        閉じる
      </button>
    </div>
  ),
}));

import { DailyReport } from './DailyReport';

const defaultProjects = [
  { id: 'project-1', code: 'P001', name: 'Project One' },
  { id: 'project-2', code: 'P002', name: 'Project Two' },
];

const pad2 = (value: number) => String(value).padStart(2, '0');
const toLocalDateKey = (value: Date) =>
  `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;

const createDateOffset = (days: number) => {
  const current = new Date();
  current.setDate(current.getDate() + days);
  return toLocalDateKey(current);
};

type ReportItem = {
  id: string;
  userId: string;
  reportDate: string;
  content: string;
  linkedProjectIds?: string[];
  status?: string | null;
};

type TimeEntry = {
  id: string;
  projectId: string;
  workDate: string;
  minutes: number;
  status: string;
};

const createApiMock = (options?: {
  editableDays?: number;
  reports?: Record<string, ReportItem[]>;
  timeEntries?: Record<string, TimeEntry[]>;
  onPost?: (path: string, init?: { method?: string; body?: string }) => unknown;
}) => {
  return async (path: string, init?: { method?: string; body?: string }) => {
    if (path === '/projects') {
      return { items: defaultProjects };
    }
    if (path === '/worklog-settings') {
      return { editableDays: options?.editableDays ?? 14 };
    }
    if (path.startsWith('/daily-reports?')) {
      const dateKey =
        new URLSearchParams(path.split('?')[1]).get('reportDate') ?? '';
      return { items: options?.reports?.[dateKey] ?? [] };
    }
    if (path === '/daily-reports' && init?.method === 'POST') {
      return options?.onPost?.(path, init) ?? { id: 'saved-report' };
    }
    if (path === '/wellbeing-entries' && init?.method === 'POST') {
      return options?.onPost?.(path, init) ?? { id: 'saved-wellbeing' };
    }
    if (path.startsWith('/time-entries?')) {
      const query = new URLSearchParams(path.split('?')[1]);
      const dateKey = query.get('from') ?? '';
      return { items: options?.timeEntries?.[dateKey] ?? [] };
    }
    if (path.startsWith('/daily-reports/') && path.endsWith('/revisions')) {
      return { items: [] };
    }
    throw new Error(`unexpected api call: ${path}`);
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthState).mockReturnValue({ userId: 'user-1', roles: [] });
  vi.mocked(getDraftOwnerId).mockImplementation((userId?: string) =>
    userId ? `draft:${userId}` : 'draft:anonymous',
  );
  vi.mocked(loadDraft).mockResolvedValue(null);
  vi.mocked(saveDraft).mockResolvedValue(undefined);
  vi.mocked(clearDraft).mockResolvedValue(undefined);
  vi.mocked(enqueueOfflineItem).mockResolvedValue(undefined);
  vi.mocked(isOfflineError).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
});

describe('DailyReport', () => {
  it('updates the target date when erp4_open_entity is dispatched', async () => {
    const todayKey = toLocalDateKey(new Date());
    const previousDate = createDateOffset(-3);
    vi.mocked(api).mockImplementation(
      createApiMock({
        reports: {
          [todayKey]: [
            {
              id: 'report-today',
              userId: 'user-1',
              reportDate: todayKey,
              content: '今日の日報',
              linkedProjectIds: ['project-1'],
            },
          ],
          [previousDate]: [
            {
              id: 'report-prev',
              userId: 'user-1',
              reportDate: previousDate,
              content: '過去の日報',
              linkedProjectIds: ['project-2'],
            },
          ],
        },
      }),
    );

    render(<DailyReport />);

    expect(await screen.findByDisplayValue('今日の日報')).toBeInTheDocument();

    window.dispatchEvent(
      new CustomEvent('erp4_open_entity', {
        detail: { kind: 'daily_report', id: ` ${previousDate} ` },
      }),
    );

    await screen.findByDisplayValue('過去の日報');

    expect(screen.getByLabelText('対象日')).toHaveValue(previousDate);
    expect(api).toHaveBeenCalledWith(
      `/daily-reports?reportDate=${previousDate}`,
    );
  });

  it('adds all linked projects from the loaded time entries', async () => {
    const todayKey = toLocalDateKey(new Date());
    vi.mocked(api).mockImplementation(
      createApiMock({
        timeEntries: {
          [todayKey]: [
            {
              id: 'time-1',
              projectId: 'project-1',
              workDate: todayKey,
              minutes: 45,
              status: 'approved',
            },
            {
              id: 'time-2',
              projectId: 'project-2',
              workDate: todayKey,
              minutes: 30,
              status: 'approved',
            },
            {
              id: 'time-3',
              projectId: 'project-1',
              workDate: todayKey,
              minutes: 15,
              status: 'approved',
            },
          ],
        },
      }),
    );

    render(<DailyReport />);

    expect(await screen.findByText('合計: 90 分')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '工数の案件を全て関連付け' }),
    );

    await waitFor(() => {
      const selectedValues = Array.from(
        (screen.getByLabelText('関連案件') as HTMLSelectElement)
          .selectedOptions,
      ).map((option) => option.value);
      expect(selectedValues).toEqual(['project-1', 'project-2']);
    });
  });

  it('validates that status is required before submit', async () => {
    vi.mocked(api).mockImplementation(createApiMock());

    render(<DailyReport />);

    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    expect(
      await screen.findByText('Good / Not Good を選択してください'),
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path, init]) =>
            path === '/daily-reports' && init?.method === 'POST',
        ),
    ).toBe(false);
  });

  it('queues requests when submit fails due to offline state', async () => {
    const todayKey = toLocalDateKey(new Date());
    const offlineError = new Error('offline');
    vi.mocked(isOfflineError).mockImplementation(
      (error) => error === offlineError,
    );
    vi.mocked(api).mockImplementation(
      createApiMock({
        onPost: (path) => {
          if (path === '/daily-reports') {
            throw offlineError;
          }
          return { id: 'ignored' };
        },
      }),
    );

    render(<DailyReport />);

    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.change(screen.getByLabelText('日報本文'), {
      target: { value: '本日の進捗を記録します' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => {
      expect(enqueueOfflineItem).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'daily-report',
          label: `日報 ${todayKey}`,
          cursor: 0,
        }),
      );
    });

    expect(
      await screen.findByText('オフラインのため送信待ちに保存しました'),
    ).toBeInTheDocument();
    expect(clearDraft).toHaveBeenCalled();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path, init]) =>
            path === '/wellbeing-entries' && init?.method === 'POST',
        ),
    ).toBe(false);
  });

  it('requires a reason when a privileged user edits a locked date', async () => {
    const lockedDate = createDateOffset(-30);
    vi.mocked(getAuthState).mockReturnValue({
      userId: 'admin-1',
      roles: ['admin'],
    });
    vi.mocked(api).mockImplementation(
      createApiMock({
        editableDays: 7,
        reports: {
          [lockedDate]: [
            {
              id: 'report-locked',
              userId: 'admin-1',
              reportDate: lockedDate,
              content: 'ロック済み日報',
            },
          ],
        },
      }),
    );

    render(<DailyReport />);

    fireEvent.change(screen.getByLabelText('対象日'), {
      target: { value: lockedDate },
    });

    expect(await screen.findByLabelText('修正理由')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    expect(
      await screen.findByText(
        'ロック解除で修正する場合は理由を入力してください',
      ),
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path, init]) =>
            path === '/daily-reports' && init?.method === 'POST',
        ),
    ).toBe(false);
  });
});
