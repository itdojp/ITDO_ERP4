import assert from 'node:assert/strict';
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
  const originalFetch = globalThis.fetch;
  let called = false;
  try {
    globalThis.fetch = async (_input, _init) => {
      called = true;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '- 概要: テスト' } }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };
    await withEnv(
      {
        CHAT_EXTERNAL_LLM_PROVIDER: 'openai',
        CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'dummy-key',
        CHAT_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://api.openai.com/v1',
        CHAT_EXTERNAL_LLM_ALLOWED_HOSTS: 'api.openai.com',
        CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP: '',
      },
      async () => {
        const result = await summarizeWithExternalLlm({ bodies: ['hello'] });
        assert.equal(result.provider, 'openai');
        assert.equal(called, true);
        assert.match(result.summary, /概要/);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
