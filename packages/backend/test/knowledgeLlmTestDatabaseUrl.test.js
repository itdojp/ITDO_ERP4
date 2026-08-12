import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { validateKnowledgeLlmTestDatabaseUrl } from '../scripts/validate-knowledge-llm-test-database-url.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scratchParent = fileURLToPath(
  new URL('../../../.codex-local/tmp/', import.meta.url),
);

test('Knowledge LLM external database URL accepts only the exact local ephemeral database', () => {
  assert.doesNotThrow(() =>
    validateKnowledgeLlmTestDatabaseUrl(
      'postgresql://user:pass@127.0.0.1:5432/erp4_knowledge_llm_budget?schema=public',
      'erp4_knowledge_llm_budget',
    ),
  );
  for (const url of [
    'postgresql://user:secret-canary@example.test:5432/erp4_knowledge_llm_budget?schema=public',
    'postgresql://user:secret-canary@localhost:5432/production?schema=public',
    'postgresql://user:secret-canary@localhost:5432/erp4_knowledge_llm_budget?schema=private',
    'postgresql://user:secret-canary@localhost:5432/erp4_knowledge_llm_budget?schema=public&schema=private',
    'postgresql://user:secret-canary@localhost:5432/erp4_knowledge_llm_budget?schema=public&host=example.test',
    'postgresql://user:secret-canary@localhost:5432/erp4_knowledge_llm_budget?schema=public&hostaddr=203.0.113.1',
    'postgresql://user:secret-canary@localhost:5432/erp4_knowledge_llm_budget?schema=public&port=5433',
    'http://localhost/erp4_knowledge_llm_budget?schema=public',
  ]) {
    assert.throws(
      () =>
        validateKnowledgeLlmTestDatabaseUrl(url, 'erp4_knowledge_llm_budget'),
      /knowledge_llm_test_database_url_invalid/,
    );
  }
});

for (const fixture of [
  {
    name: 'budget integration',
    script: 'scripts/test-knowledge-llm-budget-postgres.sh',
    envName: 'KNOWLEDGE_LLM_TEST_DATABASE_URL',
  },
  {
    name: 'old-application compatibility',
    script: 'scripts/test-knowledge-llm-old-app.sh',
    envName: 'KNOWLEDGE_LLM_OLD_APP_TEST_DATABASE_URL',
  },
]) {
  test(`${fixture.name} rejects a non-ephemeral URL before npm or Prisma`, async () => {
    await mkdir(scratchParent, { recursive: true });
    const scratch = await mkdtemp(`${scratchParent}knowledge-llm-db-guard-`);
    try {
      const fakeNpm = `${scratch}/npm`;
      await writeFile(
        fakeNpm,
        '#!/bin/sh\necho UNSAFE_MIGRATION_COMMAND_REACHED >&2\nexit 97\n',
      );
      await chmod(fakeNpm, 0o700);
      const secretCanary = 'database-password-secret-canary';
      const result = spawnSync('bash', [fixture.script], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${scratch}:${process.env.PATH ?? ''}`,
          [fixture.envName]: `postgresql://user:${secretCanary}@example.test:5432/production?schema=public`,
        },
      });
      const output = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.status, 0);
      assert.equal(output.includes('UNSAFE_MIGRATION_COMMAND_REACHED'), false);
      assert.equal(output.includes(secretCanary), false);
      assert.match(output, /allowlisted local ephemeral database/);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
