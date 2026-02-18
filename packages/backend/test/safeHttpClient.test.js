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

test('validateExternalUrl allows http when allowHttp is true', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  const url = await validateExternalUrl('http://example.com/path', {
    dnsLookupImpl: publicLookup,
    allowHttp: true,
  });
  assert.equal(url.hostname, 'example.com');
});

test('validateExternalUrl rejects private ip host', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  await assert.rejects(
    validateExternalUrl('https://127.0.0.1/path'),
    (error) => error?.code === 'private_ip_blocked',
  );
});

test('validateExternalUrl rejects metadata endpoint IP', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  await assert.rejects(
    validateExternalUrl('https://169.254.169.254/latest/meta-data'),
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

test('safeFetch propagates caller abort signal', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  const callerController = new AbortController();
  const call = safeFetch(
    'https://example.com/path',
    { signal: callerController.signal },
    {
      dnsLookupImpl: publicLookup,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      },
    },
  );
  callerController.abort();
  await assert.rejects(call, (error) => error?.name === 'AbortError');
});
