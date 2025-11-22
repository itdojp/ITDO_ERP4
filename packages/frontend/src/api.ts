const defaultHeaders = {
  'Content-Type': 'application/json',
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
};

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

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {}),
    },
  });
  return handleResponse<T>(res, path);
}

export async function apiWithAuth<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return api<T>(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
}
