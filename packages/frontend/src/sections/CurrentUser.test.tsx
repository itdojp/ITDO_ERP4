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

const {
  api,
  apiResponse,
  buildApiUrl,
  getAuthState,
  isBffAuthMode,
  refreshAuthStateFromServer,
  setAuthState,
  listOfflineItems,
  processOfflineQueue,
  removeOfflineItem,
} = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  buildApiUrl: vi.fn(),
  getAuthState: vi.fn(),
  isBffAuthMode: vi.fn(),
  refreshAuthStateFromServer: vi.fn(),
  setAuthState: vi.fn(),
  listOfflineItems: vi.fn(),
  processOfflineQueue: vi.fn(),
  removeOfflineItem: vi.fn(),
}));

vi.mock('../api', () => ({
  api,
  apiResponse,
  buildApiUrl,
  getAuthState,
  isBffAuthMode,
  refreshAuthStateFromServer,
  setAuthState,
}));
vi.mock('../utils/offlineQueue', () => ({
  listOfflineItems,
  processOfflineQueue,
  removeOfflineItem,
}));

import { CurrentUser } from './CurrentUser';

type NavigatorWithOptionalOnLine = Omit<Navigator, 'onLine'> & {
  onLine?: boolean;
};

type AuthStateLike = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  token?: string;
};

type JsonResponseOptions = {
  ok?: boolean;
  status?: number;
  payload?: Record<string, unknown>;
};

type NotificationPreferenceResponse = {
  userId: string;
  emailMode: 'realtime' | 'digest';
  emailDigestIntervalMinutes: number;
  muteAllUntil: string | null;
};

const defaultNotificationPreference: NotificationPreferenceResponse = {
  userId: 'user-1',
  emailMode: 'digest',
  emailDigestIntervalMinutes: 10,
  muteAllUntil: null,
};

const defaultMeResponse = {
  user: {
    userId: 'user-1',
    roles: ['member'],
    ownerProjects: ['pj-1'],
  },
};

const defaultAuthSession = {
  sessionId: 'sess-current',
  providerType: 'google',
  issuer: 'accounts.google.com',
  userAccountId: 'ua-1',
  userIdentityId: 'ui-1',
  sourceIp: '127.0.0.1',
  userAgent: 'Firefox',
  createdAt: '2026-03-28T00:00:00.000Z',
  lastSeenAt: '2026-03-28T01:00:00.000Z',
  expiresAt: '2026-03-29T00:00:00.000Z',
  idleExpiresAt: '2026-03-28T12:00:00.000Z',
  revokedAt: null,
  revokedReason: null,
  current: true,
};

const navigatorPrototype = Object.getPrototypeOf(window.navigator) as Navigator;
const originalNavigatorOnLineDescriptor = Object.getOwnPropertyDescriptor(
  navigatorPrototype,
  'onLine',
);

function makeJsonResponse(options?: JsonResponseOptions) {
  return {
    ok: options?.ok ?? true,
    status: options?.status ?? 200,
    json: async () => options?.payload ?? {},
  } as Response;
}

