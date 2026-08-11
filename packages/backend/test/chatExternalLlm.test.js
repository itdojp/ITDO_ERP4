import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
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

test('summarizeWithExternalLlm blocks private endpoint by default', async () => {
  const { summarizeWithExternalLlm } =
    await import('../dist/services/chatExternalLlm.js');
  await withEnv(
    {
      CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
      CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
      CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://127.0.0.1/v1',
      CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: '',
    },
    async () => {
      await assert.rejects(
        summarizeWithExternalLlm({ bodies: ['hello'] }),
        /private_ip_blocked/,
      );
    },
  );
});

test('summarizeWithExternalLlm uses guarded fetch for allowed host', async () => {
  const { summarizeWithExternalLlm } =
    await import('../dist/services/chatExternalLlm.js');
  let called = false;
  await withHttpServer(
    (_request, response) => {
      called = true;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '- 概要: テスト' } }],
        }),
      );
    },
    async (baseUrl) => {
      await withEnv(
        {
          CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
          CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
          CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: `${baseUrl}/v1`,
          CHAT_EXTERNAL_LLM_ALLOWED_HOSTS: '127.0.0.1',
          CHAT_EXTERNAL_LLM_ALLOW_HTTP: 'true',
          CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: 'true',
        },
        async () => {
          const result = await summarizeWithExternalLlm({ bodies: ['hello'] });
          assert.equal(result.provider, 'openai');
          assert.equal(called, true);
          assert.match(result.summary, /概要/);
        },
      );
    },
  );
});

test('summarizeWithExternalLlm discards provider error bodies', async () => {
  const { summarizeWithExternalLlm } =
    await import('../dist/services/chatExternalLlm.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(
        `token=sk-live-1234567890abcdef secret prompt ${'x'.repeat(2000)}`,
      );
    },
    async (baseUrl) => {
      await withEnv(
        {
          CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
          CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
          CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: `${baseUrl}/v1`,
          CHAT_EXTERNAL_LLM_ALLOWED_HOSTS: '127.0.0.1',
          CHAT_EXTERNAL_LLM_ALLOW_HTTP: 'true',
          CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: 'true',
        },
        async () => {
          await assert.rejects(
            summarizeWithExternalLlm({ bodies: ['secret prompt'] }),
            (error) => {
              assert.equal(error.message, 'openai_error_502');
              assert.equal(error.message.includes('sk-live'), false);
              assert.equal(error.message.includes('secret prompt'), false);
              return true;
            },
          );
        },
      );
    },
  );
});

test('summarizeWithExternalLlm preserves malformed successful response fallback', async () => {
  const { summarizeWithExternalLlm } =
    await import('../dist/services/chatExternalLlm.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{not-json');
    },
    async (baseUrl) => {
      await withEnv(
        {
          CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
          CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
          CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: `${baseUrl}/v1`,
          CHAT_EXTERNAL_LLM_ALLOWED_HOSTS: '127.0.0.1',
          CHAT_EXTERNAL_LLM_ALLOW_HTTP: 'true',
          CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: 'true',
        },
        async () => {
          const result = await summarizeWithExternalLlm({ bodies: ['hello'] });
          assert.equal(result.summary, '要約の生成に失敗しました（空の応答）');
        },
      );
    },
  );
});

test('summarizeWithExternalLlm preserves empty successful response fallback', async () => {
  const { summarizeWithExternalLlm } =
    await import('../dist/services/chatExternalLlm.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [] }));
    },
    async (baseUrl) => {
      await withEnv(
        {
          CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
          CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
          CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: `${baseUrl}/v1`,
          CHAT_EXTERNAL_LLM_ALLOWED_HOSTS: '127.0.0.1',
          CHAT_EXTERNAL_LLM_ALLOW_HTTP: 'true',
          CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: 'true',
        },
        async () => {
          const result = await summarizeWithExternalLlm({ bodies: ['hello'] });
          assert.equal(result.summary, '要約の生成に失敗しました（空の応答）');
        },
      );
    },
  );
});

test('summarizeWithExternalLlm ignores provider usage for Chat compatibility', async () => {
  const { summarizeWithExternalLlm } =
    await import('../dist/services/chatExternalLlm.js');
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '- 概要: テスト' } }],
          usage: { prompt_tokens: 'unknown', completion_tokens: -1 },
        }),
      );
    },
    async (baseUrl) => {
      await withEnv(
        {
          CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
          CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
          CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: `${baseUrl}/v1`,
          CHAT_EXTERNAL_LLM_ALLOWED_HOSTS: '127.0.0.1',
          CHAT_EXTERNAL_LLM_ALLOW_HTTP: 'true',
          CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: 'true',
        },
        async () => {
          const result = await summarizeWithExternalLlm({ bodies: ['hello'] });
          assert.match(result.summary, /概要/);
        },
      );
    },
  );
});
