import assert from 'node:assert/strict';
import test from 'node:test';

const { requireUserContext } = await import('../dist/services/authContext.js');
const { AppError } = await import('../dist/services/errors.js');

test('requireUserContext returns the authenticated user context', () => {
  const user = {
    userId: 'user-auth-context',
    roles: ['admin'],
    groupIds: ['group-1'],
    groupAccountIds: ['account-1'],
    projectIds: ['project-1'],
  };

  assert.equal(requireUserContext({ user }), user);
});

test('requireUserContext throws an auth AppError when user context is missing', () => {
  assert.throws(
    () => requireUserContext({}),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'unauthorized');
      assert.equal(error.httpStatus, 401);
      assert.equal(error.category, 'auth');
      return true;
    },
  );
});
