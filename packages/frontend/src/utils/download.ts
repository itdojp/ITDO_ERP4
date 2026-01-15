const URL_REVOKE_DELAY_MS = 1000;

export function formatDateForFilename(date: Date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function resolveFilename(
  disposition: string | null | undefined,
  fallback: string,
) {
  if (!disposition) return fallback;
  const match = disposition.match(
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i,
  );
  if (!match) return fallback;
  const encoded = match[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const quoted = match[2];
  if (quoted) return quoted;
  const raw = match[3];
  return raw ? raw.trim() : fallback;
}

export async function downloadResponseAsFile(
  res: Response,
  fallbackName: string,
) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const filename = resolveFilename(
    res.headers.get('content-disposition'),
    fallbackName,
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}

export async function openResponseInNewTab(
  res: Response,
  fallbackName: string,
) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const filename = resolveFilename(
      res.headers.get('content-disposition'),
      fallbackName,
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}
