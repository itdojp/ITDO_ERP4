import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import net from 'net';
import PDFDocument from 'pdfkit';

type PdfPayload = Record<string, unknown>;

type PdfLayoutConfig = {
  documentTitle?: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  footerNote?: string;
  signatureLabel?: string;
  signatureImageUrl?: string;
  signatureText?: string;
};

export type PdfRenderOptions = {
  layoutConfig?: Record<string, unknown> | null;
  logoUrl?: string | null;
  signatureText?: string | null;
};

type PdfRenderAssets = {
  logo?: Buffer | null;
  signatureImage?: Buffer | null;
};

export type PdfResult = {
  url: string;
  filePath?: string;
  filename?: string;
};

const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._-]+\.pdf$/;
const DEFAULT_ASSET_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_EXTERNAL_PDF_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ASSET_TIMEOUT_MS = 5000;
const DEFAULT_EXTERNAL_TIMEOUT_MS = 10000;
const ALLOWED_ASSET_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const MAX_ASSET_BYTES = parsePositiveInt(
  process.env.PDF_ASSET_MAX_BYTES,
  DEFAULT_ASSET_MAX_BYTES,
);
const MAX_DATA_URL_BYTES = parsePositiveInt(
  process.env.PDF_DATA_URL_MAX_BYTES,
  MAX_ASSET_BYTES,
);
const MAX_DATA_URL_BASE64_LENGTH = Math.ceil((MAX_DATA_URL_BYTES * 4) / 3);
const MAX_EXTERNAL_PDF_BYTES = parsePositiveInt(
  process.env.PDF_EXTERNAL_MAX_BYTES,
  DEFAULT_EXTERNAL_PDF_MAX_BYTES,
);
const ASSET_TIMEOUT_MS = parsePositiveInt(
  process.env.PDF_ASSET_TIMEOUT_MS,
  DEFAULT_ASSET_TIMEOUT_MS,
);
const EXTERNAL_TIMEOUT_MS = parsePositiveInt(
  process.env.PDF_EXTERNAL_TIMEOUT_MS,
  DEFAULT_EXTERNAL_TIMEOUT_MS,
);
const ALLOWED_ASSET_HOSTS = new Set(
  (process.env.PDF_ASSET_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export function resolvePdfStorageDir() {
  return process.env.PDF_STORAGE_DIR || '/tmp/erp4/pdfs';
}

function resolvePdfBaseUrl() {
  const base = process.env.PDF_BASE_URL || '/pdf-files';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function resolvePdfProvider() {
  const provider = (process.env.PDF_PROVIDER || 'local').toLowerCase();
  return provider === 'external' ? 'external' : 'local';
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function pickString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeLayoutConfig(config: unknown): PdfLayoutConfig {
  if (!config || typeof config !== 'object') return {};
  const data = config as Record<string, unknown>;
  return {
    documentTitle: pickString(data.documentTitle),
    companyName: pickString(data.companyName),
    companyAddress: pickString(data.companyAddress),
    companyPhone: pickString(data.companyPhone),
    companyEmail: pickString(data.companyEmail),
    footerNote: pickString(data.footerNote),
    signatureLabel: pickString(data.signatureLabel),
    signatureImageUrl: pickString(data.signatureImageUrl),
    signatureText: pickString(data.signatureText),
  };
}

function buildPdfFilename(
  templateId: string,
  payload: PdfPayload,
  hint?: string,
) {
  const rawId =
    typeof payload['id'] === 'string' ? payload['id'] : randomUUID();
  const safeId = sanitizeFilenamePart(rawId);
  const safeTemplate = sanitizeFilenamePart(templateId);
  const safeHint = hint ? sanitizeFilenamePart(hint) : 'doc';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  return `${safeTemplate}-${safeHint}-${safeId}-${timestamp}.pdf`;
}

function formatPdfValue(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPrivateHost(hostname: string) {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
  const ipVersion = net.isIP(hostname);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const parts = hostname.split('.').map((value) => Number(value));
    if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
      return true;
    }
    const [a, b] = parts;
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const lowered = hostname.toLowerCase();
  if (lowered === '::1') return true;
  if (lowered.startsWith('fc') || lowered.startsWith('fd')) return true;
  if (lowered.startsWith('fe80')) return true;
  return false;
}

function isAllowedAssetHost(hostname: string) {
  if (isPrivateHost(hostname)) return false;
  if (ALLOWED_ASSET_HOSTS.size === 0) return true;
  return ALLOWED_ASSET_HOSTS.has(hostname.toLowerCase());
}

function isAllowedAssetMime(value?: string | null) {
  if (!value) return true;
  const normalized = value.split(';')[0].trim().toLowerCase();
  if (!normalized) return true;
  return ALLOWED_ASSET_MIME.has(normalized);
}

async function readResponseWithLimit(
  res: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('asset_too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error('asset_too_large');
  }
  return Buffer.from(arrayBuffer);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64Data = match[2];
  if (!isAllowedAssetMime(mime)) return null;
  if (base64Data.length > MAX_DATA_URL_BASE64_LENGTH) return null;
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_ASSET_BYTES) return null;
  return { mime, data: buffer };
}

async function loadAssetBuffer(value?: string | null) {
  if (!value) return null;
  if (value.startsWith('data:')) {
    const parsed = parseDataUrl(value);
    return parsed ? parsed.data : null;
  }
  if (isHttpUrl(value)) {
    try {
      const parsedUrl = new URL(value);
      if (!isAllowedAssetHost(parsedUrl.hostname)) return null;
      const res = await fetchWithTimeout(value, ASSET_TIMEOUT_MS);
      if (!res.ok) return null;
      const contentLength = res.headers.get('content-length');
      if (contentLength) {
        const length = Number(contentLength);
        if (Number.isFinite(length) && length > MAX_ASSET_BYTES) {
          return null;
        }
      }
      const contentType = res.headers.get('content-type');
      if (!isAllowedAssetMime(contentType)) return null;
      return await readResponseWithLimit(res, MAX_ASSET_BYTES);
    } catch {
      return null;
    }
  }
  try {
    const stat = await fs.stat(value);
    if (stat.size > MAX_ASSET_BYTES) return null;
    return await fs.readFile(value);
  } catch {
    return null;
  }
}

async function resolvePdfAssets(
  options?: PdfRenderOptions,
  layout?: PdfLayoutConfig,
): Promise<PdfRenderAssets> {
  const logo = await loadAssetBuffer(options?.logoUrl || undefined);
  const signatureImage = await loadAssetBuffer(
    layout?.signatureImageUrl || undefined,
  );
  return { logo, signatureImage };
}

async function writePdfFile(
  filePath: string,
  templateId: string,
  payload: PdfPayload,
  layout: PdfLayoutConfig,
  assets: PdfRenderAssets,
  options?: PdfRenderOptions,
) {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    if (assets.logo) {
      doc.image(assets.logo, doc.x, doc.y, { fit: [120, 60] });
    }
    const headerLines = [
      layout.companyName,
      layout.companyAddress,
      layout.companyPhone,
      layout.companyEmail,
    ].filter(Boolean);
    if (headerLines.length) {
      doc.fontSize(10).text(headerLines.join('\n'), { align: 'right' });
    }
    doc.moveDown(1);
    doc.fontSize(18).text(layout.documentTitle || 'ERP4 Document', {
      align: 'left',
    });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Template: ${templateId}`);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown();
    doc.fontSize(12).text('Payload');
    doc.moveDown(0.5);

    const entries = Object.entries(payload).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (!entries.length) {
      doc.text('(empty)');
    }
    for (const [key, value] of entries) {
      const formatted = formatPdfValue(value);
      doc.text(`${key}: ${formatted}`);
    }

    const signatureText = options?.signatureText || layout.signatureText;
    if (signatureText || assets.signatureImage || layout.signatureLabel) {
      doc.moveDown(2);
      if (layout.signatureLabel) {
        doc.fontSize(10).text(layout.signatureLabel, { align: 'right' });
      }
      if (assets.signatureImage) {
        doc.image(assets.signatureImage, doc.x, doc.y, { fit: [160, 80] });
        doc.moveDown(3);
      }
      if (signatureText) {
        doc.fontSize(10).text(signatureText, { align: 'right' });
      }
    }
    if (layout.footerNote) {
      doc.moveDown(2);
      doc.fontSize(9).text(layout.footerNote, { align: 'center' });
    }
    doc.end();
  });
}

async function requestExternalPdf(
  templateId: string,
  payload: PdfPayload,
  options?: PdfRenderOptions,
) {
  const endpoint = process.env.PDF_EXTERNAL_URL;
  if (!endpoint) {
    throw new Error('PDF_EXTERNAL_URL is required for external provider');
  }
  const res = await fetchWithTimeout(endpoint, EXTERNAL_TIMEOUT_MS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.PDF_EXTERNAL_API_KEY
        ? { Authorization: `Bearer ${process.env.PDF_EXTERNAL_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      templateId,
      payload,
      options,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`external_pdf_failed:${res.status}:${text.slice(0, 200)}`);
  }
  const contentType = res.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().includes('application/pdf')) {
    throw new Error('external_pdf_invalid_content_type');
  }
  const buffer = await readResponseWithLimit(res, MAX_EXTERNAL_PDF_BYTES);
  if (!buffer.slice(0, 4).equals(Buffer.from('%PDF'))) {
    throw new Error('external_pdf_invalid_signature');
  }
  return buffer;
}

export async function generatePdf(
  templateId: string,
  payload: PdfPayload,
  hint?: string,
  options?: PdfRenderOptions,
): Promise<PdfResult> {
  try {
    const storageDir = resolvePdfStorageDir();
    await fs.mkdir(storageDir, { recursive: true });
    const filename = buildPdfFilename(templateId, payload, hint);
    const filePath = path.join(storageDir, filename);
    const layout = normalizeLayoutConfig(options?.layoutConfig);
    if (resolvePdfProvider() === 'external') {
      const externalPdf = await requestExternalPdf(
        templateId,
        payload,
        options,
      );
      await fs.writeFile(filePath, externalPdf);
    } else {
      const assets = await resolvePdfAssets(options, layout);
      await writePdfFile(
        filePath,
        templateId,
        payload,
        layout,
        assets,
        options,
      );
    }
    const url = `${resolvePdfBaseUrl()}/${filename}`;
    return { url, filePath, filename };
  } catch (err) {
    const fallbackId =
      typeof payload['id'] === 'string' ? payload['id'] : 'unknown';
    console.error('[pdf generate failed]', {
      templateId,
      message: err instanceof Error ? err.message : 'unknown_error',
    });
    return { url: `stub://pdf/${templateId}/${fallbackId}` };
  }
}

export function resolvePdfFilePath(filename: string) {
  return path.join(resolvePdfStorageDir(), filename);
}

export function isSafePdfFilename(filename: string) {
  return SAFE_FILENAME_REGEX.test(filename);
}
