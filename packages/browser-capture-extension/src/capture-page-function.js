export function captureCurrentPage() {
  const text = (value) => (typeof value === "string" ? value : null);
  const encoder = new TextEncoder();
  const withinBytes = (value, limit) =>
    value === null ||
    (value.length <= limit && encoder.encode(value).byteLength <= limit);
  const withinCodePoints = (value, limit) =>
    value === null ||
    (value.length <= limit * 2 && Array.from(value).length <= limit);
  const meta = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const content = node?.getAttribute("content");
      if (typeof content === "string" && content.trim()) return content;
    }
    return null;
  };
  const canonicalNode = document.querySelector('link[rel~="canonical"]');
  const canonical = canonicalNode?.getAttribute("href");
  let url = text(window.location.href);
  if (
    typeof canonical === "string" &&
    canonical.length <= 4_096 &&
    canonical.trim()
  ) {
    try {
      const parsed = new URL(canonical, window.location.href);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        !parsed.username &&
        !parsed.password
      ) {
        url = parsed.href;
      }
    } catch {
      // An invalid or active canonical URL is ignored in favor of location.
    }
  }
  const capture = {
    title: text(document.title),
    url,
    selectedText: text(window.getSelection()?.toString() ?? null),
    description: meta([
      'meta[name="description"]',
      'meta[property="og:description"]',
    ]),
    author: meta(['meta[name="author"]', 'meta[property="article:author"]']),
    publishedAt: meta([
      'meta[property="article:published_time"]',
      'meta[name="date"]',
      'meta[name="pubdate"]',
    ]),
  };
  if (
    !withinCodePoints(capture.title, 500) ||
    !withinBytes(capture.url, 4_096) ||
    !withinBytes(capture.selectedText, 64 * 1024) ||
    !withinBytes(capture.description, 16 * 1024) ||
    !withinCodePoints(capture.author, 500) ||
    !withinBytes(capture.publishedAt, 200) ||
    !withinBytes(JSON.stringify(capture), 128 * 1024)
  ) {
    return null;
  }
  return capture;
}
