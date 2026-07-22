import { createArtifactStorageAdapter } from './artifactStorageAdapter.js';

import type { EvidenceArchiveStoragePort } from '../../application/evidence/evidenceArchiveStoragePort.js';
import type { PdfStoragePort } from '../../application/pdf/pdfStoragePort.js';
import type { ReportOutputStoragePort } from '../../application/reportSubscriptions/reportOutputStoragePort.js';
import type { StorageArtifactProvider } from '../../application/storage/artifactStoragePort.js';

type ContextAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  provider: StorageArtifactProvider;
};

function value(env: NodeJS.ProcessEnv, key: string, fallback: string) {
  return env[key]?.trim() || fallback;
}

export function createPdfArtifactStorageAdapter(
  options: ContextAdapterOptions,
): PdfStoragePort {
  const env = options.env ?? process.env;
  return createArtifactStorageAdapter({
    context: 'pdf',
    env,
    folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
    localDir: value(env, 'PDF_STORAGE_DIR', '/tmp/erp4/pdfs'),
    provider: options.provider,
  });
}

export function createEvidenceArtifactStorageAdapter(
  options: ContextAdapterOptions & { metadata?: boolean },
): EvidenceArchiveStoragePort {
  const env = options.env ?? process.env;
  return createArtifactStorageAdapter({
    context: options.metadata ? 'evidence_metadata' : 'evidence',
    env,
    folderEnvKey: 'EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID',
    localDir: value(
      env,
      'EVIDENCE_ARCHIVE_LOCAL_DIR',
      '/tmp/erp4/evidence-archives',
    ),
    provider: options.provider,
  });
}

export function createReportArtifactStorageAdapter(
  options: ContextAdapterOptions,
): ReportOutputStoragePort {
  const env = options.env ?? process.env;
  return createArtifactStorageAdapter({
    context: 'report',
    env,
    folderEnvKey: 'REPORT_GDRIVE_FOLDER_ID',
    localDir: value(env, 'REPORT_STORAGE_DIR', '/tmp/erp4/reports'),
    provider: options.provider,
  });
}
