import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';

const request = {
  provider: 'stub',
  model: 'stub-v1',
  systemPrompt: 'Synthetic system instruction',
  userPrompt: 'PRIVATE-CANARY must not be echoed',
  inputTokenCeiling: 2_147_483_647,
  maxOutputTokens: 64,
  temperatureBasisPoints: 0,
};

async function complete(adapter, input) {
  const prepared = await adapter.prepare(input);
  return prepared.dispatch();
}

test('explicit stub adapter is deterministic, local and does not echo prompts', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const adapter = new StubExternalLlmTextAdapter();
  const first = await complete(adapter, request);
  const second = await complete(adapter, request);
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
  const result = await complete(new StubExternalLlmTextAdapter(), {
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
    complete(adapter, { ...request, provider: 'openai' }),
    (error) => {
      assert.equal(error.code, 'rejected_before_dispatch');
      assert.equal(error.outcome, 'not_dispatched');
      return true;
    },
  );
});

test('prepared stub request binds ordered context and is single-use', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const adapter = new StubExternalLlmTextAdapter();
  const prepared = await adapter.prepare({
    ...request,
    contextSections: ['Selected A', 'Selected B'],
  });
  const reordered = await adapter.prepare({
    ...request,
    contextSections: ['Selected B', 'Selected A'],
  });
  assert.equal(
    prepared.requestFingerprint,
    adapter.bind({
      ...request,
      contextSections: ['Selected A', 'Selected B'],
    }).requestFingerprint,
  );
  assert.match(prepared.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(prepared.requestFingerprint, reordered.requestFingerprint);
  const result = await prepared.dispatch();
  assert.equal(result.usageStatus, 'reported');
  await assert.rejects(prepared.dispatch(), (error) => {
    assert.equal(error.code, 'connection_outcome_unknown');
    assert.equal(error.outcome, 'unknown');
    return true;
  });
});

test('canonical provider body preserves context boundaries against delimiter collisions', async () => {
  const {
    externalLlmTextRequestFingerprint,
    externalLlmTextRequestSerializationSchemaVersion,
    serializeExternalLlmTextRequestBody,
  } = await import('../dist/application/externalLlm/externalLlmPort.js');
  const noContext = {
    ...request,
    userPrompt: '[C1]\na\n[U]\nb',
  };
  const oneContext = {
    ...request,
    contextSections: ['a'],
    userPrompt: 'b',
  };
  const embeddedDelimiter = {
    ...request,
    contextSections: ['a\n[C2]\nb'],
    userPrompt: '[U]\nc',
  };
  const twoContexts = {
    ...request,
    contextSections: ['a', 'b'],
    userPrompt: '[U]\nc',
  };

  assert.equal(
    externalLlmTextRequestSerializationSchemaVersion,
    'openai-chat-completions-v2',
  );
  for (const [left, right] of [
    [noContext, oneContext],
    [embeddedDelimiter, twoContexts],
  ]) {
    assert.notEqual(
      serializeExternalLlmTextRequestBody(left),
      serializeExternalLlmTextRequestBody(right),
    );
    assert.notEqual(
      externalLlmTextRequestFingerprint(left),
      externalLlmTextRequestFingerprint(right),
    );
  }

  const parsed = JSON.parse(serializeExternalLlmTextRequestBody(twoContexts));
  assert.deepEqual(parsed.messages, [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: '[C1]\na' },
    { role: 'user', content: '[C2]\nb' },
    { role: 'user', content: '[U]\n[U]\nc' },
  ]);
  const legacyChatBody = JSON.parse(
    serializeExternalLlmTextRequestBody(request),
  );
  assert.deepEqual(legacyChatBody.messages, [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: request.userPrompt },
  ]);
});

test('request and transport fingerprints bind the accepted input usage ceiling', async () => {
  const {
    bindExternalLlmTextRequest,
    bindExternalLlmTextTransportRequest,
    externalLlmTextTransportBindingSchemaVersion,
  } = await import('../dist/application/externalLlm/externalLlmPort.js');
  const lower = { ...request, inputTokenCeiling: 128 };
  const higher = { ...request, inputTokenCeiling: 129 };
  const transport = {
    kind: 'local_stub',
    destination: 'local://erp4/external-llm/stub/v1',
  };

  assert.equal(
    externalLlmTextTransportBindingSchemaVersion,
    'external-llm-text-transport-v2',
  );
  assert.equal(
    bindExternalLlmTextRequest(lower).serializedBody,
    bindExternalLlmTextRequest(higher).serializedBody,
  );
  assert.notEqual(
    bindExternalLlmTextRequest(lower).requestFingerprint,
    bindExternalLlmTextRequest(higher).requestFingerprint,
  );
  assert.notEqual(
    bindExternalLlmTextTransportRequest(lower, transport).requestFingerprint,
    bindExternalLlmTextTransportRequest(higher, transport).requestFingerprint,
  );
});

