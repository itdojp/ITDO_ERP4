import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUserContextFromJwtPayload,
  evaluateDelegatedScope,
  normalizeConfiguredAgentScopes,
} from '../dist/plugins/auth.js';

test('buildUserContextFromJwtPayload: principal/actor/scopes are mapped', () => {
  const user = buildUserContextFromJwtPayload({
    sub: 'principal-user',
    act: { sub: 'agent-bot' },
    scp: ['read-only'],
    roles: ['user'],
    jti: 'tok-001',
    aud: ['erp4-agent'],
    exp: 1900000000,
  });

  assert.equal(user?.userId, 'principal-user');
  assert.equal(user?.auth?.principalUserId, 'principal-user');
  assert.equal(user?.auth?.actorUserId, 'agent-bot');
  assert.deepEqual(user?.auth?.scopes, ['read-only']);
  assert.equal(user?.auth?.tokenId, 'tok-001');
  assert.deepEqual(user?.auth?.audience, ['erp4-agent']);
  assert.equal(user?.auth?.expiresAt, 1900000000);
  assert.equal(user?.auth?.delegated, true);
});

test('buildUserContextFromJwtPayload: URI scopes are canonicalized and unsafe scope tokens fail closed', () => {
  const user = buildUserContextFromJwtPayload({
    sub: 'principal-user',
    act: { sub: 'agent-bot' },
    scp: [
      ' knowledge:write ',
      'https://idp.example/knowledge.write',
      'knowledge:write',
    ],
    roles: ['user'],
  });
  assert.deepEqual(user?.auth?.scopes, [
    'knowledge:write',
    'https://idp.example/knowledge.write',
  ]);

  for (const invalid of [
    'scope\u0000control',
    'scope\u007fcontrol',
    'scope\u0085control',
    'scope\u202econtrol',
    'https://user@idp.example/knowledge.write',
    'https://idp.example/knowledge.write?token=synthetic',
    'https://idp.example/knowledge.write#fragment',
    '\tknowledge:write\n',
    '\rknowledge:write\t',
    '\ufeffknowledge:write\ufeff',
    '\u2028knowledge:write\u2029',
    '\u202eknowledge:write',
  ]) {
    assert.throws(
      () =>
        buildUserContextFromJwtPayload({
          sub: 'principal-user',
          act: { sub: 'agent-bot' },
          scp: ['knowledge:write', invalid],
        }),
      /auth_scope_contract_invalid/,
      invalid,
    );
  }
});

test('JWT and configured scope delimiters remain distinct', () => {
  const user = buildUserContextFromJwtPayload({
    sub: 'principal-user',
    act: { sub: 'agent-bot' },
    scp: 'read-only agent:read https://idp.example/knowledge.read',
  });
  assert.deepEqual(user?.auth?.scopes, [
    'read-only',
    'agent:read',
    'https://idp.example/knowledge.read',
  ]);

  for (const scp of [
    'unprivileged,write-limited',
    ['unprivileged,write-limited'],
    'unprivileged\twrite-limited',
    'unprivileged\nwrite-limited',
    'unprivileged\rwrite-limited',
    'unprivileged\fwrite-limited',
    'unprivileged\vwrite-limited',
    '\nwrite-limited\r',
  ]) {
    assert.throws(
      () =>
        buildUserContextFromJwtPayload({
          sub: 'principal-user',
          act: { sub: 'agent-bot' },
          scp,
        }),
      /auth_scope_contract_invalid/,
    );
  }

  assert.deepEqual(
    normalizeConfiguredAgentScopes(' read-only,agent:read,read-only '),
    ['read-only', 'agent:read'],
  );
  assert.throws(
    () => normalizeConfiguredAgentScopes('\twrite-limited'),
    /auth_scope_contract_invalid/,
  );
});

