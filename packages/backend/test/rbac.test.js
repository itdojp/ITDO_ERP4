import assert from 'node:assert/strict';
import test from 'node:test';
import { hasProjectAccess } from '../dist/services/rbac.js';

test('hasProjectAccess: admin/mgmt are always allowed', () => {
  assert.equal(hasProjectAccess(['admin'], [], undefined), true);
  assert.equal(hasProjectAccess(['mgmt'], [], undefined), true);
});

test('hasProjectAccess: user requires project membership', () => {
  assert.equal(hasProjectAccess(['user'], ['p1'], 'p1'), true);
  assert.equal(hasProjectAccess(['user'], ['p1'], 'p2'), false);
  assert.equal(hasProjectAccess(['user'], ['p1'], undefined), false);
});