test('adapter rejects malformed request fields during prepare', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  await assert.rejects(
    new StubExternalLlmTextAdapter().prepare({
      ...request,
      contextSections: [null],
    }),
    (error) => {
      assert.equal(error.code, 'rejected_before_dispatch');
      assert.equal(error.outcome, 'not_dispatched');
      return true;
    },
  );
});

test('canonical external LLM serialization rejects unpaired UTF-16 surrogates without conflating U+FFFD', async () => {
  const {
    externalLlmTextRequestFingerprint,
    externalLlmTextRequestSerializationSchemaVersion,
    serializeExternalLlmTextRequestBody,
  } = await import('../dist/application/externalLlm/externalLlmPort.js');
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const adapter = new StubExternalLlmTextAdapter();
  let dnsLookupCount = 0;
  const openAiAdapterForValidation = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'https://provider.example/v1',
    timeoutMs: 1_000,
    allowedHosts: ['provider.example'],
    allowHttp: false,
    allowPrivateIp: false,
    dnsLookupImpl: async () => {
      dnsLookupCount += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
  });

  const invalidMutations = [
    (value) => ({ ...request, model: `model-${value}` }),
    (value) => ({ ...request, systemPrompt: `system-${value}` }),
    (value) => ({ ...request, userPrompt: `user-${value}` }),
    (value) => ({ ...request, contextSections: [`context-${value}`] }),
  ];
  for (const surrogate of ['\ud800', '\udfff']) {
    for (const mutate of invalidMutations) {
      const invalid = mutate(surrogate);
      assert.throws(
        () => serializeExternalLlmTextRequestBody(invalid),
        /external_llm_request_invalid/,
      );
      assert.throws(
        () => externalLlmTextRequestFingerprint(invalid),
        /external_llm_request_invalid/,
      );
      await assert.rejects(adapter.prepare(invalid), (error) => {
        assert.equal(error.code, 'rejected_before_dispatch');
        assert.equal(error.outcome, 'not_dispatched');
        return true;
      });
      await assert.rejects(
        openAiAdapterForValidation.prepare({
          ...invalid,
          provider: 'openai',
        }),
        (error) => {
          assert.equal(error.code, 'rejected_before_dispatch');
          assert.equal(error.outcome, 'not_dispatched');
          return true;
        },
      );
    }
  }
  assert.equal(dnsLookupCount, 0);

  const replacementCharacterRequest = {
    ...request,
    model: 'stub-\ufffd',
    systemPrompt: 'system-\ufffd',
    userPrompt: 'user-\ufffd',
    contextSections: ['context-\ufffd'],
  };
  assert.equal(
    externalLlmTextRequestSerializationSchemaVersion,
    'openai-chat-completions-v2',
  );
  assert.match(
    serializeExternalLlmTextRequestBody(replacementCharacterRequest),
    /\ufffd/u,
  );
  assert.match(
    externalLlmTextRequestFingerprint(replacementCharacterRequest),
    /^[a-f0-9]{64}$/,
  );
  const prepared = await adapter.prepare(replacementCharacterRequest);
  assert.equal(
    prepared.requestFingerprint,
    adapter.bind(replacementCharacterRequest).requestFingerprint,
  );
});

test('canonical external LLM model identity rejects ECMAScript trim and C0/C1 controls', async () => {
  const {
    externalLlmUnicode15FormatCodePointRanges,
    isCanonicalExternalLlmModel,
  } = await import('../dist/application/externalLlm/externalLlmPort.js');
  assert.equal(isCanonicalExternalLlmModel('x'), true);
  assert.equal(isCanonicalExternalLlmModel('😀'.repeat(200)), true);
  for (const model of [
    '',
    '😀'.repeat(201),
    'stub-default ',
    '\u00a0stub-default\u00a0',
    '\u2003stub-default\u2003',
    '\u3000stub-default\u3000',
    '\ufeffstub-default\ufeff',
    'stub\u00admodel',
    'stub\u200bmodel',
    'stub\u202emodel',
    `stub${String.fromCodePoint(0xe0001)}model`,
    'stub\nmodel',
    `stub${String.fromCodePoint(0x85)}model`,
    '\ud800',
  ]) {
    assert.equal(isCanonicalExternalLlmModel(model), false);
  }
  for (const [first, last] of externalLlmUnicode15FormatCodePointRanges) {
    assert.equal(
      isCanonicalExternalLlmModel(`stub${String.fromCodePoint(first)}model`),
      false,
    );
    assert.equal(
      isCanonicalExternalLlmModel(`stub${String.fromCodePoint(last)}model`),
      false,
    );
  }
});

