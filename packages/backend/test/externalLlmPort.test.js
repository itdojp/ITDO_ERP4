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
  assert.ok(first.usage.inputTokens > 0);
  assert.ok(first.usage.outputTokens > 0);
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

function openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl) {
  return new OpenAiCompatibleTextAdapter({
    apiKey: 'synthetic-only',
    baseUrl,
    timeoutMs: 1_000,
    allowedHosts: ['127.0.0.1'],
    allowHttp: true,
    allowPrivateIp: true,
  });
}

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

test('OpenAI-compatible adapter rejects malformed usage by default', async () => {
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
      await assert.rejects(
        openAiAdapter(OpenAiCompatibleTextAdapter, baseUrl).complete(
          openAiRequest(),
        ),
        (error) => {
          assert.equal(error.code, 'usage_invalid');
          assert.equal(error.outcome, 'known_response');
          return true;
        },
      );
    },
  );
});
