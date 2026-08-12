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
    return await fn(`http://127.0.0.1:${address.port}`, server);
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

test('validateExternalUrl blocks compact mapped, link-local and site-local IPv6 literals', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  for (const literal of [
    '::ffff:7f00:1',
    '::7f00:1',
    'fe90::1',
    'febf::1',
    'fed0::1',
    '2002:7f00:1::',
  ]) {
    await assert.rejects(
      validateExternalUrl(`https://[${literal}]/resource`),
      (error) => error?.code === 'private_ip_blocked',
      literal,
    );
  }
  const publicIpv6 = await validateExternalUrl(
    'https://[2001:4860:4860::8888]/resource',
  );
  assert.equal(publicIpv6.hostname, '[2001:4860:4860::8888]');
});

test('validateExternalUrl rejects IANA non-global special-purpose addresses from literals and DNS', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  const nonGlobalAddresses = [
    '192.0.0.1',
    '192.0.0.8',
    '192.0.0.170',
    '192.0.0.200',
    '192.88.99.2',
    '100:0:0:1::1',
    '2001:5::1',
    '3fff::1',
    '5f00::1',
  ];

  for (const address of nonGlobalAddresses) {
    const literal = address.includes(':') ? `[${address}]` : address;
    await assert.rejects(
      validateExternalUrl(`https://${literal}/resource`),
      (error) => error?.code === 'private_ip_blocked',
      `literal ${address}`,
    );
    await assert.rejects(
      validateExternalUrl('https://provider.example/resource', {
        allowedHosts: ['provider.example'],
        dnsLookupImpl: async () => [{ address }],
      }),
      (error) => error?.code === 'private_ip_blocked',
      `DNS ${address}`,
    );
  }

  for (const globallyReachableException of ['192.0.0.9', '192.0.0.10']) {
    const url = await validateExternalUrl(
      `https://${globallyReachableException}/resource`,
    );
    assert.equal(url.hostname, globallyReachableException);
  }
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

test('validateExternalUrl rejects raw Unicode or userinfo authorities before URL normalization', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  for (const url of [
    'https://K.example/path',
    'https://例.example/path',
    'https://user@provider.example/path',
  ]) {
    await assert.rejects(
      validateExternalUrl(url, {
        allowedHosts: ['k.example'],
        dnsLookupImpl: publicLookup,
      }),
      (error) => error?.code === 'invalid_url',
    );
  }
  const unicodePath = await validateExternalUrl(
    'https://provider.example/日本語?q=文書',
    {
      allowedHosts: ['provider.example'],
      dnsLookupImpl: publicLookup,
    },
  );
  assert.equal(unicodePath.hostname, 'provider.example');
});

test('validateExternalUrl canonicalizes equivalent direct IPv6 allowlist forms', async () => {
  const { validateExternalUrl } = await loadSafeHttpClient();
  const url = await validateExternalUrl(
    'https://[2606:4700:4700::1111]/resource',
    {
      allowedHosts: ['2606:4700:4700:0:0:0:0:1111'],
      allowPrivateIp: true,
    },
  );
  assert.equal(url.hostname, '[2606:4700:4700::1111]');
});

