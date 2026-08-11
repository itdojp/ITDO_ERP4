import assert from 'node:assert/strict';
import test from 'node:test';

const contextModule = () =>
  import('../dist/application/knowledge/knowledgeLlmContext.js');

function source(overrides = {}) {
  return {
    ordinal: 0,
    sourceType: 'conversation_turn',
    sourceId: 'synthetic-turn',
    exactSourceVersion: 1,
    exactSourceHash: 'a'.repeat(64),
    representationHash: 'b'.repeat(64),
    byteLength: 12,
    estimatedTokens: 40,
    ...overrides,
  };
}

test('context fingerprint is opaque, ordinal-sensitive and deterministic', async () => {
  const { knowledgeLlmContextFingerprint } = await contextModule();
  const first = source();
  const second = source({
    ordinal: 1,
    sourceId: 'synthetic-turn-2',
    exactSourceHash: 'c'.repeat(64),
  });
  const expected = knowledgeLlmContextFingerprint([first, second]);
  assert.match(expected, /^[0-9a-f]{64}$/);
  assert.equal(knowledgeLlmContextFingerprint([second, first]), expected);
  assert.notEqual(
    knowledgeLlmContextFingerprint([
      { ...first, ordinal: 1 },
      { ...second, ordinal: 0 },
    ]),
    expected,
  );
  assert.notEqual(
    knowledgeLlmContextFingerprint([
      first,
      { ...second, sourceId: 'synthetic-turn-3' },
    ]),
    expected,
  );
  assert.notEqual(
    knowledgeLlmContextFingerprint([
      first,
      { ...second, representationHash: 'd'.repeat(64) },
    ]),
    expected,
  );
});

test('context representation hash and conservative framing estimate are fixed', async () => {
  const {
    knowledgeLlmContextEstimatedTokens,
    knowledgeLlmContextRepresentationHash,
  } = await contextModule();
  assert.equal(knowledgeLlmContextEstimatedTokens(12), 40);
  assert.equal(
    knowledgeLlmContextRepresentationHash('Synthetic'),
    knowledgeLlmContextRepresentationHash('Synthetic'),
  );
  assert.notEqual(
    knowledgeLlmContextRepresentationHash('Synthetic'),
    knowledgeLlmContextRepresentationHash('Synthetic changed'),
  );
  assert.throws(
    () => knowledgeLlmContextEstimatedTokens(0),
    /invalid_knowledge_llm_context_bytes/,
  );
});

test('selected context derives fingerprint, representation hash and tokens from one ordered structure', async () => {
  const {
    deriveKnowledgeLlmSelectedContext,
    knowledgeLlmContextFingerprint,
    knowledgeLlmContextRepresentationHash,
  } = await contextModule();
  const selected = [
    {
      sourceType: 'conversation_turn',
      sourceId: 'synthetic-turn',
      exactSourceVersion: 1,
      exactSourceHash: 'a'.repeat(64),
      representation: 'Synthetic',
    },
  ];
  const derived = deriveKnowledgeLlmSelectedContext(selected);
  assert.deepEqual(derived.representations, ['Synthetic']);
  assert.equal(derived.sources[0].ordinal, 0);
  assert.equal(
    derived.sources[0].representationHash,
    knowledgeLlmContextRepresentationHash('Synthetic'),
  );
  assert.equal(
    derived.fingerprint,
    knowledgeLlmContextFingerprint(derived.sources),
  );
  assert.notEqual(
    deriveKnowledgeLlmSelectedContext([
      { ...selected[0], representation: 'Synthetic changed' },
    ]).fingerprint,
    derived.fingerprint,
  );
  assert.throws(
    () => deriveKnowledgeLlmSelectedContext([selected[0], selected[0]]),
    /invalid_knowledge_llm_context/,
  );
});
