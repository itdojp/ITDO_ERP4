import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, getAuthState, navigateToOpen } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  navigateToOpen: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../utils/deepLink', () => ({ navigateToOpen }));
vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

import { Dashboard } from './Dashboard';

type NotificationFixture = {
  id: string;
  userId?: string;
  kind: string;
  projectId?: string | null;
  messageId?: string | null;
  payload?: unknown;
  createdAt: string;
  project?: {
    id: string;
    code: string;
    name: string;
    deletedAt?: string | null;
  } | null;
};

const setupDashboard = ({
  notifications,
  roomMuteFailure = false,
}: {
  notifications: NotificationFixture[];
  roomMuteFailure?: boolean;
}) => {
  getAuthState.mockReturnValue({
    userId: 'user-1',
    roles: [],
    groupIds: [],
    groupAccountIds: [],
  });
  api.mockImplementation(
    (path: string, options?: { method?: string; body?: string }) => {
      if (path === '/alerts') {
        return Promise.resolve({ items: [] });
      }
      if (path === '/notifications/unread-count') {
        return Promise.resolve({ unreadCount: notifications.length });
      }
      if (path === '/notifications?unread=1&limit=5') {
        return Promise.resolve({ items: notifications });
      }
      if (path === '/notification-preferences') {
        return Promise.resolve({ muteAllUntil: null });
      }
      if (path === '/approval-instances?status=pending_qa') {
        return Promise.resolve({ items: [] });
      }
      if (path === '/approval-instances?status=pending_exec') {
        return Promise.resolve({ items: [] });
      }
      if (
        path.startsWith('/chat-rooms/') &&
        path.endsWith('/notification-setting')
      ) {
        return roomMuteFailure
          ? Promise.reject(new Error('room mute failed'))
          : Promise.resolve({});
      }
      if (path === '/insights') {
        return Promise.resolve({ items: [] });
      }
      throw new Error(`unexpected api call: ${path}`);
    },
  );
};

