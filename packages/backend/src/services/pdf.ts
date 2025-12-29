import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
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

function resolvePdfStorageDir() {
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

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], data: Buffer.from(match[2], 'base64') };
}

async function loadAssetBuffer(value?: string | null) {
  if (!value) return null;
  if (value.startsWith('data:')) {
    const parsed = parseDataUrl(value);
    return parsed ? parsed.data : null;
  }
  if (isHttpUrl(value)) {
    try {
      const res = await fetch(value);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }
  try {
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
  const res = await fetch(endpoint, {
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
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
      const externalPdf = await requestExternalPdf(templateId, payload, options);
      await fs.writeFile(filePath, externalPdf);
    } else {
      const assets = await resolvePdfAssets(options, layout);
      await writePdfFile(filePath, templateId, payload, layout, assets, options);
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
