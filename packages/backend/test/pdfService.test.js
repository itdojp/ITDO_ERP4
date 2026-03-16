import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePdfOutputPath } from '../dist/services/pdf.js';

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
