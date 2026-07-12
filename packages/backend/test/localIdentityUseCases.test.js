import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const [localIdentityShared, localIdentityUseCases, dbModule] =
  await Promise.all([
    import('../dist/application/auth/localIdentityShared.js'),
    import('../dist/application/auth/localIdentityUseCases.js'),
    import('../dist/services/db.js'),
  ]);

const {
  buildLocalCredentialAuditMetadata,
  isIdentityEffectivelyActive,
  localCredentialStateConstants,
  parseIdentityWindow,
  parseLockedUntil,
  resolveIssuedLocalCredentialMfaRequired,
  snapshotIdentityState,
} = localIdentityShared;

const { linkGoogleUserIdentity, updateUserIdentity } = localIdentityUseCases;
const { prisma } = dbModule;

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [pathKey, stub] of Object.entries(stubs)) {
    if (pathKey === '$transaction') {
      const original = prisma.$transaction;
      prisma.$transaction = stub;
      restores.push(() => {
        prisma.$transaction = original;
      });
      continue;
    }
    const [model, method] = pathKey.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${pathKey}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

test('local identity shared rules parse state windows and lock windows', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(parseLockedUntil(undefined).provided, false);
  assert.equal(parseLockedUntil(null).value, null);
  assert.equal(parseLockedUntil(future).value?.toISOString(), future);
  assert.equal(parseLockedUntil('2000-01-01T00:00:00.000Z').invalid, true);

  assert.deepEqual(parseIdentityWindow(undefined, 'effectiveUntil'), {
    provided: false,
    value: undefined,
    invalidField: null,
  });
  assert.equal(
    parseIdentityWindow('not-a-date', 'effectiveUntil').invalidField,
    'effectiveUntil',
  );
  assert.equal(
    isIdentityEffectivelyActive({ status: 'active', effectiveUntil: null }),
    true,
  );
  assert.equal(
    isIdentityEffectivelyActive({
      status: 'active',
      effectiveUntil: new Date('2000-01-01T00:00:00.000Z'),
    }),
    false,
  );
});

test('local credential audit metadata records admin context without secrets', () => {
  const metadata = buildLocalCredentialAuditMetadata('admin-001', {
    ticketId: 'AUTH-001',
    loginId: 'local-user@example.com',
    changedFields: ['password', 'mfaRequired'],
    status: 'active',
    userAccountId: 'user-001',
    identityId: 'identity-001',
    mfaRequired: false,
    mfaDefaultOverridden: true,
  });
  assert.equal(metadata.actorAdminUserId, 'admin-001');
  assert.equal(metadata.targetUserAccountId, 'user-001');
  assert.equal(metadata.loginId, 'local-user@example.com');
  assert.equal(
    Object.prototype.hasOwnProperty.call(metadata, 'password'),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(metadata, 'passwordHash'),
    false,
  );
  assert.equal(resolveIssuedLocalCredentialMfaRequired(undefined), true);
  assert.equal(resolveIssuedLocalCredentialMfaRequired(false), false);
  assert.equal(localCredentialStateConstants.maxFailedAttempts, 5);
});

