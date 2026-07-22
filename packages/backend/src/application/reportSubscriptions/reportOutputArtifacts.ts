import { createHash } from 'node:crypto';

import { createReportArtifactStorageAdapter } from '../../adapters/storage/contextArtifactStorageAdapters.js';
import type { generatePdf, renderPdfBuffer } from '../../services/pdf.js';
import type { ReportOutputStoragePort } from './reportOutputStoragePort.js';

const DEFAULT_REPORT_STORAGE_DIR = '/tmp/erp4/reports';

export type ReportArtifactRef = {
  artifactId: string;
  contentType: string;
  filename: string;
  ownerId: string;
  ownerType: 'report_subscription';
  provider: 'gdrive';
  url: string;
};

export type ReportStorageDependencies = {
  createStorage?: () => ReportOutputStoragePort;
  generatePdf?: typeof generatePdf;
  now?: () => Date;
  renderPdfBuffer?: typeof renderPdfBuffer;
};

export function sanitizeReportFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

export function buildReportFilename(
  reportKey: string,
  format: 'csv' | 'pdf',
  hint?: string,
  now = new Date(),
) {
  const safeKey = sanitizeReportFilenamePart(reportKey || 'report');
  const safeHint = hint ? sanitizeReportFilenamePart(hint) : '';
  const timestamp = now.toISOString().replace(/[:.]/g, '');
  const suffix = safeHint ? `-${safeHint}` : '';
  return `${safeKey}${suffix}-${timestamp}.${format}`;
}

function reportStorage(dependencies: ReportStorageDependencies) {
  return (
    dependencies.createStorage?.() ??
    createReportArtifactStorageAdapter({ provider: 'gdrive' })
  );
}

export function resolveReportProvider(): 'gdrive' | 'local' {
  return process.env.REPORT_PROVIDER?.trim().toLowerCase() === 'gdrive'
    ? 'gdrive'
    : 'local';
}

export function resolveReportStorageDir() {
  return process.env.REPORT_STORAGE_DIR || DEFAULT_REPORT_STORAGE_DIR;
}

export async function readReportArtifactBuffer(
  dependencies: ReportStorageDependencies,
  artifact: ReportArtifactRef,
) {
  const opened = await reportStorage(dependencies).open(artifact.artifactId, {
    ownerId: artifact.ownerId,
    ownerType: artifact.ownerType,
  });
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of opened.stream) {
    const buffer = Buffer.from(chunk);
    sizeBytes += buffer.length;
    if (sizeBytes > opened.artifact.sizeBytes) {
      opened.stream.destroy();
      throw new Error('report_artifact_size_invalid');
    }
    chunks.push(buffer);
  }
  if (sizeBytes !== opened.artifact.sizeBytes) {
    throw new Error('report_artifact_size_invalid');
  }
  return Buffer.concat(chunks, sizeBytes);
}

export async function storeReportOutputArtifact(input: {
  actorId?: string;
  content: Buffer;
  contentType: string;
  dependencies: ReportStorageDependencies;
  filename: string;
  format: 'csv' | 'pdf';
  generatedAt: Date;
  subscriptionId: string;
}): Promise<ReportArtifactRef> {
  const sha256 = createHash('sha256').update(input.content).digest('hex');
  const stored = await reportStorage(input.dependencies).store({
    body: input.content,
    contentType: input.contentType,
    createdBy: input.actorId,
    idempotencyKey: [
      'report',
      input.subscriptionId,
      input.generatedAt.toISOString(),
      input.format,
      sha256,
    ].join(':'),
    originalName: input.filename,
    ownerId: input.subscriptionId,
    ownerType: 'report_subscription',
    sha256,
    sizeBytes: input.content.length,
    storageName: `${sha256}.${input.format}`,
  });
  return {
    artifactId: stored.artifactId,
    contentType: input.contentType,
    filename: input.filename,
    ownerId: input.subscriptionId,
    ownerType: 'report_subscription',
    provider: 'gdrive',
    url: `/report-outputs/${stored.artifactId}`,
  };
}
