export type AuthState = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
  token?: string;
};

const AUTH_STORAGE_KEY = 'erp4_auth';
const API_BASE = (import.meta.env.VITE_API_BASE || '').trim();
const API_BASE_VALID = API_BASE === '' || /^https?:\/\//i.test(API_BASE);
let warnedInvalidBase = false;

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
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

function buildAuthHeaders(): Record<string, string> {
  const auth = getAuthState();
  if (!auth) return {};
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
  const res = await fetch(url, {
    ...options,
    headers: mergeHeaders(options.headers, {
      json: shouldSetJsonHeader(options.body),
    }),
  });
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

export async function refreshAuthStateFromServer() {
  const current = getAuthState();
  if (!current) return null;
  try {
    const res = await api<{ user?: Partial<AuthState> & { userId?: string } }>(
      '/me',
    );
    const user = res.user;
    if (!user || typeof user.userId !== 'string' || !user.userId.trim()) {
      return current;
    }
    const next: AuthState = {
      userId: user.userId,
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
      token: current.token,
    };
    setAuthState(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('erp4:auth-updated'));
    }
    return next;
  } catch (err) {
    return current;
  }
}