test('identity snapshot excludes provider subject and local credential secrets', () => {
  const snapshot = snapshotIdentityState({
    status: 'disabled',
    effectiveUntil: new Date('2026-03-23T00:00:00.000Z'),
    rollbackWindowUntil: null,
    note: 'disabled after migration',
  });
  assert.deepEqual(snapshot, {
    status: 'disabled',
    effectiveUntil: '2026-03-23T00:00:00.000Z',
    rollbackWindowUntil: null,
    note: 'disabled after migration',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(snapshot, 'providerSubject'),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(snapshot, 'passwordHash'),
    false,
  );
});

test('linkGoogleUserIdentity keeps explicit audit reason authoritative over request audit context', async () => {
  const effectiveUntil = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const rollbackWindowUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  let capturedAudit = null;
  let capturedCreate = null;

  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => ({
        id: 'user-001',
        active: true,
        deletedAt: null,
        identities: [],
      }),
      'userIdentity.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'identity-google-001',
          userAccountId: 'user-001',
          providerType: 'google_oidc',
          providerSubject: args.data.providerSubject,
          issuer: args.data.issuer,
          emailSnapshot: args.data.emailSnapshot,
          status: 'active',
          lastAuthenticatedAt: null,
          linkedAt: new Date('2026-03-23T00:00:00.000Z'),
          effectiveUntil: args.data.effectiveUntil,
          rollbackWindowUntil: args.data.rollbackWindowUntil,
          note: args.data.note,
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T00:00:00.000Z'),
          userAccount: {
            id: 'user-001',
            userName: 'target.user@example.com',
            displayName: 'Target User',
            active: true,
            deletedAt: null,
          },
          localCredential: null,
        };
      },
      'auditLog.create': async ({ data }) => {
        capturedAudit = data;
        return { id: 'audit-001' };
      },
    },
    async () => {
      const result = await linkGoogleUserIdentity(
        {
          userAccountId: 'user-001',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          emailSnapshot: 'target@example.com',
          effectiveUntil: effectiveUntil.toISOString(),
          rollbackWindowUntil: rollbackWindowUntil.toISOString(),
          note: 'approved migration',
          ticketId: 'AUTH-MIG-001',
          reasonCode: 'google_link',
          reasonText: 'operator approved link',
        },
        {
          actorId: 'sys-admin',
          auditContext: {
            userId: 'sys-admin',
            reasonCode: 'request_context_override',
            reasonText: 'request context override',
            source: 'api',
          },
        },
      );

      assert.equal(result.kind, 'success');
      assert.equal(result.statusCode, 201);
      assert.equal(result.value.providerType, 'google_oidc');
    },
  );

  assert.equal(capturedCreate?.data?.providerSubject, 'google-sub-001');
  assert.equal(capturedAudit?.action, 'user_identity_google_linked');
  assert.equal(capturedAudit?.reasonCode, 'google_link');
  assert.equal(capturedAudit?.reasonText, 'operator approved link');
  assert.equal(capturedAudit?.source, 'api');
  assert.equal(capturedAudit?.metadata?.ticketId, 'AUTH-MIG-001');
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      capturedAudit?.metadata ?? {},
      'password',
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      capturedAudit?.metadata ?? {},
      'passwordHash',
    ),
    false,
  );
});

test('updateUserIdentity maps serializable transaction conflicts at application boundary', async () => {
  await withPrismaStubs(
    {
      $transaction: async () => {
        throw new Prisma.PrismaClientKnownRequestError('transaction conflict', {
          code: 'P2034',
          clientVersion: 'test',
        });
      },
    },
    async () => {
      const result = await updateUserIdentity(
        'identity-google-001',
        {
          status: 'disabled',
          ticketId: 'AUTH-MIG-004C',
          reasonCode: 'google_disable',
        },
        {
          actorId: 'sys-admin',
          auditContext: { userId: 'sys-admin' },
        },
      );

      assert.equal(result.kind, 'error');
      assert.equal(result.error.statusCode, 409);
      assert.equal(result.error.code, 'identity_update_conflict');
    },
  );
});

test('local identity mutation use cases preserve cache invalidation boundaries', () => {
  const source = readFileSync(
    path.join(BACKEND_DIR, 'src/application/auth/localIdentityUseCases.ts'),
    'utf8',
  );

  for (const [functionName, expectedCall] of [
    ['linkGoogleUserIdentity', 'clearUserDbContextCache();'],
    ['linkLocalUserIdentity', 'clearUserDbContextCache();'],
    ['updateUserIdentity', 'clearUserDbContextCache();'],
    ['createLocalCredential', 'invalidateLocalIdentityCache('],
    ['updateLocalCredential', 'invalidateLocalIdentityCache('],
  ]) {
    const start = source.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} should be exported`);
    const next = source.indexOf('export async function', start + 1);
    const body = source.slice(start, next === -1 ? source.length : next);
    assert.ok(
      body.includes(expectedCall),
      `${functionName} should preserve ${expectedCall} boundary`,
    );
  }
});