test('Unicode 15.0 Format ranges are identical in application and migration', async () => {
  const { externalLlmUnicode15FormatCodePointRanges } =
    await import('../dist/application/externalLlm/externalLlmPort.js');
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20260811100000_add_knowledge_llm_budget_foundation/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const rangeBlock = migration.match(
    /ERP4_UNICODE_15_CF_RANGES_BEGIN([\s\S]*?)ERP4_UNICODE_15_CF_RANGES_END/,
  );
  assert.ok(rangeBlock);
  const databaseRanges = [...rangeBlock[1].matchAll(/\((\d+),\s*(\d+)\)/g)].map(
    (match) => [Number(match[1]), Number(match[2])],
  );
  assert.deepEqual(
    databaseRanges,
    externalLlmUnicode15FormatCodePointRanges.map((range) => [...range]),
  );
});

test('external LLM allowlist hosts reject Unicode folding and normalize IPv6 literals', async () => {
  const {
    bindExternalLlmTextTransportRequest,
    canonicalExternalLlmAllowedHost,
    canonicalExternalLlmUrlHostname,
  } = await import('../dist/application/externalLlm/externalLlmPort.js');
  assert.equal(canonicalExternalLlmAllowedHost('API.EXAMPLE'), 'api.example');
  assert.equal(canonicalExternalLlmAllowedHost('K.example'), null);
  assert.equal(canonicalExternalLlmAllowedHost('[2606:4700:4700::1111]'), null);
  assert.equal(
    canonicalExternalLlmAllowedHost('2606:4700:4700:0:0:0:0:1111'),
    '2606:4700:4700::1111',
  );
  assert.equal(canonicalExternalLlmUrlHostname('https://K.example/v1'), null);
  assert.equal(
    canonicalExternalLlmUrlHostname('https://k.example/日本語?q=文書'),
    'k.example',
  );
  assert.equal(
    canonicalExternalLlmUrlHostname('https://user@k.example/v1'),
    null,
  );
  assert.throws(
    () =>
      bindExternalLlmTextTransportRequest(
        { ...request, provider: 'openai' },
        {
          kind: 'openai_compatible_http',
          destination: 'https://k.example/v1/chat/completions',
          allowedHosts: ['K.example'],
          allowHttp: false,
          allowPrivateIp: false,
          timeoutMs: 1_000,
          maximumResponseBytes: 1_024,
          malformedSuccessPolicy: 'reject',
          usagePolicy: 'strict',
        },
      ),
    /external_llm_transport_binding_invalid/,
  );
  assert.throws(
    () =>
      bindExternalLlmTextTransportRequest(
        { ...request, provider: 'openai' },
        {
          kind: 'openai_compatible_http',
          destination: 'https://K.example/v1/chat/completions',
          allowedHosts: ['k.example'],
          allowHttp: false,
          allowPrivateIp: false,
          timeoutMs: 1_000,
          maximumResponseBytes: 1_024,
          malformedSuccessPolicy: 'reject',
          usagePolicy: 'strict',
        },
      ),
    /external_llm_transport_binding_invalid/,
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

test('OpenAI-compatible prepare performs no provider I/O and dispatches exactly once', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const { serializeExternalLlmTextRequestBody } =
    await import('../dist/application/externalLlm/externalLlmPort.js');
  let requestCount = 0;
  let receivedBody = '';
  await withHttpServer(
    (incomingRequest, response) => {
      requestCount += 1;
      incomingRequest.setEncoding('utf8');
      incomingRequest.on('data', (chunk) => {
        receivedBody += chunk;
      });
      incomingRequest.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: 'Synthetic result' } }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
        );
      });
    },
    async (baseUrl) => {
      const input = {
        ...openAiRequest(),
        contextSections: ['Selected context'],
      };
      const adapter = openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl);
      const bound = adapter.bind(input);
      const prepared = await adapter.prepare(input);
      assert.equal(prepared.requestFingerprint, bound.requestFingerprint);
      assert.equal(requestCount, 0);
      const result = await prepared.dispatch();
      assert.equal(result.content, 'Synthetic result');
      assert.equal(receivedBody, serializeExternalLlmTextRequestBody(input));
      assert.equal(requestCount, 1);
      await assert.rejects(prepared.dispatch(), (error) => {
        assert.equal(error.code, 'connection_outcome_unknown');
        assert.equal(error.outcome, 'unknown');
        return true;
      });
      assert.equal(requestCount, 1);
    },
  );
});

