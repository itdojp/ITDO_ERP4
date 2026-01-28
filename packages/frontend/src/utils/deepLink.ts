export type DeepLinkOpenPayload = {
  // id は「種別ごとの識別子」をそのまま受け取る（UUID前提にしない）。
  // 厳密なバリデーションは遷移先の解決ロジック側で行う。
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
  if (!normalized.startsWith('/open?') && normalized !== '/open') return null;
  const queryIndex = normalized.indexOf('?');
  const queryWithFragment = queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '';
  const query = queryWithFragment.split('#', 1)[0];
  const params = new URLSearchParams(query);
  const kind = params.get('kind');
  if (!kind?.trim()) return null;
  const id = params.get('id');
  if (!id?.trim()) return null;
  const trimmedKind = kind.trim();
  const trimmedId = id.trim();
  return { kind: trimmedKind, id: trimmedId };
}
