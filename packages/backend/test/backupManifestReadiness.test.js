import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectBackupObjectSource } from '../dist/application/backup/backupManifestReadiness.js';

const now = new Date('2026-07-22T10:00:00.000Z');
const policy = {
  freshnessClass: 'hourly',
  maxAgeMs: 2 * 60 * 60 * 1000,
  minimums: { hourly: 1, daily: 1, weekly: 1, monthly: 1 },
};

function makeInventory() {
  const manifests = new Map();
  const stats = new Map();
  const entries = [];
  for (const [index, retentionClass] of [
    'hourly',
    'daily',
    'weekly',
    'monthly',
  ].entries()) {
    const backupId = `erp4-20260722-0${index}0000-abcdef0`;
    const generatedAt = `2026-07-22T0${index}:00:00.000Z`;
    for (const type of ['database', 'globals', 'metadata']) {
      const name = `${backupId}-${type}.gpg`;
      const digest = `${String(index + 1)}${type.charCodeAt(0).toString(16)}`
        .padEnd(64, 'a')
        .slice(0, 64);
      entries.push(
        { key: name, sizeBytes: 10 },
        { key: `${name}.manifest.json`, sizeBytes: 100 },
      );
      stats.set(name, { sha256: digest, sizeBytes: 10 });
      manifests.set(`${name}.manifest.json`, {
        schemaVersion: 'erp4.backup.manifest.v1',
        backupId,
        generatedAt,
        environment: 'prod',
        retentionClass,
        artifact: {
          type,
          name,
          sourceName: `${type}.source`,
          sourceSizeBytes: 9,
          sizeBytes: 10,
          sha256: digest,
        },
        encryption: { algorithm: 'openpgp' },
        application: { commitSha: 'abcdef0' },
      });
    }
  }
  return {
    entries,
    source: {
      list: async () => entries,
      readManifest: async (key) => structuredClone(manifests.get(key)),
      statArtifact: async (key) => structuredClone(stats.get(key)),
    },
  };
}

test('manifest source inspection verifies complete encrypted generations', async () => {
  const { source } = makeInventory();
  const result = await inspectBackupObjectSource({
    configured: true,
    expectedEnvironment: 'prod',
    now,
    policy,
    requireOpenPgp: true,
    source,
  });
  assert.deepEqual(result, {
    anomalyCounts: {},
    classCounts: { hourly: 1, daily: 1, weekly: 1, monthly: 1 },
    classTimestamps: {
      hourly: {
        latestGeneratedAt: '2026-07-22T00:00:00.000Z',
        oldestGeneratedAt: '2026-07-22T00:00:00.000Z',
      },
      daily: {
        latestGeneratedAt: '2026-07-22T01:00:00.000Z',
        oldestGeneratedAt: '2026-07-22T01:00:00.000Z',
      },
      weekly: {
        latestGeneratedAt: '2026-07-22T02:00:00.000Z',
        oldestGeneratedAt: '2026-07-22T02:00:00.000Z',
      },
      monthly: {
        latestGeneratedAt: '2026-07-22T03:00:00.000Z',
        oldestGeneratedAt: '2026-07-22T03:00:00.000Z',
      },
    },
    configured: true,
    latestGeneratedAt: '2026-07-22T00:00:00.000Z',
    retentionCandidates: 0,
  });
});

test('manifest source inspection detects zero, orphan, checksum and incomplete data', async () => {
  const { source, entries } = makeInventory();
  entries.find((item) => item.key.endsWith('-database.gpg')).sizeBytes = 0;
  entries.splice(
    entries.findIndex((item) =>
      item.key.endsWith('-globals.gpg.manifest.json'),
    ),
    1,
  );
  const originalStat = source.statArtifact;
  source.statArtifact = async (key) => {
    const value = await originalStat(key);
    return key.includes('metadata')
      ? { ...value, sha256: 'f'.repeat(64) }
      : value;
  };
  const result = await inspectBackupObjectSource({
    configured: true,
    expectedEnvironment: 'prod',
    now,
    policy,
    requireOpenPgp: true,
    source,
  });
  assert.ok(result.anomalyCounts.zero_size >= 1);
  assert.ok(result.anomalyCounts.orphan_pair >= 1);
  assert.ok(result.anomalyCounts.checksum_mismatch >= 1);
  assert.ok(result.anomalyCounts.generation_incomplete >= 1);
});

