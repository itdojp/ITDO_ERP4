import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasProjectAccess,
  requireProjectAccess,
  requireRoleOrSelf,
} from '../dist/services/rbac.js';

function createReplyMock() {
  return {
    statusCode: null,
    payload: null,
    code(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('hasProjectAccess: admin/mgmt are always allowed', () => {
  assert.equal(hasProjectAccess(['admin'], [], undefined), true);
  assert.equal(hasProjectAccess(['mgmt'], [], undefined), true);
});

test('hasProjectAccess: user requires project membership', () => {
  assert.equal(hasProjectAccess(['user'], ['p1'], 'p1'), true);
  assert.equal(hasProjectAccess(['user'], ['p1'], 'p2'), false);
  assert.equal(hasProjectAccess(['user'], ['p1'], undefined), false);
});

test('requireRoleOrSelf: allows self and denies other user', async () => {
  const guard = requireRoleOrSelf(['admin'], (req) => req.params?.userId);

  const allowReq = {
    user: { roles: ['user'], userId: 'u1' },
    params: { userId: 'u1' },
  };
  const allowReply = createReplyMock();
  await guard(allowReq, allowReply);
  assert.equal(allowReply.statusCode, null);

  const denyReq = {
    user: { roles: ['user'], userId: 'u1' },
    params: { userId: 'u2' },
  };
  const denyReply = createReplyMock();
  await guard(denyReq, denyReply);
  assert.equal(denyReply.statusCode, 403);
  assert.equal(denyReply.payload?.error?.code, 'forbidden');
  assert.equal(denyReply.payload?.error?.category, 'permission');
});

test('requireProjectAccess: denies non-member project and allows admin', async () => {
  const guard = requireProjectAccess((req) => req.params?.projectId);

  const denyReq = {
    user: { roles: ['user'], projectIds: ['p1'] },
    params: { projectId: 'p2' },
  };
  const denyReply = createReplyMock();
  await guard(denyReq, denyReply);
  assert.equal(denyReply.statusCode, 403);
  assert.equal(denyReply.payload?.error?.code, 'forbidden_project');
  assert.equal(denyReply.payload?.error?.category, 'permission');

  const allowReq = {
    user: { roles: ['admin'], projectIds: [] },
    params: { projectId: 'p2' },
  };
  const allowReply = createReplyMock();
  await guard(allowReq, allowReply);
  assert.equal(allowReply.statusCode, null);
});
