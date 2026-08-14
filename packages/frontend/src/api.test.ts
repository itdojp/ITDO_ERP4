import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_STORAGE_KEY = 'erp4_auth';

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.add(this);
  }

  postMessage(value: unknown) {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel !== this && channel.name === this.name && !channel.closed) {
        channel.onmessage?.({ data: value } as MessageEvent<unknown>);
      }
    }
  }

  close() {
    this.closed = true;
  }
}

type AuthStateSeed = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
  token?: string;
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
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
    FakeBroadcastChannel.instances.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    FakeBroadcastChannel.instances.clear();
  });

  it('broadcasts an actor-free auth generation even when persisted auth JSON is unchanged', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const { AUTH_SESSION_CHANGE_CHANNEL, setAuthState } = await loadApi();
    const observer = new FakeBroadcastChannel(AUTH_SESSION_CHANGE_CHANNEL);
    const received: unknown[] = [];
    observer.onmessage = (event) => received.push(event.data);
    const state = {
      userId: 'legacy-shared-id',
      roles: ['user'],
      verifiedActorKey: 'bff:must-not-persist',
    };

    setAuthState(state);
    setAuthState(state);

    expect(received).toEqual([
      { schemaVersion: 1, event: 'session_changed' },
      { schemaVersion: 1, event: 'session_changed' },
    ]);
    expect(JSON.stringify(received)).not.toContain('legacy-shared-id');
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).not.toContain(
      'must-not-persist',
    );
  });

  it('accepts only validated cross-tab auth generation messages', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const { AUTH_SESSION_CHANGE_CHANNEL, subscribeAuthSessionChanges } =
      await loadApi();
    const listener = vi.fn();
    const unsubscribe = subscribeAuthSessionChanges(listener);
    const external = new FakeBroadcastChannel(AUTH_SESSION_CHANGE_CHANNEL);

    external.postMessage({ schemaVersion: 1, event: 'other' });
    external.postMessage({ schemaVersion: 1, event: 'session_changed' });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
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

  it('attaches csrf to first-party non-auth mutations in bff mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-knowledge' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiResponse } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    await apiResponse('/knowledge/captures/preview', {
      method: 'POST',
      body: JSON.stringify({ synthetic: true }),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/erp4/auth/csrf',
      { method: 'GET', credentials: 'include' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/erp4/knowledge/captures/preview',
      {
        method: 'POST',
        body: JSON.stringify({ synthetic: true }),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf-knowledge',
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
      verifiedActorKey: 'header:u-002',
    });
    expect(
      JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? '{}'),
    ).toEqual({
      userId: 'u-002',
      roles: ['user'],
      projectIds: ['p-100'],
      groupIds: ['g-100'],
      groupAccountIds: ['ga-100'],
      token: 'header-token',
    });
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
      verifiedActorKey: 'bff:ua-1',
    });
    expect(second).toBeNull();
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy.mock.calls[0]?.[0]?.type).toBe('erp4:auth-updated');
    expect(dispatchSpy.mock.calls[1]?.[0]?.type).toBe('erp4:auth-updated');
  });

  it('can verify the server session without recursively dispatching auth-updated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          user: { userId: 'u-verified', roles: ['user'] },
          session: { userAccountId: 'account-verified' },
        }),
      ),
    );
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    seedAuthState({ userId: 'u-cached', roles: ['user'] });
    const { refreshAuthStateFromServer } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    await expect(
      refreshAuthStateFromServer({ dispatchEvent: false }),
    ).resolves.toEqual(
      expect.objectContaining({ userId: 'u-verified', token: undefined }),
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('uses the canonical BFF account actor for non-persistent verification', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { userId: 'legacy-shared-id', roles: ['user'] },
          session: { userAccountId: 'canonical-account-a' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user: { userId: 'legacy-shared-id', roles: ['user'] },
          session: { userAccountId: 'canonical-account-b' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    seedAuthState({ userId: 'cached-user', roles: ['user'] });
    const { getAuthState, refreshAuthStateFromServer } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    const first = await refreshAuthStateFromServer({
      dispatchEvent: false,
      allowCachedFallback: false,
      persistState: false,
    });
    const second = await refreshAuthStateFromServer({
      dispatchEvent: false,
      allowCachedFallback: false,
      persistState: false,
    });

    expect(first?.verifiedActorKey).toBe('bff:canonical-account-a');
    expect(second?.verifiedActorKey).toBe('bff:canonical-account-b');
    expect(first?.verifiedActorKey).not.toBe(second?.verifiedActorKey);
    expect(getAuthState()).toEqual({
      userId: 'cached-user',
      roles: ['user'],
    });
  });

  it('revalidates the expected canonical actor without persisting a changed BFF session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { userId: 'legacy-shared-id', roles: ['user'] },
          session: { userAccountId: 'canonical-account-b' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user: { userId: 'legacy-shared-id', roles: ['user'] },
          session: { userAccountId: 'canonical-account-b' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    seedAuthState({ userId: 'legacy-shared-id', roles: ['user'] });
    const { getAuthState, revalidateCurrentAuthActor } = await loadApi({
      authMode: 'jwt_bff',
    });

    await expect(
      revalidateCurrentAuthActor('bff:canonical-account-a'),
    ).resolves.toBe(false);
    await expect(
      revalidateCurrentAuthActor('bff:canonical-account-b'),
    ).resolves.toBe(true);
    expect(getAuthState()).toEqual({
      userId: 'legacy-shared-id',
      roles: ['user'],
    });
  });

  it('falls back to relative paths and warns once when VITE_API_BASE is invalid', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const { buildApiUrl } = await loadApi({
      apiBase: 'api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    expect(buildApiUrl('/projects')).toBe('/projects');
    expect(buildApiUrl('/auth/session')).toBe('/auth/session');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[api] VITE_API_BASE should include http:// or https://',
    );
  });

  it('overrides the stored bearer token in apiWithAuth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    seedAuthState({
      userId: 'u-101',
      roles: ['manager'],
      projectIds: ['p-101'],
      token: 'stored-token',
    });

    const { apiWithAuth } = await loadApi({ authMode: 'header' });

    await apiWithAuth('/projects', 'override-token', {
      headers: { 'x-request-id': 'req-override' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/projects', {
      credentials: undefined,
      headers: {
        'x-user-id': 'u-101',
        'x-roles': 'manager',
        'x-project-ids': 'p-101',
        Authorization: 'Bearer override-token',
        'x-request-id': 'req-override',
      },
    });
  });

  it('keeps the current auth state in header mode when /me does not return a userId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        user: {
          roles: ['user'],
          projectIds: ['p-404'],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    seedAuthState({
      userId: 'u-keep',
      roles: ['admin'],
      projectIds: ['p-keep'],
      token: 'keep-token',
    });

    const { refreshAuthStateFromServer } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'header',
    });

    const next = await refreshAuthStateFromServer();

    expect(next).toEqual({
      userId: 'u-keep',
      roles: ['admin'],
      projectIds: ['p-keep'],
      token: 'keep-token',
    });
    expect(
      JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? '{}'),
    ).toEqual(next);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('fails closed without erasing the retry candidate when cached fallback is disabled', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    seedAuthState({
      userId: 'u-retry-after-online',
      roles: ['user'],
      token: 'test-only-token',
    });

    const { getAuthState, refreshAuthStateFromServer } = await loadApi({
      authMode: 'header',
    });

    await expect(
      refreshAuthStateFromServer({
        dispatchEvent: false,
        allowCachedFallback: false,
      }),
    ).resolves.toBeNull();
    expect(getAuthState()).toEqual({
      userId: 'u-retry-after-online',
      roles: ['user'],
      token: 'test-only-token',
    });
  });

  it('does not prefetch csrf or set a json content type for FormData on /auth/csrf', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ csrfToken: 'csrf-direct' }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.set('reason', 'manual-refresh');

    const { apiResponse } = await loadApi({
      apiBase: 'https://api.example.test/erp4',
      authMode: 'jwt_bff',
    });

    await apiResponse('/auth/csrf', {
      method: 'POST',
      body,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/erp4/auth/csrf',
      {
        method: 'POST',
        body,
        credentials: 'include',
        headers: {},
      },
    );
  });
});
