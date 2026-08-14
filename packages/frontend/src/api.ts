export type AuthState = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
  token?: string;
  /** Server-verified and auth-mode namespaced; never persisted locally. */
  verifiedActorKey?: string;
};

type SessionResponse = {
  user?: Partial<AuthState> & { userId?: string };
  session?: {
    sessionId: string;
    providerType: string;
    issuer: string;
    userAccountId: string;
    userIdentityId: string;
    expiresAt: string;
    idleExpiresAt: string;
  };
};

export const AUTH_STORAGE_KEY = 'erp4_auth';
export const AUTH_SESSION_CHANGE_CHANNEL = 'erp4-auth-session-change-v1';
const API_BASE = (import.meta.env.VITE_API_BASE || '').trim();
const AUTH_MODE = (import.meta.env.VITE_AUTH_MODE || 'header')
  .trim()
  .toLowerCase();
const API_BASE_VALID = API_BASE === '' || /^https?:\/\//i.test(API_BASE);
let warnedInvalidBase = false;
let authCsrfTokenCache: string | null = null;
const authSessionChangeListeners = new Set<() => void>();
let authSessionChangeChannel: BroadcastChannel | null = null;

function normalizeAuthSessionChange(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && record.event === 'session_changed';
}

function getAuthSessionChangeChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (authSessionChangeChannel) return authSessionChangeChannel;
  const channel = new BroadcastChannel(AUTH_SESSION_CHANGE_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (!normalizeAuthSessionChange(event.data)) return;
    for (const listener of authSessionChangeListeners) listener();
  };
  authSessionChangeChannel = channel;
  return channel;
}

function closeUnusedAuthSessionChangeChannel() {
  if (authSessionChangeListeners.size !== 0 || !authSessionChangeChannel)
    return;
  authSessionChangeChannel.close();
  authSessionChangeChannel = null;
}

function publishAuthSessionChange() {
  const channel = getAuthSessionChangeChannel();
  if (!channel) return;
  // The message intentionally contains neither actor identity nor auth data.
  // BroadcastChannel does not deliver to its sending object; the existing
  // window event remains the same-tab notification path.
  channel.postMessage({ schemaVersion: 1, event: 'session_changed' });
  closeUnusedAuthSessionChangeChannel();
}

export function subscribeAuthSessionChanges(listener: () => void) {
  if (!getAuthSessionChangeChannel()) return () => undefined;
  authSessionChangeListeners.add(listener);
  return () => {
    authSessionChangeListeners.delete(listener);
    closeUnusedAuthSessionChangeChannel();
  };
}

export function isBffAuthMode() {
  return AUTH_MODE === 'jwt_bff';
}

export function getAuthState(): AuthState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch (err) {
    return null;
  }
}

export function setAuthState(state: AuthState | null) {
  if (typeof window === 'undefined') return;
  if (!state) {
    authCsrfTokenCache = null;
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    publishAuthSessionChange();
    return;
  }
  const persistedState = { ...state };
  delete persistedState.verifiedActorKey;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(persistedState));
  publishAuthSessionChange();
}

function buildAuthHeaders(): Record<string, string> {
  const auth = getAuthState();
  if (!auth) return {};
  if (isBffAuthMode()) return {};
  const headers: Record<string, string> = {};
  if (auth.userId) headers['x-user-id'] = auth.userId;
  if (auth.roles?.length) headers['x-roles'] = auth.roles.join(',');
  if (auth.projectIds?.length)
    headers['x-project-ids'] = auth.projectIds.join(',');
  if (auth.groupIds?.length) headers['x-group-ids'] = auth.groupIds.join(',');
  if (auth.groupAccountIds?.length)
    headers['x-group-account-ids'] = auth.groupAccountIds.join(',');
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  return headers;
}

function mergeHeaders(
  extra?: HeadersInit,
  options?: { json?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    ...buildAuthHeaders(),
  };
  if (options?.json) {
    headers['Content-Type'] = 'application/json';
  }
  if (!extra) return headers;
  if (extra instanceof Headers) {
    extra.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  if (Array.isArray(extra)) {
    extra.forEach(([key, value]) => {
      headers[key] = value;
    });
    return headers;
  }
  return { ...headers, ...(extra as Record<string, string>) };
}

function resolveApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE) return path;
  if (!API_BASE_VALID) {
    if (!warnedInvalidBase) {
      console.warn('[api] VITE_API_BASE should include http:// or https://');
      warnedInvalidBase = true;
    }
    return path;
  }
  const base = API_BASE.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function shouldIncludeCredentials(url: string) {
  if (!isBffAuthMode()) return false;
  if (typeof window === 'undefined') return true;
  try {
    const requestOrigin = new URL(url, window.location.origin).origin;
    const apiOrigin =
      API_BASE_VALID && API_BASE
        ? new URL(API_BASE).origin
        : window.location.origin;
    return (
      requestOrigin === window.location.origin || requestOrigin === apiOrigin
    );
  } catch {
    return false;
  }
}

function isMutatingMethod(method: string | undefined) {
  const normalized = (method || 'GET').trim().toUpperCase();
  return !['GET', 'HEAD', 'OPTIONS'].includes(normalized);
}

function shouldAttachAuthCsrf(url: string, options: RequestInit) {
  return (
    isBffAuthMode() &&
    isMutatingMethod(options.method) &&
    shouldIncludeCredentials(url) &&
    !url.endsWith('/auth/csrf')
  );
}

async function readInvalidCsrfResponse(res: Response) {
  try {
    const body = (await res.clone().json()) as {
      error?: { code?: string };
    };
    return body?.error?.code === 'invalid_csrf_token';
  } catch {
    return false;
  }
}

