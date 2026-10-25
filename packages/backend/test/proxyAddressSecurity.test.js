import assert from 'node:assert/strict';
import test from 'node:test';
import proxyaddr from '@fastify/proxy-addr';
import Fastify from 'fastify';

test('proxy trust rejects IPv4 addresses outside mapped IPv6 subnets', () => {
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('203.0.113.42'), false);
    assert.equal(trust('::ffff:203.0.113.42'), false);
  }
});

test('proxy trust lists do not admit unrelated IPv4 or native IPv6 addresses', () => {
  const trust = proxyaddr.compile(['::ffff:10.0.0.0/8', '127.0.0.1']);
  assert.equal(trust('203.0.113.42'), false);
  assert.equal(trust('::ffff:203.0.113.42'), false);
  assert.equal(trust('2001:db8::1'), false);
  assert.equal(trust('127.0.0.1'), true);
});

test('valid mapped IPv6 proxy subnets retain their intended IPv4 boundary', () => {
  for (const subnets of [
    '::ffff:10.0.0.0/104',
    ['::ffff:10.0.0.0/104', '127.0.0.1'],
  ]) {
    const trust = proxyaddr.compile(subnets);
    assert.equal(trust('10.0.0.7'), true);
    assert.equal(trust('::ffff:10.0.0.7'), true);
    assert.equal(trust('203.0.113.42'), false);
    assert.equal(trust('2001:db8::1'), false);
  }
});

test('a short mapped proxy prefix cannot select a forged forwarded address', () => {
  const request = {
    socket: { remoteAddress: '192.0.2.10' },
    headers: { 'x-forwarded-for': '203.0.113.42' },
  };
  assert.equal(proxyaddr(request, '::ffff:10.0.0.0/8'), '192.0.2.10');
});

test('Fastify default request IP ignores untrusted forwarded headers', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.get('/synthetic-ip', async (request) => ({ ip: request.ip }));
  const response = await app.inject({
    method: 'GET',
    url: '/synthetic-ip',
    remoteAddress: '192.0.2.10',
    headers: { 'x-forwarded-for': '203.0.113.42' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ip: '192.0.2.10' });
});
