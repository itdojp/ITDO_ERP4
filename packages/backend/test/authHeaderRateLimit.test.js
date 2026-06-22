import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
let backendModulesCacheBust = `${Date.now()}-bootstrap`;
let backendModulesPromise = null;

function resetBackendModules() {
  backendModulesCacheBust = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  backendModulesPromise = null;
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetBackendModules();
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function loadBackendModules() {
  if (!backendModulesPromise) {
    backendModulesPromise = import(
      new URL(
        `../dist/server.js?bust=${backendModulesCacheBust}`,
        import.meta.url,
      ).href
    ).then(({ buildServer }) => ({ buildServer }));
  }
  return backendModulesPromise;
}

test('header auth guard flexible limiter honors RATE_LIMIT_AUTH_GUARD_MAX', async () => {
  await withEnv(
    {
      AUTH_MODE: 'header',
      DATABASE_URL: MIN_DATABASE_URL,
      NODE_ENV: 'development',
      RATE_LIMIT_ENABLED: '0',
      RATE_LIMIT_AUTH_GUARD_MAX: '1',
      RATE_LIMIT_AUTH_GUARD_WINDOW: '1 minute',
    },
    async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const request = {
          method: 'GET',
          url: '/me',
          remoteAddress: '198.51.100.250',
          headers: {
            'x-user-id': 'rate-limit-admin',
            'x-roles': 'admin,mgmt',
          },
        };

        const first = await server.inject(request);
        assert.equal(first.statusCode, 200, first.body);

        const second = await server.inject(request);
        assert.equal(second.statusCode, 429, second.body);
        const body = JSON.parse(second.body);
        assert.equal(body.error.code, 'auth_guard_rate_limited');
        assert.equal(body.error.category, 'rate_limit');
      } finally {
        await server.close();
      }
    },
  );
});