test('safeFetch bounds DNS lookup time before dispatch', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  await assert.rejects(
    safeFetch(
      'https://dns-timeout.example.test/resource',
      {},
      {
        timeoutMs: 20,
        allowedHosts: ['dns-timeout.example.test'],
        dnsLookupImpl: () => new Promise(() => {}),
      },
    ),
    (error) => error?.code === 'pre_dispatch_timeout',
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

test('safeFetch destroys a trickling 3xx response instead of leaving its socket open', async () => {
  const { safeFetch } = await loadSafeHttpClient();
  let resolveResponseClosed;
  const responseClosed = new Promise((resolve) => {
    resolveResponseClosed = resolve;
  });
  let emitted = 0;

  await withHttpServer(
    (_request, response) => {
      response.writeHead(302, { location: '/never-followed' });
      response.flushHeaders();
      const interval = setInterval(() => {
        emitted += 1;
        response.write('x');
      }, 10);
      response.once('close', () => {
        clearInterval(interval);
        resolveResponseClosed();
      });
    },
    async (baseUrl, server) => {
      await assert.rejects(
        safeFetch(
          `${baseUrl}/trickling-redirect`,
          {},
          {
            allowHttp: true,
            allowPrivateIp: true,
            timeoutMs: 50,
          },
        ),
        (error) => error?.code === 'redirect_blocked',
      );

      let timeout;
      try {
        await Promise.race([
          responseClosed,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('redirect response socket remained open')),
              500,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      const emittedAtClose = emitted;
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(emitted, emittedAtClose);
      assert.equal(
        await new Promise((resolve, reject) => {
          server.getConnections((error, count) => {
            if (error) reject(error);
            else resolve(count);
          });
        }),
        0,
      );
    },
  );
});

test('safeFetch represents HTTP 204 and 205 responses with a null body', async () => {
  const { safeFetch } = await loadSafeHttpClient();

  for (const status of [204, 205]) {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(status);
        response.end();
      },
      async (baseUrl) => {
        const response = await safeFetch(
          `${baseUrl}/null-body`,
          {},
          { allowHttp: true, allowPrivateIp: true },
        );
        assert.equal(response.status, status);
        assert.equal(response.body, null);
        assert.equal(await response.text(), '');
      },
    );
  }
});

test('safeFetch rejects invalid HTTP response status without an uncaught exception', async () => {
  const { safeFetch } = await loadSafeHttpClient();

  await withHttpServer(
    (_request, response) => {
      response.writeHead(600);
      response.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        safeFetch(
          `${baseUrl}/invalid-status`,
          {},
          { allowHttp: true, allowPrivateIp: true },
        ),
        (error) => error?.code === 'invalid_response',
      );
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

  let allResolved = null;
  lookup('example.com', { all: true }, (err, addresses) => {
    assert.equal(err, null);
    allResolved = addresses;
  });
  assert.deepEqual(allResolved, [
    { address: '2001:4860:4860::8888', family: 6 },
    { address: '93.184.216.34', family: 4 },
  ]);

  let ipv6Resolved = null;
  lookup('example.com', { family: 6 }, (err, address, family) => {
    assert.equal(err, null);
    ipv6Resolved = { address, family };
  });
  assert.deepEqual(ipv6Resolved, {
    address: '2001:4860:4860::8888',
    family: 6,
  });
});

test('prepared safe request performs DNS validation without socket I/O and dispatches once through the pinned hostname', async () => {
  const { prepareSafeFetch } = await loadSafeHttpClient();
  let requestCount = 0;
  await withHttpServer(
    (_request, response) => {
      requestCount += 1;
      response.end('ok');
    },
    async (baseUrl) => {
      const { port } = new URL(baseUrl);
      const prepared = await prepareSafeFetch(
        `http://provider.example:${port}/prepared`,
        { method: 'POST', body: 'synthetic' },
        {
          allowHttp: true,
          allowPrivateIp: true,
          allowedHosts: ['provider.example'],
          dnsLookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
        },
      );
      assert.equal(requestCount, 0);
      const response = await prepared.dispatch();
      assert.equal(await response.text(), 'ok');
      assert.equal(requestCount, 1);
      await assert.rejects(
        prepared.dispatch(),
        (error) => error?.code === 'request_already_dispatched',
      );
      assert.equal(requestCount, 1);
    },
  );
});

test('prepared safe request starts the full network timeout at dispatch', async () => {
  const { prepareSafeFetch } = await loadSafeHttpClient();
  let requestCount = 0;
  await withHttpServer(
    (_request, response) => {
      requestCount += 1;
      response.end('ok');
    },
    async (baseUrl) => {
      const { port } = new URL(baseUrl);
      const timeoutMs = 80;
      const prepared = await prepareSafeFetch(
        `http://provider.example:${port}/delayed-dispatch`,
        { method: 'POST', body: 'synthetic' },
        {
          allowHttp: true,
          allowPrivateIp: true,
          allowedHosts: ['provider.example'],
          dnsLookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
          timeoutMs,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 40));
      const response = await prepared.dispatch();
      assert.equal(await response.text(), 'ok');
      assert.equal(requestCount, 1);
    },
  );
});
