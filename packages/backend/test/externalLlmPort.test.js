import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

const request = {
  provider: 'stub',
  model: 'stub-v1',
  systemPrompt: 'Synthetic system instruction',
  userPrompt: 'PRIVATE-CANARY must not be echoed',
  maxOutputTokens: 64,
  temperatureBasisPoints: 0,
};

test('explicit stub adapter is deterministic, local and does not echo prompts', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const adapter = new StubExternalLlmTextAdapter();
  const first = await adapter.complete(request);
  const second = await adapter.complete(request);
  assert.deepEqual(second, first);
  assert.equal(first.provider, 'stub');
  assert.equal(first.model, 'stub-v1');
  assert.equal(first.content.includes('PRIVATE-CANARY'), false);
  assert.equal(first.usageStatus, 'reported');
  assert.ok(first.usage.inputTokens > 0);
  assert.ok(first.usage.outputTokens > 0);
});

test('stub adapter never exceeds a small requested output limit', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const result = await new StubExternalLlmTextAdapter().complete({
    ...request,
    maxOutputTokens: 1,
  });
  assert.equal(result.usage.outputTokens, 1);
  assert.equal(result.content.length, 1);
});

test('stub adapter rejects another provider before dispatch', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const adapter = new StubExternalLlmTextAdapter();
  await assert.rejects(
    adapter.complete({ ...request, provider: 'openai' }),
    (error) => {
      assert.equal(error.code, 'rejected_before_dispatch');
      assert.equal(error.outcome, 'not_dispatched');
      return true;
    },
  );
});

async function withHttpServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    return await callback(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function openAiRequest() {
  return {
    ...request,
    provider: 'openai',
    model: 'synthetic-openai-model',
  };
}

function openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl, overrides = {}) {
  return new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl,
    timeoutMs: 1_000,
    allowedHosts: ['127.0.0.1'],
    allowHttp: true,
    allowPrivateIp: true,
    ...overrides,
  });
}

test('OpenAI-compatible adapter rejects an empty successful result', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [] }));
    },
    async (baseUrl) => {
      await assert.rejects(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl).complete(
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'empty_result');
          assert.equal(error.outcome, 'known_response');
          assert.equal(error.providerStatus, 200);
          return true;
        },
      );
    },
  );
});

test('OpenAI-compatible adapter normalizes a stalled response body timeout', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"choices":');
    },
    async (baseUrl) => {
      await assert.rejects(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl, {
          timeoutMs: 30,
        }).complete(openAiRequest()),
        (error) => {
          assert.equal(error.code, 'timeout_outcome_unknown');
          assert.equal(error.outcome, 'unknown');
          return true;
        },
      );
    },
  );
});

test('OpenAI-compatible adapter classifies DNS lookup failure before dispatch', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'https://dns-failure.example/v1',
    timeoutMs: 1_000,
    allowedHosts: ['dns-failure.example'],
    allowHttp: false,
    allowPrivateIp: false,
    dnsLookupImpl: async () => {
      throw new Error('synthetic lookup failure');
    },
  });
  await assert.rejects(adapter.complete(openAiRequest()), (error) => {
    assert.equal(error.code, 'rejected_before_dispatch');
    assert.equal(error.outcome, 'not_dispatched');
    return true;
  });
});

test('OpenAI-compatible adapter normalizes private-address guard failure before dispatch', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'https://127.0.0.1/v1',
    timeoutMs: 1_000,
    allowedHosts: ['127.0.0.1'],
    allowHttp: false,
    allowPrivateIp: false,
  });
  await assert.rejects(adapter.complete(openAiRequest()), (error) => {
    assert.equal(error.code, 'rejected_before_dispatch');
    assert.equal(error.outcome, 'not_dispatched');
    assert.equal(error.preDispatchDiagnostic, 'private_ip_blocked');
    return true;
  });
});

test('OpenAI-compatible adapter classifies DNS failure before dispatch when private IPs are allowed', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'http://dns-failure.example/v1',
    timeoutMs: 1_000,
    allowedHosts: ['dns-failure.example'],
    allowHttp: true,
    allowPrivateIp: true,
    dnsLookupImpl: async () => {
      throw new Error('synthetic lookup failure');
    },
  });
  await assert.rejects(adapter.complete(openAiRequest()), (error) => {
    assert.equal(error.code, 'rejected_before_dispatch');
    assert.equal(error.outcome, 'not_dispatched');
    assert.equal(error.preDispatchDiagnostic, 'dns_lookup_failed');
    return true;
  });
});

test('OpenAI-compatible adapter classifies DNS timeout before dispatch', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'https://dns-timeout.example/v1',
    timeoutMs: 20,
    allowedHosts: ['dns-timeout.example'],
    allowHttp: false,
    allowPrivateIp: false,
    dnsLookupImpl: () => new Promise(() => {}),
  });
  await assert.rejects(adapter.complete(openAiRequest()), (error) => {
    assert.equal(error.code, 'rejected_before_dispatch');
    assert.equal(error.outcome, 'not_dispatched');
    assert.equal(error.preDispatchDiagnostic, 'pre_dispatch_timeout');
    return true;
  });
});

