export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'demo-user',
      'x-roles': 'admin,mgmt',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Request failed: ${path} (${res.status}) ${body}`);
  }
  return res.json() as Promise<T>;
}
