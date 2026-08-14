import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  manifestForShareTargetMode,
  normalizeShareTargetMode,
  shareTargetModeScript,
} from './configure-share-target-build.mjs';

const manifest = {
  name: 'ERP4',
  share_target: {
    action: '/share-target',
    method: 'POST',
  },
};

test('enabled mode preserves share_target and emits an enabled worker gate', () => {
  assert.deepEqual(manifestForShareTargetMode(manifest, 'enabled'), manifest);
  assert.equal(
    shareTargetModeScript('enabled'),
    'self.ERP4_SHARE_TARGET_MODE = "enabled";\n',
  );
});

test('decommission mode removes intake but keeps a worker cleanup gate', () => {
  assert.deepEqual(manifestForShareTargetMode(manifest, 'decommission'), {
    name: 'ERP4',
  });
  assert.equal(
    shareTargetModeScript('decommission'),
    'self.ERP4_SHARE_TARGET_MODE = "decommission";\n',
  );
});

test('unknown mode fails closed', () => {
  assert.throws(
    () => normalizeShareTargetMode(''),
    /must be enabled or decommission/,
  );
  assert.throws(
    () => normalizeShareTargetMode('disabled'),
    /must be enabled or decommission/,
  );
});

test('the official release build explicitly enables BFF auth and share-target intake', () => {
  const source = fs.readFileSync(
    new URL('../../../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('- name: Build (frontend)');
  const end = source.indexOf('- name:', start + 1);
  assert.notEqual(start, -1);
  const step = source.slice(start, end === -1 ? undefined : end);
  assert.match(step, /VITE_AUTH_MODE: jwt_bff/u);
  assert.match(step, /VITE_PWA_SHARE_TARGET_MODE: enabled/u);
  assert.match(step, /npm run build --prefix packages\/frontend/u);
});