async function fetchAuthCsrfToken() {
  const csrfUrl = resolveApiPath('/auth/csrf');
  const res = await fetch(csrfUrl, {
    method: 'GET',
    credentials: shouldIncludeCredentials(csrfUrl) ? 'include' : 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${csrfUrl} (${res.status})`);
  }
  const body = (await res.json()) as { csrfToken?: string };
  const csrfToken =
    typeof body?.csrfToken === 'string' ? body.csrfToken.trim() : '';
  if (!csrfToken) {
    throw new Error(`Request failed: ${csrfUrl} (missing csrfToken)`);
  }
  authCsrfTokenCache = csrfToken;
  return csrfToken;
}

async function handleResponse<T>(res: Response, path: string): Promise<T> {
  if (res.ok) {
    try {
      return (await res.json()) as T;
    } catch (e) {
      return {} as T;
    }
  }
  const body = await res.text().catch(() => '');
  throw new Error(`Request failed: ${path} (${res.status}) ${body}`);
}

function shouldSetJsonHeader(body: RequestInit['body']) {
  if (body === undefined || body === null) return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  return typeof body === 'string';
}

export async function apiResponse(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = resolveApiPath(path);
  const withCredentials = shouldIncludeCredentials(url)
    ? 'include'
    : options.credentials;
  const baseHeaders = mergeHeaders(options.headers, {
    json: shouldSetJsonHeader(options.body),
  });
  const useCsrf = shouldAttachAuthCsrf(url, options);
  const requestHeaders = { ...baseHeaders };
  if (useCsrf) {
    requestHeaders['x-csrf-token'] =
      authCsrfTokenCache || (await fetchAuthCsrfToken());
  }
  let res = await fetch(url, {
    ...options,
    credentials: withCredentials,
    headers: requestHeaders,
  });
  if (useCsrf && res.status === 403 && (await readInvalidCsrfResponse(res))) {
    authCsrfTokenCache = null;
    const retryHeaders = {
      ...baseHeaders,
      'x-csrf-token': await fetchAuthCsrfToken(),
    };
    res = await fetch(url, {
      ...options,
      credentials: withCredentials,
      headers: retryHeaders,
    });
  }
  return res;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = resolveApiPath(path);
  const res = await apiResponse(url, options);
  return handleResponse<T>(res, url);
}

export async function apiWithAuth<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = mergeHeaders(options.headers);
  if (token) headers.Authorization = `Bearer ${token}`;
  return api<T>(path, {
    ...options,
    headers,
  });
}

export async function refreshAuthStateFromServer(options?: {
  dispatchEvent?: boolean;
  allowCachedFallback?: boolean;
  persistState?: boolean;
  signal?: AbortSignal;
}) {
  const dispatchEvent = options?.dispatchEvent !== false;
  const allowCachedFallback = options?.allowCachedFallback !== false;
  const persistState = options?.persistState !== false;
  const current = getAuthState();
  try {
    const res: SessionResponse = isBffAuthMode()
      ? await api<SessionResponse>('/auth/session', {
          ...(options?.signal ? { signal: options.signal } : {}),
        })
      : await api<{ user?: Partial<AuthState> & { userId?: string } }>('/me', {
          ...(options?.signal ? { signal: options.signal } : {}),
        });
    const user = res.user;
    const userId = typeof user?.userId === 'string' ? user.userId.trim() : '';
    const bffActorId =
      typeof res.session?.userAccountId === 'string'
        ? res.session.userAccountId.trim()
        : '';
    if (!user || !userId || (isBffAuthMode() && !bffActorId)) {
      if (isBffAuthMode()) {
        if (persistState) setAuthState(null);
        if (persistState && dispatchEvent && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('erp4:auth-updated'));
        }
        return null;
      }
      return allowCachedFallback ? current : null;
    }
    const next: AuthState = {
      userId,
      roles: Array.isArray(user.roles) ? user.roles : [],
      projectIds:
        Array.isArray(user.projectIds) && user.projectIds.length
          ? user.projectIds
          : undefined,
      groupIds:
        Array.isArray(user.groupIds) && user.groupIds.length
          ? user.groupIds
          : undefined,
      groupAccountIds:
        Array.isArray(user.groupAccountIds) && user.groupAccountIds.length
          ? user.groupAccountIds
          : undefined,
      token: isBffAuthMode() ? undefined : current?.token,
    };
    if (persistState) setAuthState(next);
    if (persistState && dispatchEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('erp4:auth-updated'));
    }
    return {
      ...next,
      verifiedActorKey: `${isBffAuthMode() ? 'bff' : 'header'}:${
        isBffAuthMode() ? bffActorId : userId
      }`,
    };
  } catch (err) {
    if (isBffAuthMode()) {
      if (persistState) setAuthState(null);
      if (persistState && dispatchEvent && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('erp4:auth-updated'));
      }
      return null;
    }
    return allowCachedFallback ? current : null;
  }
}

/** Revalidates the canonical server actor without persisting auth data. */
export async function revalidateCurrentAuthActor(
  expectedActorKey: string,
  signal?: AbortSignal,
) {
  if (
    expectedActorKey.length < 1 ||
    expectedActorKey.length > 256 ||
    Array.from(expectedActorKey).some((character) => {
      const code = character.codePointAt(0) ?? -1;
      return code <= 31 || (code >= 127 && code <= 159);
    })
  ) {
    return false;
  }
  const current = getAuthState();
  if (!isBffAuthMode() && !current?.userId) return false;
  const verified = await refreshAuthStateFromServer({
    dispatchEvent: false,
    allowCachedFallback: false,
    persistState: false,
    ...(signal ? { signal } : {}),
  });
  return verified?.verifiedActorKey === expectedActorKey;
}

export function buildApiUrl(path: string) {
  return resolveApiPath(path);
}