test('manifest source inspection rejects wrong environment and plaintext', async () => {
  const { source } = makeInventory();
  const originalRead = source.readManifest;
  source.readManifest = async (key) => {
    const manifest = await originalRead(key);
    manifest.environment = 'other';
    manifest.encryption.algorithm = 'none';
    return manifest;
  };
  const result = await inspectBackupObjectSource({
    configured: true,
    expectedEnvironment: 'prod',
    now,
    policy,
    requireOpenPgp: true,
    source,
  });
  assert.equal(result.anomalyCounts.invalid_manifest, 12);
  assert.equal(result.classCounts.hourly, 0);
});

test('manifest source inspection binds OpenPGP names and commit context', async () => {
  const { source } = makeInventory();
  const originalRead = source.readManifest;
  source.readManifest = async (key) => {
    const manifest = await originalRead(key);
    manifest.application.commitSha = '1234567';
    return manifest;
  };
  const result = await inspectBackupObjectSource({
    configured: true,
    expectedEnvironment: 'prod',
    now,
    policy,
    requireOpenPgp: true,
    source,
  });
  assert.equal(result.anomalyCounts.invalid_manifest, 12);
});

test('Sakura inventory requires retention/date/bundle/type key context', async () => {
  const { source, entries } = makeInventory();
  const originalRead = source.readManifest;
  const originalStat = source.statArtifact;
  function relativeKey(key) {
    const artifactName = key.replace(/\.manifest\.json$/, '');
    const match =
      /erp4-(\d{4})(\d{2})(\d{2})-(\d{2})\d{4}-[^-]+-(database|globals|metadata)\.gpg$/.exec(
        artifactName,
      );
    assert.ok(match);
    const manifest = [...entries]
      .filter((entry) => entry.key.endsWith('.manifest.json'))
      .map((entry) => entry.key)
      .find((manifestKey) => manifestKey === `${artifactName}.manifest.json`);
    assert.ok(manifest);
    const sourceManifest = source.readManifest(manifest);
    return sourceManifest.then((value) => {
      const date =
        value.retentionClass === 'hourly'
          ? `${match[1]}/${match[2]}/${match[3]}`
          : value.retentionClass === 'daily'
            ? `${match[1]}/${match[2]}`
            : match[1];
      return `${value.retentionClass}/${date}/${value.backupId}/${value.artifact.type}/${key}`;
    });
  }
  const mapped = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      key: await relativeKey(entry.key),
    })),
  );
  const wrapped = {
    list: async () => mapped,
    readManifest: async (key) => originalRead(key.split('/').pop()),
    statArtifact: async (key) => originalStat(key.split('/').pop()),
  };
  const valid = await inspectBackupObjectSource({
    configured: true,
    expectedEnvironment: 'prod',
    now,
    policy,
    requireOpenPgp: true,
    source: wrapped,
  });
  assert.deepEqual(valid.anomalyCounts, {});

  const dailyManifestName = entries.find((entry) =>
    entry.key.includes('20260722-010000-abcdef0-database.gpg.manifest.json'),
  ).key;
  const dailyArtifactName = dailyManifestName.replace('.manifest.json', '');
  for (const entry of mapped.filter((item) =>
    [dailyArtifactName, dailyManifestName].includes(item.key.split('/').pop()),
  )) {
    entry.key = entry.key.replace('/2026/07/', '/2025/07/');
  }
  const invalid = await inspectBackupObjectSource({
    configured: true,
    expectedEnvironment: 'prod',
    now,
    policy,
    requireOpenPgp: true,
    source: wrapped,
  });
  assert.equal(invalid.anomalyCounts.invalid_manifest, 1);
  assert.equal(invalid.classCounts.daily, 0);
});

test('manifest source inspection rejects an unbounded inventory', async () => {
  await assert.rejects(
    inspectBackupObjectSource({
      configured: true,
      expectedEnvironment: 'prod',
      now,
      policy,
      requireOpenPgp: true,
      source: {
        list: async () =>
          Array.from({ length: 20_001 }, (_, index) => ({
            key: `erp4-${index}.gpg`,
            sizeBytes: 1,
          })),
        readManifest: async () => assert.fail('not expected'),
        statArtifact: async () => assert.fail('not expected'),
      },
    }),
    /backup_inventory_too_large/,
  );
});

export { makeInventory };
