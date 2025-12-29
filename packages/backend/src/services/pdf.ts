import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';

type PdfPayload = Record<string, unknown>;

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

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
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

async function writePdfFile(
  filePath: string,
  templateId: string,
  payload: PdfPayload,
) {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.fontSize(18).text('ERP4 Document', { align: 'left' });
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

    doc.end();
  });
}

export async function generatePdf(
  templateId: string,
  payload: PdfPayload,
  hint?: string,
): Promise<PdfResult> {
  try {
    const storageDir = resolvePdfStorageDir();
    await fs.mkdir(storageDir, { recursive: true });
    const filename = buildPdfFilename(templateId, payload, hint);
    const filePath = path.join(storageDir, filename);
    await writePdfFile(filePath, templateId, payload);
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