test('OpenAI-compatible binding includes canonical destination and transport policy but not API key', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const base = {
    apiKey: 'synthetic-key-a',
    baseUrl: 'https://provider-a.example:443/v1',
    timeoutMs: 1_000,
    allowedHosts: ['provider-b.example', 'PROVIDER-A.EXAMPLE'],
    allowHttp: false,
    allowPrivateIp: false,
    maximumResponseBytes: 32_000,
    malformedSuccessPolicy: 'reject',
    usagePolicy: 'strict',
  };
  const fingerprint = (overrides = {}) =>
    new OpenAiCompatibleTextAdapter({ ...base, ...overrides }).bind(
      openAiRequest(),
    ).requestFingerprint;
  const original = fingerprint();

  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(
    fingerprint({
      apiKey: 'synthetic-key-b',
      baseUrl: 'HTTPS://PROVIDER-A.EXAMPLE/v1',
      allowedHosts: ['provider-a.example', 'provider-b.example'],
    }),
    original,
  );
  for (const overrides of [
    { baseUrl: 'https://provider-b.example/v1' },
    { baseUrl: 'https://provider-a.example/v2' },
    { allowedHosts: ['provider-a.example'] },
    { allowHttp: true },
    { allowPrivateIp: true },
    { timeoutMs: 1_001 },
    { maximumResponseBytes: 32_001 },
    { malformedSuccessPolicy: 'empty' },
    { usagePolicy: 'ignore' },
  ]) {
    assert.notEqual(fingerprint(overrides), original);
  }
});

test('OpenAI-compatible adapter rejects an empty or mismatched host allowlist before dispatch', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  let dnsLookupCount = 0;
  for (const allowedHosts of [
    [],
    ['other-provider.example'],
    ['provider.example', 'bad host'],
  ]) {
    const adapter = new OpenAiCompatibleTextAdapter({
      apiKey: 'synthetic-only',
      baseUrl: 'https://provider.example/v1',
      timeoutMs: 1_000,
      allowedHosts,
      allowHttp: false,
      allowPrivateIp: false,
      dnsLookupImpl: async () => {
        dnsLookupCount += 1;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });
    assert.throws(
      () => adapter.bind(openAiRequest()),
      (error) => {
        assert.equal(error.code, 'rejected_before_dispatch');
        assert.equal(error.outcome, 'not_dispatched');
        return true;
      },
    );
  }
  assert.equal(dnsLookupCount, 0);
});

test('OpenAI-compatible binding compares IPv6 endpoints with an unbracketed canonical allowlist', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const adapter = new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl: 'https://[2606:4700:4700:0:0:0:0:1111]/v1',
    timeoutMs: 1_000,
    allowedHosts: ['2606:4700:4700::1111'],
    allowHttp: false,
    allowPrivateIp: false,
  });
  assert.match(
    adapter.bind(openAiRequest()).requestFingerprint,
    /^[a-f0-9]{64}$/,
  );
});

test('OpenAI-compatible binding rejects credentialed or decorated destinations without provider I/O', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  for (const baseUrl of [
    'https://user:secret@provider.example/v1',
    'https://provider.example/v1?credential=forbidden',
    'https://provider.example/v1#fragment',
  ]) {
    assert.throws(
      () =>
        new OpenAiCompatibleTextAdapter({
          apiKey: 'synthetic-only',
          baseUrl,
          timeoutMs: 1_000,
          allowedHosts: ['provider.example'],
          allowHttp: false,
          allowPrivateIp: false,
        }).bind(openAiRequest()),
      (error) => {
        assert.equal(error.code, 'rejected_before_dispatch');
        assert.equal(error.outcome, 'not_dispatched');
        assert.equal(error.message.includes('secret'), false);
        return true;
      },
    );
  }
});

