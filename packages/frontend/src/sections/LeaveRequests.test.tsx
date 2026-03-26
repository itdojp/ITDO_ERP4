import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, apiResponse, getAuthState, navigateToOpen } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  getAuthState: vi.fn(),
  navigateToOpen: vi.fn(),
}));

vi.mock('../api', () => ({ api, apiResponse, getAuthState }));
vi.mock('../utils/deepLink', () => ({ navigateToOpen }));
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: ({ targetId }: { targetId: string }) => (
    <div>annotations:{targetId}</div>
  ),
}));

import { LeaveRequests } from './LeaveRequests';

type ApiResponsePayload = Record<string, unknown>;

const defaultLeaveTypes = [
  {
    code: 'paid',
    name: '有給休暇',
    isPaid: true,
    unit: 'mixed',
    attachmentPolicy: 'optional',
    active: true,
    displayOrder: 1,
  },
  {
    code: 'hourly-only',
    name: '時間休',
    isPaid: true,
    unit: 'hourly',
    attachmentPolicy: 'optional',
    active: true,
    displayOrder: 2,
  },
];

function mockApiImplementation(overrides?: {
  leaveRequests?: ApiResponsePayload;
  leaveTypes?: ApiResponsePayload;
  balance?: ApiResponsePayload;
  postLeaveRequest?: ApiResponsePayload;
  personalGaRoom?: ApiResponsePayload;
  profilePostError?: boolean;
  grantPostError?: boolean;
}) {
  vi.mocked(api).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path.startsWith('/leave-requests?userId=')) {
        return (overrides?.leaveRequests ?? { items: [] }) as never;
      }
      if (path === '/leave-settings') {
        return {
          timeUnitMinutes: 10,
          defaultWorkdayMinutes: 480,
        } as never;
      }
      if (path === '/leave-types') {
        return (overrides?.leaveTypes ?? { items: defaultLeaveTypes }) as never;
      }
      if (path.startsWith('/leave-entitlements/balance?userId=')) {
        return (overrides?.balance ?? {
          userId: 'user-1',
          asOfDate: '2026-03-27',
          paidLeaveBaseDate: '2026-01-01',
          nextGrantDueDate: '2027-01-01',
          totalGrantedMinutes: 480,
          usedApprovedMinutes: 60,
          reservedPendingMinutes: 30,
          consumedMinutes: 90,
          remainingMinutes: 390,
          requestedMinutes: 0,
          projectedRemainingMinutes: 390,
          shortageWarning: null,
        }) as never;
      }
      if (path === '/leave-requests' && init?.method === 'POST') {
        return (overrides?.postLeaveRequest ?? {
          id: 'leave-new',
          userId: 'user-1',
          leaveType: 'paid',
          startDate: '2026-03-27',
          endDate: '2026-03-27',
          hours: 8,
          status: 'draft',
          notes: 'created',
        }) as never;
      }
      if (path === '/chat-rooms/personal-general-affairs') {
        if (overrides?.personalGaRoom) return overrides.personalGaRoom as never;
        throw new Error('room failure');
      }
      if (path === '/leave-entitlements/profiles' && init?.method === 'POST') {
        if (overrides?.profilePostError) throw new Error('profile failure');
        return {} as never;
      }
      if (path === '/leave-entitlements/grants' && init?.method === 'POST') {
        if (overrides?.grantPostError) throw new Error('grant failure');
        return {} as never;
      }
      throw new Error(`Unhandled api path: ${path}`);
    },
  );
}

function mockApiResponseImplementation(overrides?: {
  submitResponse?: {
    ok: boolean;
    status?: number;
    payload?: ApiResponsePayload;
  };
  leaderResponse?: {
    ok: boolean;
    status?: number;
    payload?: ApiResponsePayload;
  };
}) {
  vi.mocked(apiResponse).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (
        path === '/leave-requests/leave-1/submit' &&
        init?.method === 'POST'
      ) {
        const response = overrides?.submitResponse ?? {
          ok: true,
          status: 200,
          payload: {
            id: 'leave-1',
            userId: 'user-1',
            leaveType: 'paid',
            startDate: '2026-03-27',
            endDate: '2026-03-27',
            hours: 8,
            status: 'submitted',
          },
        };
        return {
          ok: response.ok,
          status: response.status ?? 200,
          json: async () => response.payload ?? {},
        } as Response;
      }
      if (path === '/leave-requests/leader?limit=100') {
        const response = overrides?.leaderResponse ?? {
          ok: true,
          status: 200,
          payload: { items: [] },
        };
        return {
          ok: response.ok,
          status: response.status ?? 200,
          json: async () => response.payload ?? {},
        } as Response;
      }
      throw new Error(`Unhandled apiResponse path: ${path}`);
    },
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthState).mockReturnValue({
    token: 'token',
    userId: 'user-1',
    roles: ['member'],
    groupAccountIds: ['general_affairs'],
  });
  mockApiImplementation();
  mockApiResponseImplementation();
});