beforeEach(() => {
  api.mockReset();
  getAuthState.mockReset();
  navigateToOpen.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-27T01:00:00.000Z'));
  getAuthState.mockReturnValue({
    userId: 'user-1',
    roles: ['mgmt'],
    groupIds: ['group-1'],
    groupAccountIds: [],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Dashboard', () => {
  it('renders additional notification kinds and opens their linked targets', async () => {
    setupDashboard({
      notifications: [
        {
          id: 'notif-1',
          userId: 'user-1',
          kind: 'daily_report_submitted',
          projectId: 'project-1',
          payload: { reportDate: '2026-03-26' },
          createdAt: '2026-03-27T00:00:00.000Z',
        },
        {
          id: 'notif-2',
          userId: 'user-1',
          kind: 'leave_upcoming',
          projectId: 'project-2',
          messageId: 'leave-1',
          payload: {
            leaveRequestId: 'leave-1',
            startDate: '2026-04-01',
            endDate: '2026-04-03',
            leaveType: '有給',
          },
          createdAt: '2026-03-27T00:10:00.000Z',
        },
        {
          id: 'notif-3',
          userId: 'user-1',
          kind: 'expense_mark_paid',
          projectId: 'project-3',
          messageId: 'expense-1',
          payload: { expenseId: 'expense-1', amount: 1200, currency: 'JPY' },
          createdAt: '2026-03-27T00:20:00.000Z',
        },
        {
          id: 'notif-4',
          userId: 'user-1',
          kind: 'approval_pending',
          projectId: 'project-4',
          payload: { fromUserId: 'approver-1', flowType: 'invoice' },
          createdAt: '2026-03-27T00:30:00.000Z',
        },
        {
          id: 'notif-5',
          userId: 'user-1',
          kind: 'approval_approved',
          projectId: 'project-5',
          payload: {
            fromUserId: 'approver-2',
            flowType: 'vendor_invoice',
            targetTable: 'vendor_invoices',
            targetId: 'vi-1',
          },
          createdAt: '2026-03-27T00:40:00.000Z',
        },
        {
          id: 'notif-6',
          userId: 'user-1',
          kind: 'approval_rejected',
          projectId: 'project-6',
          payload: { fromUserId: 'approver-3', flowType: 'purchase_order' },
          createdAt: '2026-03-27T00:50:00.000Z',
        },
        {
          id: 'notif-7',
          userId: 'user-1',
          kind: 'project_status_changed',
          projectId: 'project-7',
          payload: {
            fromUserId: 'pm-1',
            beforeStatus: 'draft',
            afterStatus: 'active',
          },
          createdAt: '2026-03-27T00:55:00.000Z',
        },
      ],
    });

    render(<Dashboard />);

    expect(
      await screen.findByText('日報提出 (2026-03-26)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('休暇予定 (2026-04-01〜2026-04-03)'),
    ).toBeInTheDocument();
    expect(screen.getByText('経費支払完了 (1200 JPY)')).toBeInTheDocument();
    expect(
      screen.getByText('approver-1 から請求の承認依頼'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('approver-2 により仕入請求が承認されました'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('approver-3 により発注が差戻しとなりました'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('pm-1 が案件ステータスを更新しました (起案中 → 進行中)'),
    ).toBeInTheDocument();

    const dailyReportCard = within(
      screen
        .getByText('日報提出 (2026-03-26)')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(dailyReportCard.getByRole('button', { name: '開く' }));

    const leaveCard = within(
      screen
        .getByText('休暇予定 (2026-04-01〜2026-04-03)')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(leaveCard.getByRole('button', { name: '開く' }));

    const expenseCard = within(
      screen
        .getByText('経費支払完了 (1200 JPY)')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(expenseCard.getByRole('button', { name: '開く' }));

    const approvalPendingCard = within(
      screen
        .getByText('approver-1 から請求の承認依頼')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(approvalPendingCard.getByRole('button', { name: '開く' }));

    const approvalApprovedCard = within(
      screen
        .getByText('approver-2 により仕入請求が承認されました')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(approvalApprovedCard.getByRole('button', { name: '開く' }));

    const approvalRejectedCard = within(
      screen
        .getByText('approver-3 により発注が差戻しとなりました')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(approvalRejectedCard.getByRole('button', { name: '開く' }));

    const projectCard = within(
      screen
        .getByText('pm-1 が案件ステータスを更新しました (起案中 → 進行中)')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(projectCard.getByRole('button', { name: '開く' }));

    expect(navigateToOpen).toHaveBeenNthCalledWith(1, {
      kind: 'daily_report',
      id: '2026-03-26',
    });
    expect(navigateToOpen).toHaveBeenNthCalledWith(2, {
      kind: 'leave_request',
      id: 'leave-1',
    });
    expect(navigateToOpen).toHaveBeenNthCalledWith(3, {
      kind: 'expense',
      id: 'expense-1',
    });
    expect(navigateToOpen).toHaveBeenNthCalledWith(4, {
      kind: 'approvals',
      id: 'inbox',
    });
    expect(navigateToOpen).toHaveBeenNthCalledWith(5, {
      kind: 'vendor_invoice',
      id: 'vi-1',
    });
    expect(navigateToOpen).toHaveBeenNthCalledWith(6, {
      kind: 'approvals',
      id: 'inbox',
    });
    expect(navigateToOpen).toHaveBeenNthCalledWith(7, {
      kind: 'project',
      id: 'project-7',
    });
  });

  it('mutes a room notification successfully', async () => {
    setupDashboard({
      notifications: [
        {
          id: 'notif-room-1',
          userId: 'user-1',
          kind: 'chat_ack_escalation',
          projectId: 'project-1',
          messageId: 'message-1',
          payload: {
            fromUserId: 'room-user',
            roomId: 'room-1',
            dueAt: '2026-03-27T02:00:00.000Z',
          },
          createdAt: '2026-03-27T00:00:00.000Z',
        },
      ],
    });

    render(<Dashboard />);

    expect(
      await screen.findByText('room-user から確認依頼（エスカレーション）'),
    ).toBeInTheDocument();

    const roomCard = within(
      screen
        .getByText('room-user から確認依頼（エスカレーション）')
        .closest('section') as HTMLElement,
    );
    fireEvent.click(roomCard.getByRole('button', { name: '10分' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/chat-rooms/room-1/notification-setting',
        {
          method: 'PATCH',
          body: JSON.stringify({ muteUntil: '2026-03-27T01:10:00.000Z' }),
        },
      );
    });
    expect(
      await screen.findByText('ルーム通知をミュートしました'),
    ).toBeInTheDocument();
  });

  it('shows a room mute failure message when the patch request fails', async () => {
    setupDashboard({
      notifications: [
        {
          id: 'notif-room-2',
          userId: 'user-1',
          kind: 'chat_message',
          projectId: 'project-1',
          messageId: 'message-2',
          payload: {
            fromUserId: 'room-user',
            roomId: 'room-2',
            excerpt: '確認してください',
          },
          createdAt: '2026-03-27T00:00:00.000Z',
        },
      ],
      roomMuteFailure: true,
    });

    render(<Dashboard />);

    expect(await screen.findByText('room-user から投稿')).toBeInTheDocument();

    const roomCard = within(
      screen.getByText('room-user から投稿').closest('section') as HTMLElement,
    );
    fireEvent.click(roomCard.getByRole('button', { name: '10分' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/chat-rooms/room-2/notification-setting',
        {
          method: 'PATCH',
          body: JSON.stringify({ muteUntil: '2026-03-27T01:10:00.000Z' }),
        },
      );
    });
    expect(
      await screen.findByText('ルーム通知ミュートの更新に失敗しました'),
    ).toBeInTheDocument();
  });

  it('loads dashboard summaries and supports opening and muting notifications', async () => {
    api.mockImplementation(
      (path: string, options?: { method?: string; body?: string }) => {
        switch (path) {
          case '/alerts':
            return Promise.resolve({
              items: [
                {
                  id: 'alert-1',
                  type: 'integration_failure',
                  targetRef: '連携A',
                  status: 'open',
                  triggeredAt: '2026-03-27T00:00:00.000Z',
                  sentChannels: ['email'],
                },
              ],
            });
          case '/notifications/unread-count':
            return Promise.resolve({ unreadCount: 2 });
          case '/notifications?unread=1&limit=5':
            return Promise.resolve({
              items: [
                {
                  id: 'notif-1',
                  userId: 'user-1',
                  kind: 'daily_report_missing',
                  projectId: 'project-1',
                  payload: { reportDate: '2026-03-27' },
                  createdAt: '2026-03-27T00:00:00.000Z',
                },
              ],
            });
          case '/notification-preferences':
            if (options?.method === 'PATCH') {
              return Promise.resolve({
                muteAllUntil: '2026-03-27T01:10:00.000Z',
              });
            }
            return Promise.resolve({
              muteAllUntil: '2026-03-27T01:00:00.000Z',
            });
          case '/insights':
            return Promise.resolve({
              items: [
                {
                  id: 'insight-1',
                  type: 'budget_overrun',
                  severity: 'high',
                  count: 2,
                  latestAt: '2026-03-27T02:00:00.000Z',
                  sampleTargets: ['PJ-001'],
                  evidence: {
                    period: {
                      from: '2026-03-01T00:00:00.000Z',
                      to: '2026-03-31T00:00:00.000Z',
                    },
                    calculation: '予算差分',
                    targets: [],
                    settings: [],
                  },
                },
              ],
            });
          case '/approval-instances?status=pending_qa':
            return Promise.resolve({
              items: [
                {
                  id: 'approval-1',
                  status: 'pending_qa',
                  currentStep: 1,
                  steps: [
                    {
                      id: 'step-1',
                      stepOrder: 1,
                      approverGroupId: 'group-1',
                      status: 'pending_qa',
                    },
                  ],
                },
              ],
            });
          case '/approval-instances?status=pending_exec':
            return Promise.resolve({
              items: [
                {
                  id: 'approval-2',
                  status: 'pending_exec',
                  currentStep: 2,
                  steps: [
                    {
                      id: 'step-2',
                      stepOrder: 2,
                      approverGroupId: 'group-2',
                      status: 'pending_qa',
                    },
                  ],
                },
              ],
            });
          case '/notifications/notif-1/read':
            return Promise.resolve({});
          default:
            throw new Error(`unexpected api call: ${path}`);
        }
      },
    );

    render(<Dashboard />);

    expect(await screen.findByText('Unread 2')).toBeInTheDocument();
    expect(
      screen.getByText(/承認待ち:\s*2\s*件\s*\/\s*自分の承認待ち:\s*1\s*件/),
    ).toBeInTheDocument();
    expect(screen.getByText('予算超過の兆候')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(navigateToOpen).toHaveBeenCalledWith({
      kind: 'daily_report',
      id: '2026-03-27',
    });

    fireEvent.click(screen.getByRole('button', { name: '既読' }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/notifications/notif-1/read', {
        method: 'POST',
      });
    });
    expect(screen.getByText('Unread 1')).toBeInTheDocument();
    expect(screen.getByText('通知なし')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '10分' }));
    expect(
      await screen.findByText('通知ミュートを更新しました'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify({ muteAllUntil: '2026-03-27T01:10:00.000Z' }),
    });
  });

  it('shows fetch errors for notifications, mute settings, insights, and approvals', async () => {
    api.mockImplementation((path: string) => {
      switch (path) {
        case '/alerts':
          return Promise.resolve({ items: [] });
        case '/notifications/unread-count':
        case '/notifications?unread=1&limit=5':
          return Promise.reject(new Error('notifications failed'));
        case '/notification-preferences':
          return Promise.reject(new Error('mute failed'));
        case '/insights':
          return Promise.reject(new Error('insights failed'));
        case '/approval-instances?status=pending_qa':
        case '/approval-instances?status=pending_exec':
          return Promise.reject(new Error('approvals failed'));
        default:
          throw new Error(`unexpected api call: ${path}`);
      }
    });

    render(<Dashboard />);

    expect(
      await screen.findByText('通知の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('通知設定の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('インサイトの取得に失敗しました'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('承認状況の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(screen.getByText('アラートなし')).toBeInTheDocument();
  });

  it('toggles alert list between recent and all items', async () => {
    api.mockImplementation((path: string) => {
      switch (path) {
        case '/alerts':
          return Promise.resolve({
            items: Array.from({ length: 6 }, (_, index) => ({
              id: `alert-${index + 1}`,
              type: `alert-type-${index + 1}`,
              targetRef: `target-${index + 1}`,
              status: 'open',
              triggeredAt: '2026-03-27T00:00:00.000Z',
              sentChannels: [],
            })),
          });
        case '/notifications/unread-count':
          return Promise.resolve({ unreadCount: 0 });
        case '/notifications?unread=1&limit=5':
          return Promise.resolve({ items: [] });
        case '/notification-preferences':
          return Promise.resolve({ muteAllUntil: null });
        case '/insights':
          return Promise.resolve({ items: [] });
        case '/approval-instances?status=pending_qa':
        case '/approval-instances?status=pending_exec':
          return Promise.resolve({ items: [] });
        default:
          throw new Error(`unexpected api call: ${path}`);
      }
    });

    render(<Dashboard />);

    expect(await screen.findByText('Alerts (最新5件)')).toBeInTheDocument();
    expect(screen.queryByText('alert-type-6')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'すべて表示' }));
    expect(screen.getByText('Alerts (全6件)')).toBeInTheDocument();
    expect(screen.getByText('alert-type-6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '最新のみ' }));
    expect(screen.getByText('Alerts (最新5件)')).toBeInTheDocument();
  });
});
