import { pathToFileURL } from 'node:url';

const allowedDatabases = new Set([
  'erp4_knowledge_llm_budget',
  'erp4_knowledge_llm_old_app',
]);

export function validateKnowledgeLlmTestDatabaseUrl(raw, expectedDatabase) {
  if (!allowedDatabases.has(expectedDatabase)) {
    throw new Error('knowledge_llm_test_database_url_invalid');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('knowledge_llm_test_database_url_invalid');
  }
  if (
    parsed.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    parsed.pathname !== `/${expectedDatabase}` ||
    parsed.hash !== '' ||
    parsed.searchParams.getAll('schema').length !== 1 ||
    parsed.searchParams.get('schema') !== 'public'
  ) {
    throw new Error('knowledge_llm_test_database_url_invalid');
  }
}

function main() {
  try {
    validateKnowledgeLlmTestDatabaseUrl(
      process.env.KNOWLEDGE_LLM_TEST_DATABASE_URL_TO_VALIDATE ?? '',
      process.argv[2] ?? '',
    );
  } catch {
    // Never echo a URL because it may contain a password.
    console.error(
      'Knowledge LLM test database URL is not an allowlisted local ephemeral database',
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
