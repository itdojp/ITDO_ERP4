export type DeepLinkOpenPayload = {
  kind: string;
  id: string;
};

export function buildOpenHash(payload: DeepLinkOpenPayload): string {
  const params = new URLSearchParams();
  params.set('kind', payload.kind);
  params.set('id', payload.id);
  return `#/open?${params.toString()}`;
}

export function navigateToOpen(payload: DeepLinkOpenPayload) {
  if (typeof window === 'undefined') return;
  window.location.hash = buildOpenHash(payload);
}

export function parseOpenHash(value: string): DeepLinkOpenPayload | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!normalized.startsWith('/open')) return null;
  const queryIndex = normalized.indexOf('?');
  const query = queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);
  const kind = params.get('kind')?.trim() || '';
  const id = params.get('id')?.trim() || '';
  if (!kind || !id) return null;
  return { kind, id };
}