test('OpenAI-compatible prepared dispatch captures mutable request and config values', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const { serializeExternalLlmTextRequestBody } =
    await import('../dist/application/externalLlm/externalLlmPort.js');
  let receivedAuthorization = '';
  let receivedBody = '';

  await withHttpServer(
    (incomingRequest, response) => {
      receivedAuthorization = incomingRequest.headers.authorization ?? '';
      incomingRequest.setEncoding('utf8');
      incomingRequest.on('data', (chunk) => {
        receivedBody += chunk;
      });
      incomingRequest.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: 'Synthetic result' } }],
          }),
        );
      });
    },
    async (baseUrl) => {
      const config = {
        apiKey: 'original-synthetic-key',
        baseUrl,
        timeoutMs: 1_000,
        allowedHosts: ['127.0.0.1'],
        allowHttp: true,
        allowPrivateIp: true,
        malformedSuccessPolicy: 'reject',
        usagePolicy: 'strict',
      };
      const input = {
        ...openAiRequest(),
        contextSections: ['Original selected context'],
      };
      const originalBody = serializeExternalLlmTextRequestBody(input);
      const prepared = await new OpenAiCompatibleTextAdapter(config).prepare(
        input,
      );

      input.model = 'mutated-model';
      input.systemPrompt = 'mutated system';
      input.userPrompt = 'mutated user';
      input.contextSections[0] = 'mutated context';
      config.apiKey = 'mutated-key';
      config.baseUrl = 'http://must-not-be-used.invalid/v1';
      config.timeoutMs = 1;
      config.allowedHosts[0] = 'must-not-be-used.invalid';
      config.usagePolicy = 'ignore';

      const result = await prepared.dispatch();
      assert.equal(receivedAuthorization, 'Bearer original-synthetic-key');
      assert.equal(receivedBody, originalBody);
      assert.equal(result.model, 'synthetic-openai-model');
      assert.equal(result.usageStatus, 'missing');
    },
  );
});

test('stub prepared dispatch captures mutable request values', async () => {
  const { StubExternalLlmTextAdapter } =
    await import('../dist/adapters/externalLlm/stubTextAdapter.js');
  const input = { ...request };
  const prepared = await new StubExternalLlmTextAdapter().prepare(input);
  input.model = 'mutated-model';
  input.maxOutputTokens = 1;
  const result = await prepared.dispatch();
  assert.equal(result.model, 'stub-v1');
  assert.equal(result.usage.outputTokens, 12);
});

test('OpenAI-compatible adapter classifies a blocked redirect as a known response', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  let requestCount = 0;
  await withHttpServer(
    (_request, response) => {
      requestCount += 1;
      response.writeHead(302, { location: '/must-not-follow' });
      response.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'malformed_response');
          assert.equal(error.outcome, 'known_response');
          assert.equal(error.providerStatus, 302);
          return true;
        },
      );
      assert.equal(requestCount, 1);
    },
  );
});

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
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
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
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl, {
            timeoutMs: 30,
          }),
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'timeout_outcome_unknown');
          assert.equal(error.outcome, 'unknown');
          return true;
        },
      );
    },
  );
});

test('OpenAI-compatible adapter preserves Chat empty fallback after a success body stalls', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"choices":');
    },
    async (baseUrl) => {
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl, {
          timeoutMs: 30,
          malformedSuccessPolicy: 'empty',
          usagePolicy: 'ignore',
        }),
        openAiRequest(),
      );
      assert.equal(result.content, '');
      assert.equal(result.usageStatus, 'ignored');
      assert.equal(result.usage, null);
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
  await assert.rejects(complete(adapter, openAiRequest()), (error) => {
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
  await assert.rejects(complete(adapter, openAiRequest()), (error) => {
    assert.equal(error.code, 'rejected_before_dispatch');
    assert.equal(error.outcome, 'not_dispatched');
    assert.equal(error.preDispatchDiagnostic, 'private_ip_blocked');
    return true;
  });
});