test('buildUserContextFromJwtPayload rejects raw identity aliases before normalization', () => {
  const base = {
    sub: 'principal-user',
    act: { sub: 'agent-bot' },
    scp: ['write-limited'],
    jti: 'token-1',
    aud: ['erp4-agent'],
    iss: 'https://issuer.example',
  };
  const invalidPayloads = [
    { ...base, sub: '\tprincipal-user' },
    { ...base, sub: 'principal-user ' },
    { ...base, sub: undefined, email: '\nprincipal-user' },
    { ...base, act: { sub: ' ' } },
    { ...base, act: { sub: 'agent-bot\n' } },
    { ...base, act: { sub: '\ufeffprincipal-user' }, sub: 'principal-user' },
    { ...base, jti: '\rtoken-1' },
    { ...base, aud: ['erp4-agent\u2028'] },
    { ...base, aud: ['\u202eerp4-agent'] },
    { ...base, aud: Array.from({ length: 101 }, (_, index) => `aud-${index}`) },
    { ...base, aud: 123 },
    { ...base, iss: '\u2029https://issuer.example' },
    { ...base, iss: 'i'.repeat(2_049) },
    { ...base, sub: 'p'.repeat(256) },
    { ...base, sub: '\ud800principal-user' },
    { ...base, act: { sub: '\udc00agent-bot' } },
    { ...base, jti: '\ud800token-1' },
    { ...base, aud: ['\udc00erp4-agent'] },
    { ...base, iss: '\ud800https://issuer.example' },
  ];

  for (const payload of invalidPayloads) {
    assert.throws(
      () => buildUserContextFromJwtPayload(payload),
      /auth_identifier_contract_invalid/,
    );
  }

  assert.throws(
    () =>
      buildUserContextFromJwtPayload({
        ...base,
        sub: 'principal-user',
        act: { sub: '\tprincipal-user' },
      }),
    /auth_identifier_contract_invalid/,
  );

  const emptyActor = buildUserContextFromJwtPayload({
    ...base,
    act: { sub: '' },
  });
  assert.equal(emptyActor?.auth?.actorUserId, 'principal-user');
  assert.equal(emptyActor?.auth?.delegated, false);

  const bounded = buildUserContextFromJwtPayload({
    ...base,
    sub: 'p'.repeat(255),
    act: { sub: 'a'.repeat(255) },
    jti: 't'.repeat(255),
    aud: Array.from({ length: 100 }, (_, index) => `aud-${index}`),
    iss: 'i'.repeat(2_048),
  });
  assert.equal(bounded?.userId, 'p'.repeat(255));
  assert.equal(bounded?.auth?.actorUserId, 'a'.repeat(255));
  assert.equal(bounded?.auth?.tokenId, 't'.repeat(255));
  assert.equal(bounded?.auth?.audience?.length, 100);
  assert.equal(bounded?.auth?.issuer, 'i'.repeat(2_048));
});

test('buildUserContextFromJwtPayload: scopes alone do not mark JWT as delegated', () => {
  const user = buildUserContextFromJwtPayload({
    sub: 'principal-user',
    scp: ['read'],
    roles: ['user'],
    jti: 'tok-scoped-user',
  });

  assert.equal(user?.auth?.principalUserId, 'principal-user');
  assert.equal(user?.auth?.actorUserId, 'principal-user');
  assert.deepEqual(user?.auth?.scopes, ['read']);
  assert.equal(user?.auth?.delegated, false);
});

test('buildUserContextFromJwtPayload: same actor/principal is not delegated even with scopes', () => {
  const user = buildUserContextFromJwtPayload({
    sub: 'principal-user',
    act: { sub: 'principal-user' },
    scp: ['write'],
    roles: ['user'],
    jti: 'tok-self-actor',
  });

  assert.equal(user?.auth?.principalUserId, 'principal-user');
  assert.equal(user?.auth?.actorUserId, 'principal-user');
  assert.deepEqual(user?.auth?.scopes, ['write']);
  assert.equal(user?.auth?.delegated, false);
});

test('evaluateDelegatedScope: read-only scope allows GET', () => {
  const decision = evaluateDelegatedScope(
    {
      userId: 'principal-user',
      roles: ['user'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['read-only'],
        delegated: true,
      },
    },
    'GET',
  );

  assert.equal(decision.allowed, true);
});

test('evaluateDelegatedScope: read-only scope denies POST', () => {
  const decision = evaluateDelegatedScope(
    {
      userId: 'principal-user',
      roles: ['user'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['read-only'],
        delegated: true,
      },
    },
    'POST',
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'scope_denied');
});

test('evaluateDelegatedScope: write-limited scope allows POST', () => {
  const decision = evaluateDelegatedScope(
    {
      userId: 'principal-user',
      roles: ['user'],
      auth: {
        principalUserId: 'principal-user',
        actorUserId: 'agent-bot',
        scopes: ['write-limited'],
        delegated: true,
      },
    },
    'POST',
  );

  assert.equal(decision.allowed, true);
});