describe('LeaveRequests', () => {
  it('validates hourly leave range', async () => {
    render(<LeaveRequests />);

    await screen.findByText('有給休暇 (paid)');
    fireEvent.change(screen.getByLabelText('休暇種別'), {
      target: { value: 'hourly-only' },
    });
    fireEvent.change(screen.getByLabelText('時間休開始時刻'), {
      target: { value: '12:00' },
    });
    fireEvent.change(screen.getByLabelText('時間休終了時刻'), {
      target: { value: '11:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    expect(
      await screen.findByText('終了時刻は開始時刻より後にしてください'),
    ).toBeInTheDocument();
    expect(vi.mocked(api)).not.toHaveBeenCalledWith(
      '/leave-requests',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates a leave request and prepends it to the list', async () => {
    render(<LeaveRequests />);

    await screen.findByText('有給休暇 (paid)');
    fireEvent.change(screen.getByLabelText('休暇時間(任意)'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('備考(任意)'), {
      target: { value: 'created' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    expect(await screen.findByText('作成しました')).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/有給休暇 \(paid\)/)).length,
    ).toBeGreaterThan(0);
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/leave-requests',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows submit validation message when no consultation reason is required', async () => {
    mockApiImplementation({
      leaveRequests: {
        items: [
          {
            id: 'leave-1',
            userId: 'user-1',
            leaveType: 'paid',
            startDate: '2026-03-27',
            endDate: '2026-03-27',
            hours: 8,
            status: 'draft',
          },
        ],
      },
    });
    mockApiResponseImplementation({
      submitResponse: {
        ok: false,
        status: 400,
        payload: {
          error: { code: 'NO_CONSULTATION_REASON_REQUIRED' },
        },
      },
    });

    render(<LeaveRequests />);

    await screen.findByText('有給休暇 (paid)');
    fireEvent.click(await screen.findByRole('button', { name: '申請' }));

    expect(
      await screen.findByText(
        '相談証跡が未添付の場合は「相談無し」の確認と理由の入力が必要です',
      ),
    ).toBeInTheDocument();
  });

  it('opens personal general affairs room when lookup succeeds', async () => {
    mockApiImplementation({
      leaveRequests: {
        items: [
          {
            id: 'leave-1',
            userId: 'user-1',
            leaveType: 'paid',
            startDate: '2026-03-27',
            endDate: '2026-03-27',
            hours: 8,
            status: 'draft',
          },
        ],
      },
      personalGaRoom: { roomId: 'room-ga-1' },
    });

    render(<LeaveRequests />);

    await screen.findByText('有給休暇 (paid)');
    fireEvent.click(await screen.findByRole('button', { name: '詳細' }));
    fireEvent.click(
      screen.getByRole('button', { name: '総務へ相談チャットを開く' }),
    );

    await waitFor(() => {
      expect(navigateToOpen).toHaveBeenCalledWith({
        kind: 'room_chat',
        id: 'room-ga-1',
      });
    });
  });

  it('shows leader message when leader list returns 403', async () => {
    mockApiResponseImplementation({
      leaderResponse: {
        ok: false,
        status: 403,
        payload: {},
      },
    });

    render(<LeaveRequests />);

    fireEvent.click(
      screen.getByRole('button', { name: '上長向け一覧を読み込み' }),
    );

    expect(
      await screen.findByText(
        '上長一覧はプロジェクト管理者（または admin/mgmt）のみ閲覧できます',
      ),
    ).toBeInTheDocument();
  });
});
