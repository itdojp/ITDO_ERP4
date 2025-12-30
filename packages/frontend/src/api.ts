export type AuthState = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  token?: string;
};

const AUTH_STORAGE_KEY = 'erp4_auth';

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
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  return headers;
}

function mergeHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(),
  };
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

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: mergeHeaders(options.headers),
  });
  return handleResponse<T>(res, path);
}

export async function apiWithAuth<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return api<T>(path, {
    ...options,
    headers: { ...(options.headers || {}), ...headers },
  });
}