function installApiMock(options?: {
  bffSessionUser?: typeof defaultMeResponse.user;
  meUser?: typeof defaultMeResponse.user;
  notificationPreference?: NotificationPreferenceResponse;
  authSessions?: (typeof defaultAuthSession)[];
  authSessionsThrowCount?: number;
  patchNotificationError?: Error;
  patchNotificationResponse?: NotificationPreferenceResponse;
}) {
  let authSessionsFailures = options?.authSessionsThrowCount ?? 0;
  vi.mocked(api).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === '/me') {
        return {
          user: options?.meUser ?? defaultMeResponse.user,
        } as never;
      }
      if (path === '/auth/session') {
        return {
          user: options?.bffSessionUser ?? defaultMeResponse.user,
        } as never;
      }
      if (path === '/notification-preferences' && init?.method === 'PATCH') {
        if (options?.patchNotificationError) {
          throw options.patchNotificationError;
        }
        return (options?.patchNotificationResponse ??
          options?.notificationPreference ??
          defaultNotificationPreference) as never;
      }
      if (path === '/notification-preferences') {
        return (options?.notificationPreference ??
          defaultNotificationPreference) as never;
      }
      if (path === '/auth/sessions?limit=20&offset=0') {
        if (authSessionsFailures > 0) {
          authSessionsFailures -= 1;
          throw new Error('auth_sessions_failed');
        }
        return {
          limit: 20,
          offset: 0,
          items: options?.authSessions ?? [],
        } as never;
      }
      throw new Error(`Unhandled api path: ${path}`);
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(buildApiUrl).mockImplementation((path: string) => path);
  vi.mocked(getAuthState).mockReturnValue(null);
  vi.mocked(isBffAuthMode).mockReturnValue(false);
  vi.mocked(refreshAuthStateFromServer).mockResolvedValue(null);
  vi.mocked(setAuthState).mockImplementation(() => undefined);
  vi.mocked(listOfflineItems).mockResolvedValue([]);
  vi.mocked(processOfflineQueue).mockResolvedValue({ processed: 0 });
  vi.mocked(removeOfflineItem).mockResolvedValue(undefined);
  installApiMock();
  window.history.pushState({}, '', '/current-user?tab=profile#summary');
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  if (originalNavigatorOnLineDescriptor) {
    Object.defineProperty(
      window.navigator,
      'onLine',
      originalNavigatorOnLineDescriptor,
    );
  } else {
    delete (window.navigator as NavigatorWithOptionalOnLine).onLine;
  }
});

