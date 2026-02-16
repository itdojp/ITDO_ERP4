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

test('requireRoleOrSelf: allows admin to access other users', async () => {
  const guard = requireRoleOrSelf(['admin'], (req) => req.params?.userId);

  const allowReq = {
    user: { roles: ['admin'], userId: 'admin-user' },
    params: { userId: 'u2' },
  };
  const allowReply = createReplyMock();
  await guard(allowReq, allowReply);
  assert.equal(allowReply.statusCode, null);
});

test('requireRoleOrSelf: denies when target or requester user id is missing', async () => {
  const guard = requireRoleOrSelf(['admin'], (req) => req.params?.userId);

  const missingTargetReq = {
    user: { roles: ['user'], userId: 'u1' },
    params: {},
  };
  const missingTargetReply = createReplyMock();
  await guard(missingTargetReq, missingTargetReply);
  assert.equal(missingTargetReply.statusCode, 403);
  assert.equal(missingTargetReply.payload?.error?.code, 'forbidden');
  assert.equal(missingTargetReply.payload?.error?.category, 'permission');

  const missingUserReq = {
    user: { roles: ['user'], userId: undefined },
    params: { userId: 'u1' },
  };
  const missingUserReply = createReplyMock();
  await guard(missingUserReq, missingUserReply);
  assert.equal(missingUserReply.statusCode, 403);
  assert.equal(missingUserReply.payload?.error?.code, 'forbidden');
  assert.equal(missingUserReply.payload?.error?.category, 'permission');
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

test('requireProjectAccess: allows mgmt and member access', async () => {
  const guard = requireProjectAccess((req) => req.params?.projectId);

  const mgmtReq = {
    user: { roles: ['mgmt'], projectIds: [] },
    params: { projectId: 'p2' },
  };
  const mgmtReply = createReplyMock();
  await guard(mgmtReq, mgmtReply);
  assert.equal(mgmtReply.statusCode, null);

  const memberReq = {
    user: { roles: ['user'], projectIds: ['p1'] },
    params: { projectId: 'p1' },
  };
  const memberReply = createReplyMock();
  await guard(memberReq, memberReply);
  assert.equal(memberReply.statusCode, null);
});

test('requireProjectAccess: allows when projectId is undefined', async () => {
  const guard = requireProjectAccess(() => undefined);

  const req = {
    user: { roles: ['user'], projectIds: ['p1'] },
  };
  const reply = createReplyMock();
  await guard(req, reply);
  assert.equal(reply.statusCode, null);
});
