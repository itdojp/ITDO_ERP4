import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  generatePdf,
  resolvePdfAssetPath,
  resolvePdfOutputPath,
} from '../dist/services/pdf.js';

test('resolvePdfOutputPath resolves a safe file under the storage directory', () => {
  const filePath = resolvePdfOutputPath('/tmp/erp4/pdfs', 'report-001.pdf');

  assert.equal(filePath, '/tmp/erp4/pdfs/report-001.pdf');
});

test('resolvePdfOutputPath rejects invalid filenames', () => {
  assert.throws(
    () => resolvePdfOutputPath('/tmp/erp4/pdfs', '../report.pdf'),
    /invalid_pdf_filename/,
  );
  assert.throws(
    () => resolvePdfOutputPath('/tmp/erp4/pdfs', 'report/001.pdf'),
    /invalid_pdf_filename/,
  );
});

test('resolvePdfAssetPath confines local PDF assets to configured directory', () => {
  assert.equal(
    resolvePdfAssetPath('/workspace/erp4-assets', 'logos/company.png'),
    '/workspace/erp4-assets/logos/company.png',
  );
  assert.equal(
    resolvePdfAssetPath('/workspace/erp4-assets', '../secret.png'),
    null,
  );
  assert.equal(
    resolvePdfAssetPath('/workspace/erp4-assets', '/etc/passwd'),
    null,
  );
});

test('generatePdf stores gdrive output and returns only an ERP4 artifact URL', async () => {
  const previousProvider = process.env.PDF_PROVIDER;
  process.env.PDF_PROVIDER = 'gdrive';
  const artifactId = '11111111-1111-4111-8111-111111111111';
  let stored;
  try {
    const result = await generatePdf(
      'invoice-default',
      { id: 'invoice-placeholder', total: 1000 },
      'INV-PLACEHOLDER',
      undefined,
      {
        createStorage: () => ({
          store: async (input) => {
            stored = input;
            return {
              artifactId,
              contentType: input.contentType,
              createdAt: '2026-07-22T00:00:00.000Z',
              originalName: input.originalName,
              provider: 'gdrive',
              sha256: input.sha256,
              sizeBytes: input.sizeBytes,
            };
          },
        }),
        now: () => new Date('2026-07-22T00:00:00.000Z'),
      },
    );

    assert.equal(result.provider, 'gdrive');
    assert.equal(result.artifactId, artifactId);
    assert.equal(result.url, `/pdf-files/artifacts/${artifactId}`);
    assert.equal(result.filePath, undefined);
    assert.equal(Buffer.isBuffer(result.content), true);
    assert.equal(result.content.subarray(0, 4).toString('ascii'), '%PDF');
    assert.deepEqual(stored.body, result.content);
    assert.equal(stored.ownerType, 'document');
    assert.equal(stored.ownerId, 'invoice-placeholder');
    assert.match(stored.sha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.PDF_PROVIDER;
    } else {
      process.env.PDF_PROVIDER = previousProvider;
    }
  }
});

test('generatePdf never falls back to local storage after a gdrive failure', async () => {
  const previousProvider = process.env.PDF_PROVIDER;
  const originalConsoleError = console.error;
  process.env.PDF_PROVIDER = 'gdrive';
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const result = await generatePdf(
      'invoice-default',
      { id: 'invoice-placeholder' },
      'INV-PLACEHOLDER',
      undefined,
      {
        createStorage: () => ({
          store: async () => {
            throw new Error(
              'google_drive_forbidden authorization=Bearer sensitive-placeholder',
            );
          },
        }),
      },
    );
    assert.equal(result.url, 'stub://pdf/invoice-default/invoice-placeholder');
    assert.equal(result.filePath, undefined);
    assert.equal(result.content, undefined);
    assert.equal(
      JSON.stringify(errors).includes('sensitive-placeholder'),
      false,
    );
  } finally {
    console.error = originalConsoleError;
    if (previousProvider === undefined) {
      delete process.env.PDF_PROVIDER;
    } else {
      process.env.PDF_PROVIDER = previousProvider;
    }
  }
});

test('local storage override does not write through the PDF gdrive context', async () => {
  const previousProvider = process.env.PDF_PROVIDER;
  const previousStorageDir = process.env.PDF_STORAGE_DIR;
  const outputDir = path.resolve(
    '.codex-local/tmp',
    `pdf-service-local-override-${process.pid}`,
  );
  process.env.PDF_PROVIDER = 'gdrive';
  process.env.PDF_STORAGE_DIR = outputDir;
  let storageCalls = 0;
  try {
    const result = await generatePdf(
      'report-default',
      { id: 'report-placeholder', total: 1000 },
      'report',
      undefined,
      {
        createStorage: () => {
          storageCalls += 1;
          throw new Error('gdrive_storage_must_not_be_created');
        },
        now: () => new Date('2026-07-22T00:00:00.000Z'),
        storageProvider: 'local',
      },
    );

    assert.equal(result.provider, 'local');
    assert.equal(storageCalls, 0);
    assert.equal(typeof result.filePath, 'string');
    assert.equal((await fs.stat(result.filePath)).isFile(), true);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
    if (previousProvider === undefined) {
      delete process.env.PDF_PROVIDER;
    } else {
      process.env.PDF_PROVIDER = previousProvider;
    }
    if (previousStorageDir === undefined) {
      delete process.env.PDF_STORAGE_DIR;
    } else {
      process.env.PDF_STORAGE_DIR = previousStorageDir;
    }
  }
});