describe('CurrentUser', () => {
  it('sanitizes simple login input and dispatches an auth update', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    installApiMock({
      meUser: {
        userId: 'trimmed-user',
        roles: ['admin', 'reviewer'],
        ownerProjects: ['pj-1'],
      },
    });

    render(<CurrentUser />);

    fireEvent.change(screen.getByPlaceholderText('userId'), {
      target: { value: '  trimmed-user  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('roles (admin,mgmt)'), {
      target: { value: ' admin, , reviewer ' },
    });
    fireEvent.change(screen.getByPlaceholderText('projectIds (optional)'), {
      target: { value: ' pj-1 , pj-2 ' },
    });
    fireEvent.change(screen.getByPlaceholderText('groupIds (optional)'), {
      target: { value: ' grp-1 , ' },
    });

    fireEvent.click(screen.getByRole('button', { name: '簡易ログイン' }));

    expect(vi.mocked(setAuthState)).toHaveBeenCalledWith({
      userId: 'trimmed-user',
      roles: ['admin', 'reviewer'],
      projectIds: ['pj-1', 'pj-2'],
      groupIds: ['grp-1'],
    });
    expect(await screen.findByText('ID: trimmed-user')).toBeInTheDocument();
    expect(
      dispatchEventSpy.mock.calls.some(
        ([event]) =>
          event instanceof Event && event.type === 'erp4:auth-updated',
      ),
    ).toBe(true);

    dispatchEventSpy.mockRestore();
  });

  it('reloads auth sessions after an initial fetch failure', async () => {
    const authState: AuthStateLike = {
      userId: 'bff-user',
      roles: ['member'],
    };
    vi.mocked(isBffAuthMode).mockReturnValue(true);
    vi.mocked(getAuthState).mockReturnValue(authState);
    vi.mocked(refreshAuthStateFromServer).mockResolvedValue(authState);
    installApiMock({
      bffSessionUser: {
        userId: 'bff-user',
        roles: ['member'],
        ownerProjects: ['pj-1'],
      },
      authSessionsThrowCount: 1,
      authSessions: [
        {
          ...defaultAuthSession,
          sessionId: 'sess-other',
          current: false,
        },
      ],
    });

    render(<CurrentUser />);

    expect(
      await screen.findByText('認証セッションの取得に失敗しました'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'セッション一覧を再読込' }),
    );

    expect(
      await screen.findByText('Session ID: sess-other'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('認証セッションの取得に失敗しました'),
    ).not.toBeInTheDocument();
  });

  it('clears client auth state when the current auth session is revoked', async () => {
    const authState: AuthStateLike = {
      userId: 'bff-user',
      roles: ['member'],
    };
    vi.mocked(isBffAuthMode).mockReturnValue(true);
    vi.mocked(getAuthState).mockReturnValue(authState);
    vi.mocked(refreshAuthStateFromServer).mockResolvedValue(authState);
    installApiMock({
      bffSessionUser: {
        userId: 'bff-user',
        roles: ['member'],
        ownerProjects: ['pj-1'],
      },
      authSessions: [defaultAuthSession],
    });
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/auth/sessions/sess-current/revoke') {
        return makeJsonResponse({ payload: defaultAuthSession });
      }
      throw new Error(`Unhandled apiResponse path: ${path}`);
    });

    render(<CurrentUser />);

    const sessionCard = await screen.findByText('Session ID: sess-current');
    fireEvent.click(
      within(sessionCard.closest('.card') as HTMLElement).getByRole('button', {
        name: 'このセッションを終了',
      }),
    );

    await waitFor(() => {
      expect(vi.mocked(setAuthState)).toHaveBeenCalledWith(null);
    });
    expect(
      screen.getByRole('button', { name: 'Googleでログイン' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        '現在の認証セッションを終了しました。再度ログインしてください',
      ),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['auth_session_not_found', '対象の認証セッションが見つかりません'],
    [
      'auth_guard_rate_limited',
      '認証セッション操作の試行回数が上限に達しました',
    ],
  ])(
    'shows auth session revoke errors for %s',
    async (errorCode, expectedMessage) => {
      const authState: AuthStateLike = {
        userId: 'bff-user',
        roles: ['member'],
      };
      vi.mocked(isBffAuthMode).mockReturnValue(true);
      vi.mocked(getAuthState).mockReturnValue(authState);
      vi.mocked(refreshAuthStateFromServer).mockResolvedValue(authState);
      installApiMock({
        bffSessionUser: {
          userId: 'bff-user',
          roles: ['member'],
          ownerProjects: ['pj-1'],
        },
        authSessions: [
          defaultAuthSession,
          {
            ...defaultAuthSession,
            sessionId: 'sess-other',
            current: false,
          },
        ],
      });
      vi.mocked(apiResponse).mockImplementation(async (path: string) => {
        if (path === '/auth/sessions/sess-other/revoke') {
          return makeJsonResponse({
            ok: false,
            status: errorCode === 'auth_session_not_found' ? 404 : 429,
            payload: {
              error: {
                code: errorCode,
              },
            },
          });
        }
        throw new Error(`Unhandled apiResponse path: ${path}`);
      });

      render(<CurrentUser />);

      const sessionCard = await screen.findByText('Session ID: sess-other');
      fireEvent.click(
        within(sessionCard.closest('.card') as HTMLElement).getByRole(
          'button',
          {
            name: 'このセッションを失効',
          },
        ),
      );

      expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
      expect(
        screen.queryByText('認証セッションを失効しました'),
      ).not.toBeInTheDocument();
    },
  );

  it('shows an MFA setup guidance message when local login requires setup', async () => {
    vi.mocked(isBffAuthMode).mockReturnValue(true);
    vi.mocked(getAuthState).mockReturnValue(null);
    installApiMock();
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/auth/local/login') {
        return makeJsonResponse({
          ok: false,
          status: 409,
          payload: {
            error: {
              code: 'local_mfa_setup_required',
            },
          },
        });
      }
      throw new Error(`Unhandled apiResponse path: ${path}`);
    });

    render(<CurrentUser />);

    fireEvent.change(screen.getByLabelText('ローカル認証 loginId'), {
      target: { value: 'local-user' },
    });
    fireEvent.change(screen.getByLabelText('ローカル認証 password'), {
      target: { value: 'old-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ローカルログイン' }));

    expect(
      await screen.findByText(
        'MFA 設定が必要です。system_admin に依頼してください',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '初期パスワードを更新' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      'local_mfa_challenge_required',
      'MFA challenge は未実装です。system_admin に依頼してください',
    ],
    ['local_login_rate_limited', 'ローカル認証の試行回数が上限に達しました'],
  ])(
    'shows local login guidance for %s',
    async (errorCode, expectedMessage) => {
      vi.mocked(isBffAuthMode).mockReturnValue(true);
      vi.mocked(getAuthState).mockReturnValue(null);
      installApiMock();
      vi.mocked(apiResponse).mockImplementation(async (path: string) => {
        if (path === '/auth/local/login') {
          return makeJsonResponse({
            ok: false,
            status: errorCode === 'local_login_rate_limited' ? 429 : 409,
            payload: {
              error: {
                code: errorCode,
              },
            },
          });
        }
        throw new Error(`Unhandled apiResponse path: ${path}`);
      });

      render(<CurrentUser />);

      fireEvent.change(screen.getByLabelText('ローカル認証 loginId'), {
        target: { value: 'local-user' },
      });
      fireEvent.change(screen.getByLabelText('ローカル認証 password'), {
        target: { value: 'old-password' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'ローカルログイン' }));

      expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '初期パスワードを更新' }),
      ).not.toBeInTheDocument();
    },
  );

  it('prompts for password rotation when local login requires it', async () => {
    vi.mocked(isBffAuthMode).mockReturnValue(true);
    vi.mocked(getAuthState).mockReturnValue(null);
    installApiMock();
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/auth/local/login') {
        return makeJsonResponse({
          ok: false,
          status: 409,
          payload: {
            error: {
              code: 'local_password_rotation_required',
            },
          },
        });
      }
      throw new Error(`Unhandled apiResponse path: ${path}`);
    });

    render(<CurrentUser />);

    fireEvent.change(screen.getByLabelText('ローカル認証 loginId'), {
      target: { value: 'local-user' },
    });
    fireEvent.change(screen.getByLabelText('ローカル認証 password'), {
      target: { value: 'old-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ローカルログイン' }));

    expect(
      await screen.findByText('初期パスワードの更新が必要です'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '初期パスワードを更新' }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('ローカル認証 new password'),
    ).toBeInTheDocument();
  });

  it('clears client auth state when logout succeeds in bff mode', async () => {
    const authState: AuthStateLike = {
      userId: 'bff-user',
      roles: ['member'],
    };
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    try {
      vi.mocked(isBffAuthMode).mockReturnValue(true);
      vi.mocked(getAuthState).mockReturnValue(authState);
      vi.mocked(refreshAuthStateFromServer).mockResolvedValue(authState);
      installApiMock({
        bffSessionUser: {
          userId: 'bff-user',
          roles: ['member'],
          ownerProjects: ['pj-1'],
        },
        authSessions: [defaultAuthSession],
      });
      vi.mocked(apiResponse).mockImplementation(async (path: string) => {
        if (path === '/auth/logout') {
          return makeJsonResponse();
        }
        throw new Error(`Unhandled apiResponse path: ${path}`);
      });

      render(<CurrentUser />);

      fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));

      await waitFor(() => {
        expect(vi.mocked(setAuthState)).toHaveBeenCalledWith(null);
      });
      expect(
        screen.getByRole('button', { name: 'Googleでログイン' }),
      ).toBeInTheDocument();
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'erp4:auth-updated' }),
      );
      expect(screen.queryByText('ログアウトに失敗')).not.toBeInTheDocument();
    } finally {
      dispatchEventSpy.mockRestore();
    }
  });

  it('shows a failure message when logout fails', async () => {
    const authState: AuthStateLike = {
      userId: 'bff-user',
      roles: ['member'],
    };
    vi.mocked(isBffAuthMode).mockReturnValue(true);
    vi.mocked(getAuthState).mockReturnValue(authState);
    vi.mocked(refreshAuthStateFromServer).mockResolvedValue(authState);
    installApiMock({
      bffSessionUser: {
        userId: 'bff-user',
        roles: ['member'],
        ownerProjects: ['pj-1'],
      },
      authSessions: [defaultAuthSession],
    });
    vi.mocked(apiResponse).mockImplementation(async (path: string) => {
      if (path === '/auth/logout') {
        return makeJsonResponse({ ok: false, status: 500 });
      }
      throw new Error(`Unhandled apiResponse path: ${path}`);
    });

    render(<CurrentUser />);

    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));

    expect(await screen.findByText('ログアウトに失敗')).toBeInTheDocument();
    expect(vi.mocked(setAuthState)).not.toHaveBeenCalledWith(null);
  });

  it('validates notification preference input and keeps the edited value on save failure', async () => {
    const authState: AuthStateLike = {
      userId: 'user-1',
      roles: ['member'],
      token: 'token-1',
    };
    vi.mocked(getAuthState).mockReturnValue(authState);
    installApiMock({
      patchNotificationError: new Error('patch_failed'),
    });

    render(<CurrentUser />);

    const intervalInput = (await screen.findByLabelText(
      '集約間隔（分）',
    )) as HTMLInputElement;
    fireEvent.change(intervalInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(
      await screen.findByText('メール集約間隔は1〜1440分で入力してください'),
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path, init]) =>
            path === '/notification-preferences' && init?.method === 'PATCH',
        ),
    ).toBe(false);

    fireEvent.change(intervalInput, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(
      await screen.findByText('通知設定の保存に失敗しました'),
    ).toBeInTheDocument();
    expect(intervalInput.value).toBe('15');
  });

  it('retries and discards individual offline queue items', async () => {
    const authState: AuthStateLike = {
      userId: 'user-1',
      roles: ['member'],
      token: 'token-1',
    };
    const queueState = [
      {
        id: 'queue-1',
        kind: 'expense',
        label: '交通費申請',
        requests: [
          { path: '/expenses', method: 'POST', body: { amount: 1200 } },
        ],
        cursor: 0,
        status: 'failed' as const,
        retryCount: 2,
        lastError: 'network error',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:05:00.000Z',
        order: 1,
      },
    ];
    vi.mocked(getAuthState).mockReturnValue(authState);
    installApiMock();
    vi.mocked(listOfflineItems).mockImplementation(async () => [...queueState]);
    vi.mocked(processOfflineQueue).mockImplementation(async (options) => {
      if (options?.targetId === 'queue-1') {
        return { processed: 0, stoppedBy: 'failed' };
      }
      return { processed: 0 };
    });
    vi.mocked(removeOfflineItem).mockImplementation(async (id: string) => {
      const index = queueState.findIndex((item) => item.id === id);
      if (index >= 0) {
        queueState.splice(index, 1);
      }
    });

    render(<CurrentUser />);

    expect(await screen.findByText('交通費申請')).toBeInTheDocument();

    const queueItemCard = screen.getByText('交通費申請').closest('.card');
    expect(queueItemCard).not.toBeNull();
    fireEvent.click(
      within(queueItemCard as HTMLElement).getByRole('button', {
        name: '再送',
      }),
    );

    expect(
      await screen.findByText('送信に失敗した項目があります'),
    ).toBeInTheDocument();
    expect(vi.mocked(processOfflineQueue)).toHaveBeenCalledWith({
      includeFailed: true,
      targetId: 'queue-1',
    });

    fireEvent.click(screen.getByRole('button', { name: '破棄' }));

    await waitFor(() => {
      expect(screen.getByText('送信待ちはありません')).toBeInTheDocument();
    });
    expect(vi.mocked(removeOfflineItem)).toHaveBeenCalledWith('queue-1');
  });

  it('shows an offline hold message when bulk retry stops by offline', async () => {
    const authState: AuthStateLike = {
      userId: 'user-1',
      roles: ['member'],
      token: 'token-1',
    };
    vi.mocked(getAuthState).mockReturnValue(authState);
    installApiMock();
    vi.mocked(listOfflineItems).mockResolvedValue([
      {
        id: 'queue-1',
        kind: 'expense',
        label: '交通費申請',
        requests: [
          { path: '/expenses', method: 'POST', body: { amount: 1200 } },
        ],
        cursor: 0,
        status: 'failed',
        retryCount: 1,
        lastError: 'network error',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:05:00.000Z',
        order: 1,
      },
    ]);
    vi.mocked(processOfflineQueue).mockResolvedValue({
      processed: 0,
      stoppedBy: 'offline',
    });

    render(<CurrentUser />);

    expect(await screen.findByText('交通費申請')).toBeInTheDocument();

    const queueSection = screen.getByText('オフライン送信キュー').parentElement;
    expect(queueSection).not.toBeNull();
    const bulkRetryRow = within(queueSection as HTMLElement)
      .getByRole('button', { name: '再読込' })
      .closest('.row');
    expect(bulkRetryRow).not.toBeNull();
    fireEvent.click(
      within(bulkRetryRow as HTMLElement).getByRole('button', { name: '再送' }),
    );

    expect(
      await screen.findByText('オフラインのため送信を保留しました'),
    ).toBeInTheDocument();
    expect(vi.mocked(processOfflineQueue)).toHaveBeenCalledWith({
      includeFailed: true,
    });
  });
});