test('OpenAI-compatible prepare sends neither authorization nor prompt to a private DNS result', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  let requestCount = 0;
  await withHttpServer(
    (_request, response) => {
      requestCount += 1;
      response.end();
    },
    async (baseUrl) => {
      const { port } = new URL(baseUrl);
      const adapter = new OpenAiCompatibleTextAdapter({
        apiKey: 'PRIVATE-AUTHORIZATION-CANARY',
        baseUrl: `http://provider.example:${port}/v1`,
        timeoutMs: 1_000,
        allowedHosts: ['provider.example'],
        allowHttp: true,
        allowPrivateIp: false,
        dnsLookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
      });
      await assert.rejects(adapter.prepare(openAiRequest()), (error) => {
        assert.equal(error.code, 'rejected_before_dispatch');
        assert.equal(error.outcome, 'not_dispatched');
        assert.equal(error.preDispatchDiagnostic, 'private_ip_blocked');
        assert.equal(error.message.includes('PRIVATE'), false);
        return true;
      });
      assert.equal(requestCount, 0);
    },
  );
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
  await assert.rejects(complete(adapter, openAiRequest()), (error) => {
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
  await assert.rejects(complete(adapter, openAiRequest()), (error) => {
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
  await assert.rejects(complete(adapter, openAiRequest()), (error) => {
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
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
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
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
        openAiRequest(),
      );
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
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
        openAiRequest(),
      );
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
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
        openAiRequest(),
      );
      assert.equal(result.usageStatus, 'reported');
      assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2 });
    },
  );
});

test('OpenAI-compatible adapter marks usage outside PostgreSQL INTEGER as invalid', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Synthetic result' } }],
          usage: { prompt_tokens: 2_147_483_648, completion_tokens: 0 },
        }),
      );
    },
    async (baseUrl) => {
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
        openAiRequest(),
      );
      assert.equal(result.content, 'Synthetic result');
      assert.equal(result.usageStatus, 'invalid');
      assert.equal(result.usage, null);
    },
  );
});

test('OpenAI-compatible adapter marks output usage beyond the request ceiling as invalid', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const input = openAiRequest();
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Synthetic result' } }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: input.maxOutputTokens + 1,
          },
        }),
      );
    },
    async (baseUrl) => {
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
        input,
      );
      assert.equal(result.content, 'Synthetic result');
      assert.equal(result.usageStatus, 'invalid');
      assert.equal(result.usage, null);
    },
  );
});

test('OpenAI-compatible adapter preserves content and marks input usage beyond the request ceiling invalid', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const input = { ...openAiRequest(), inputTokenCeiling: 10 };
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Synthetic result' } }],
          usage: { prompt_tokens: 11, completion_tokens: 1 },
        }),
      );
    },
    async (baseUrl) => {
      const result = await complete(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
        input,
      );
      assert.equal(result.content, 'Synthetic result');
      assert.equal(result.usageStatus, 'invalid');
      assert.equal(result.usage, null);
    },
  );
});

test('OpenAI-compatible adapter rejects persistence-incompatible successful content', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  for (const content of ['a\u0000b', 'a\ud800b']) {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      },
      async (baseUrl) => {
        await assert.rejects(
          complete(
            openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
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
  }
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
      await assert.rejects(complete(adapter, openAiRequest()), (error) => {
        assert.equal(error.code, 'response_oversize');
        assert.equal(error.outcome, 'known_response');
        return true;
      });
    },
  );
});

test('OpenAI-compatible adapter default rejects responses beyond the Knowledge outcome persistence bound', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const oversized = JSON.stringify({
    choices: [{ message: { content: 'x'.repeat(256 * 1024) } }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  });
  assert.ok(Buffer.byteLength(oversized, 'utf8') > 256 * 1024);
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(oversized);
    },
    async (baseUrl) => {
      await assert.rejects(
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'response_oversize');
          assert.equal(error.outcome, 'known_response');
          return true;
        },
      );
    },
  );
});

test('OpenAI-compatible adapter rejects invalid UTF-8 before replacement decoding can exceed the Knowledge bound', async () => {
  const { OpenAiCompatibleTextAdapter } =
    await import('../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js');
  const raw = Buffer.concat([
    Buffer.from('{"choices":[{"message":{"content":"', 'utf8'),
    Buffer.alloc(100 * 1024, 0x80),
    Buffer.from(
      '"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
      'utf8',
    ),
  ]);
  assert.ok(raw.length < 256 * 1024);
  assert.ok(raw.toString('utf8').includes('\ufffd'));
  assert.ok(Buffer.byteLength(raw.toString('utf8'), 'utf8') > 256 * 1024);
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(raw);
    },
    async (baseUrl) => {
      await assert.rejects(
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
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
      await assert.rejects(complete(adapter, openAiRequest()), (error) => {
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
        complete(
          openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl),
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