test('OpenAI-compatible adapter rejects an invalid response limit before dispatch', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  let lookupCalls = 0;
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'https://not-dispatched.example/v1',
    timeoutMs: 1_000,
    allowedHosts: ['not-dispatched.example'],
    allowHttp: false,
    allowPrivateIp: false,
    maximumResponseBytes: Number.MAX_SAFE_INTEGER,
    dnsLookupImpl: async () => {
      lookupCalls += 1;
      return [{ address: '203.0.113.10', family: 4 }];
    },
  });
  await assert.rejects(adapter.complete(openAiRequest()), (error) => {
    assert.equal(error.code, 'rejected_before_dispatch');
    assert.equal(error.outcome, 'not_dispatched');
    return true;
  });
  assert.equal(lookupCalls, 0);
});

test('OpenAI-compatible adapter rejects malformed successful JSON by default', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{not-json');
    },
    async (baseUrl) => {
      await assert.rejects(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl).complete(
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'malformed_response');
          assert.equal(error.outcome, 'known_response');
          assert.equal(error.providerStatus, 200);
          return true;
        },
      );
    },
  );
});

test('OpenAI-compatible adapter preserves content and marks malformed usage invalid', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Synthetic result' } }],
          usage: { prompt_tokens: 'unknown', completion_tokens: -1 },
        }),
      );
    },
    async (baseUrl) => {
      const result = await openAiAdapter(
        OpenAiCompatibleTextAdapter,
        baseUrl,
      ).complete(openAiRequest());
      assert.deepEqual(
        {
          content: result.content,
          usageStatus: result.usageStatus,
          usage: result.usage,
        },
        {
          content: 'Synthetic result',
          usageStatus: 'invalid',
          usage: null,
        },
      );
    },
  );
});

test('OpenAI-compatible adapter preserves content and marks missing usage', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Synthetic result' } }],
        }),
      );
    },
    async (baseUrl) => {
      const result = await openAiAdapter(
        OpenAiCompatibleTextAdapter,
        baseUrl,
      ).complete(openAiRequest());
      assert.equal(result.content, 'Synthetic result');
      assert.equal(result.usageStatus, 'missing');
      assert.equal(result.usage, null);
    },
  );
});

test('OpenAI-compatible adapter returns strictly parsed reported usage', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Synthetic result' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
      );
    },
    async (baseUrl) => {
      const result = await openAiAdapter(
        OpenAiCompatibleTextAdapter,
        baseUrl,
      ).complete(openAiRequest());
      assert.equal(result.usageStatus, 'reported');
      assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2 });
    },
  );
});

test('OpenAI-compatible adapter rejects a response beyond the byte limit even when its prefix is valid JSON', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const valid = JSON.stringify({
    choices: [{ message: { content: 'Synthetic result' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  });
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${valid}${' '.repeat(128)}`);
    },
    async (baseUrl) => {
      const adapter = new OpenAiCompatibleTextAdapter({
        apiKey: 'synthetic-only',
        baseUrl,
        timeoutMs: 1_000,
        allowedHosts: ['127.0.0.1'],
        allowHttp: true,
        allowPrivateIp: true,
        maximumResponseBytes: Buffer.byteLength(valid, 'utf8'),
      });
      await assert.rejects(adapter.complete(openAiRequest()), (error) => {
        assert.equal(error.code, 'response_oversize');
        assert.equal(error.outcome, 'known_response');
        return true;
      });
    },
  );
});

test('OpenAI-compatible adapter measures an oversized BOM response before UTF-8 decoding', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const valid = JSON.stringify({
    choices: [{ message: { content: 'Synthetic result' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  });
  const raw = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(valid, 'utf8'),
    Buffer.from(' ', 'utf8'),
  ]);
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write(raw.subarray(0, 2));
      response.write(raw.subarray(2, raw.length - 1));
      response.end(raw.subarray(raw.length - 1));
    },
    async (baseUrl) => {
      const adapter = new OpenAiCompatibleTextAdapter({
        apiKey: 'synthetic-only',
        baseUrl,
        timeoutMs: 1_000,
        allowedHosts: ['127.0.0.1'],
        allowHttp: true,
        allowPrivateIp: true,
        maximumResponseBytes: raw.length - 1,
      });
      await assert.rejects(adapter.complete(openAiRequest()), (error) => {
        assert.equal(error.code, 'response_oversize');
        assert.equal(error.outcome, 'known_response');
        return true;
      });
    },
  );
});

test('OpenAI-compatible adapter never exposes provider error bodies', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(
        'Synthetic prompt reflection: confidential; api_key=sk-live-1234567890abcdef',
      );
    },
    async (baseUrl) => {
      await assert.rejects(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl).complete(
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'provider_5xx');
          assert.equal(error.outcome, 'known_response');
          assert.equal(error.providerStatus, 502);
          assert.equal(error.message, 'provider_5xx');
          assert.equal(error.message.includes('confidential'), false);
          assert.equal(error.message.includes('sk-live'), false);
          return true;
        },
      );
    },
  );
});
