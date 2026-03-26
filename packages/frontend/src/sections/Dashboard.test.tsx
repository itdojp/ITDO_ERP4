import {
  cleanup,
  fireEvent,
  render,
  screen,
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
      screen.getByText('承認待ち: 2件 / 自分の承認待ち: 1件'),
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
