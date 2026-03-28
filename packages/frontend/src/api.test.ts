import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_STORAGE_KEY = 'erp4_auth';

type AuthStateSeed = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
  token?: string;
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    status: init.status ?? 200,
  });
}

function seedAuthState(state: AuthStateSeed | null) {
  if (!state) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

async function loadApi(env?: { apiBase?: string; authMode?: string }) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_API_BASE', env?.apiBase ?? '');
  vi.stubEnv('VITE_AUTH_MODE', env?.authMode ?? 'header');
  return import('./api');
}

describe('api helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns null when auth JSON is invalid', async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, '{invalid-json');

    const { getAuthState } = await loadApi();

    expect(getAuthState()).toBeNull();
  });

  it('merges header-mode auth headers and JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    seedAuthState({
      userId: 'u-001',
      roles: ['admin', 'approver'],
      projectIds: ['p-001', 'p-002'],
      groupIds: ['g-001'],
      groupAccountIds: ['ga-001', 'ga-002'],
      token: 'header-token',
    });

    const { apiResponse } = await loadApi({ authMode: 'header' });

    await apiResponse('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'alpha' }),
      headers: { 'x-request-id': 'req-001' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'alpha' }),
      credentials: undefined,
      headers: {
        'x-user-id': 'u-001',
        'x-roles': 'admin,approver',
        'x-project-ids': 'p-001,p-002',
        'x-group-ids': 'g-001',
        'x-group-account-ids': 'ga-001,ga-002',
        Authorization: 'Bearer header-token',
        'Content-Type': 'application/json',
        'x-request-id': 'req-001',
      },
    });
  });

  it('attaches csrf with API base path prefix and retries after invalid csrf in bff mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-1' }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'invalid_csrf_token' } },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    seedAuthState({
      userId: 'u-010',
      roles: ['user'],
      token: 'ignored-in-bff',
    });

    const { apiResponse } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    const response = await apiResponse('/auth/logout', { method: 'POST' });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/erp4/auth/csrf',
      {
        method: 'GET',
        credentials: 'include',
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/erp4/auth/logout',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': 'csrf-1',
        },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.example.test/erp4/auth/csrf',
      {
        method: 'GET',
        credentials: 'include',
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://api.example.test/erp4/auth/logout',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': 'csrf-2',
        },
      },
    );
  });

  it('refreshes auth state through /me in header mode and preserves bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        user: {
          userId: 'u-002',
          roles: ['user'],
          projectIds: ['p-100'],
          groupIds: ['g-100'],
          groupAccountIds: ['ga-100'],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    seedAuthState({
      userId: 'u-001',
      roles: ['admin'],
      projectIds: ['p-001'],
      token: 'header-token',
    });

    const { refreshAuthStateFromServer } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'header',
    });

    const next = await refreshAuthStateFromServer();

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/erp4/me', {
      credentials: undefined,
      headers: {
        'x-user-id': 'u-001',
        'x-roles': 'admin',
        'x-project-ids': 'p-001',
        Authorization: 'Bearer header-token',
      },
    });
    expect(next).toEqual({
      userId: 'u-002',
      roles: ['user'],
      projectIds: ['p-100'],
      groupIds: ['g-100'],
      groupAccountIds: ['ga-100'],
      token: 'header-token',
    });
    expect(
      JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? '{}'),
    ).toEqual(next);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]?.[0]?.type).toBe('erp4:auth-updated');
  });

  it('refreshes auth state through /auth/session in bff mode and clears state on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            userId: 'u-003',
            roles: ['user', 'reporter'],
            projectIds: ['p-300'],
          },
          session: {
            sessionId: 'sess-1',
            providerType: 'google',
            issuer: 'issuer',
            userAccountId: 'ua-1',
            userIdentityId: 'ui-1',
            expiresAt: '2026-03-29T00:00:00.000Z',
            idleExpiresAt: '2026-03-29T00:00:00.000Z',
          },
        }),
      )
      .mockRejectedValueOnce(new Error('network_failed'));
    vi.stubGlobal('fetch', fetchMock);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    seedAuthState({
      userId: 'u-001',
      roles: ['user'],
      token: 'should-be-dropped',
    });

    const { refreshAuthStateFromServer } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    const first = await refreshAuthStateFromServer();
    const second = await refreshAuthStateFromServer();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/erp4/auth/session',
      {
        credentials: 'include',
        headers: {},
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/erp4/auth/session',
      {
        credentials: 'include',
        headers: {},
      },
    );
    expect(first).toEqual({
      userId: 'u-003',
      roles: ['user', 'reporter'],
      projectIds: ['p-300'],
      groupIds: undefined,
      groupAccountIds: undefined,
      token: undefined,
    });
    expect(second).toBeNull();
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy.mock.calls[0]?.[0]?.type).toBe('erp4:auth-updated');
    expect(dispatchSpy.mock.calls[1]?.[0]?.type).toBe('erp4:auth-updated');
  });
});
