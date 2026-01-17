import assert from 'node:assert/strict';
import test from 'node:test';

test('readiness report: db ok', async () => {
  const { getReadinessReport, toPublicReadinessReport } = await import(
    '../dist/services/readiness.js'
  );
  const prismaOk = { $queryRaw: async () => 1 };
  const report = await getReadinessReport(prismaOk);
  assert.equal(report.ok, true);
  const publicReport = toPublicReadinessReport(report);
  assert.deepEqual(publicReport, { ok: true, checks: { db: { ok: true } } });
});

test('readiness report: db unavailable', async () => {
  const { getReadinessReport, toPublicReadinessReport } = await import(
    '../dist/services/readiness.js'
  );
  const prismaFail = { $queryRaw: async () => Promise.reject(new Error('fail')) };
  const report = await getReadinessReport(prismaFail);
  assert.equal(report.ok, false);
  const publicReport = toPublicReadinessReport(report);
  assert.deepEqual(publicReport, {
    ok: false,
    checks: { db: { ok: false, code: 'db_unavailable' } },
  });
});

