import assert from 'node:assert/strict';
import test from 'node:test';

const publicLookup = async () => [{ address: '93.184.216.34' }];

async function loadSafeHttpClient() {
  return import('../dist/services/safeHttpClient.js');
}

test('validateExternalUrl allows https public host', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  const url = await validateExternalUrl('https://example.com/path', {
    dnsLookupImpl: publicLookup,
  });
  assert.equal(url.hostname, 'example.com');
});

test('validateExternalUrl rejects http by default', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  await assert.rejects(
    validateExternalUrl('http://example.com/path', {
      dnsLookupImpl: publicLookup,
    }),
    (error) => error?.code === 'insecure_scheme',
  );
});

test('validateExternalUrl rejects private ip host', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  await assert.rejects(
    validateExternalUrl('https://127.0.0.1/path'),
    (error) => error?.code === 'private_ip_blocked',
  );
});

test('validateExternalUrl rejects private ip from DNS resolution', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  await assert.rejects(
    validateExternalUrl('https://example.com/path', {
      dnsLookupImpl: async () => [{ address: '10.0.0.20' }],
    }),
    (error) => error?.code === 'private_ip_blocked',
  );
});

test('validateExternalUrl rejects host not in allowlist', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  await assert.rejects(
    validateExternalUrl('https://example.com/path', {
      dnsLookupImpl: publicLookup,
      allowedHosts: ['api.other.example'],
    }),
    (error) => error?.code === 'host_not_allowed',
  );
});

test('safeFetch enforces redirect=error and default user-agent', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  let capturedInit = null;
  const res = await safeFetch(
    'https://example.com/path',
    { method: 'POST', body: '{"ok":true}' },
    {
      dnsLookupImpl: publicLookup,
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );
  assert.equal(res.status, 200);
  assert.equal(capturedInit?.redirect, 'error');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('user-agent'), 'ITDO_ERP4/0.1');
});
