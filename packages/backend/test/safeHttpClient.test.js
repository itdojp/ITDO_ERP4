import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

const publicLookup = async () => [{ address: '93.184.216.34' }];

async function loadSafeHttpClient() {
  return import('../dist/services/safeHttpClient.js');
}

async function withHttpServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
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

test('safeFetch blocks every 3xx response and sends the default user-agent', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  await withHttpServer(
    (request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/unexpected' });
        response.end();
        return;
      }
      if (request.url === '/redirect-without-location') {
        response.writeHead(302);
        response.end();
        return;
      }
      assert.notEqual(request.url, '/unexpected');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    },
    async (baseUrl) => {
      const res = await safeFetch(
        `${baseUrl}/path`,
        { method: 'POST', body: '{"ok":true}' },
        { allowHttp: true, allowPrivateIp: true },
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/json');

      await assert.rejects(
        safeFetch(
          `${baseUrl}/redirect`,
          {},
          {
            allowHttp: true,
            allowPrivateIp: true,
          },
        ),
        (error) => error?.code === 'redirect_blocked',
      );
      await assert.rejects(
        safeFetch(
          `${baseUrl}/redirect-without-location`,
          {},
          {
            allowHttp: true,
            allowPrivateIp: true,
          },
        ),
        (error) => error?.code === 'redirect_blocked',
      );
    },
  );

  await withHttpServer(
    (request, response) => {
      assert.equal(request.headers['user-agent'], 'ITDO_ERP4/0.1');
      response.end('ok');
    },
    async (baseUrl) => {
      const response = await safeFetch(
        `${baseUrl}/agent`,
        {},
        {
          allowHttp: true,
          allowPrivateIp: true,
        },
      );
      assert.equal(response.status, 200);
    },
  );
});

test('safeFetch propagates caller abort before response headers', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  await withHttpServer(
    (_request, _response) => {
      // Keep the response open until the caller aborts the request.
    },
    async (baseUrl) => {
      const callerController = new AbortController();
      const call = safeFetch(
        `${baseUrl}/stalled`,
        { signal: callerController.signal },
        { allowHttp: true, allowPrivateIp: true },
      );
      callerController.abort();
      await assert.rejects(call, (error) => error?.name === 'AbortError');
    },
  );
});

test('safeFetch propagates caller abort after headers to the response body', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.flushHeaders();
      response.write('partial');
    },
    async (baseUrl) => {
      const callerController = new AbortController();
      const response = await safeFetch(
        `${baseUrl}/stalled-body`,
        { signal: callerController.signal },
        { allowHttp: true, allowPrivateIp: true, timeoutMs: 5000 },
      );
      callerController.abort();
      await assert.rejects(
        response.text(),
        (error) => error?.name === 'AbortError',
      );
    },
  );
});

test('safeFetch timeout remains active while the response body is stalled', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.flushHeaders();
      response.write('partial');
    },
    async (baseUrl) => {
      const startedAt = Date.now();
      const response = await safeFetch(
        `${baseUrl}/timed-out-body`,
        {},
        { allowHttp: true, allowPrivateIp: true, timeoutMs: 30 },
      );
      await assert.rejects(
        response.text(),
        (error) => error?.name === 'AbortError',
      );
      assert.ok(Date.now() - startedAt < 500);
    },
  );
});

test('safeFetch does not treat a prematurely closed response body as success', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, {
        connection: 'close',
        'content-length': '32',
        'content-type': 'text/plain',
      });
      response.flushHeaders();
      response.write('partial');
      setTimeout(() => response.destroy(), 10);
    },
    async (baseUrl) => {
      const response = await safeFetch(
        `${baseUrl}/truncated-body`,
        {},
        { allowHttp: true, allowPrivateIp: true, timeoutMs: 1000 },
      );
      await assert.rejects(response.text());
    },
  );
});

test('safeFetch exposes pinned lookup from validated DNS results', async () => {
  const { createPinnedLookupForTest } = await loadSafeHttpClient();
  const lookup = createPinnedLookupForTest([
    { address: '2001:4860:4860::8888', family: 6 },
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(typeof lookup, 'function');
  let resolved = null;
  lookup('example.com', {}, (err, address, family) => {
    assert.equal(err, null);
    resolved = { address, family };
  });
  assert.deepEqual(resolved, { address: '93.184.216.34', family: 4 });
});
