import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindKnowledgeConversationImportToOwner,
  encodeKnowledgeConversationImportInput,
  KnowledgeConversationImportParserError,
  parseKnowledgeConversationImport,
} from '../dist/application/knowledge/knowledgeConversationImportParser.js';

function turn(overrides = {}) {
  return {
    role: 'user',
    origin: 'user',
    content: 'Synthetic question',
    ...overrides,
  };
}

function manual(overrides = {}) {
  const {
    conversation = {
      title: 'Synthetic conversation',
      turns: [
        turn(),
        turn({ role: 'assistant', origin: 'ai', content: 'Answer' }),
      ],
    },
    linkedItems = [
      { itemId: 'item-1', relationType: 'primary' },
      { itemId: 'item-2', relationType: 'supporting' },
    ],
    ...envelope
  } = overrides;
  return {
    format: 'manual',
    inputBase64: encodeKnowledgeConversationImportInput(
      JSON.stringify(conversation),
    ),
    linkedItems,
    ...envelope,
  };
}

function errorCode(code) {
  return (error) =>
    error instanceof KnowledgeConversationImportParserError &&
    error.code === code;
}

test('manual import normalizes a deterministic canonical model', () => {
  const first = parseKnowledgeConversationImport(manual());
  const second = parseKnowledgeConversationImport(manual());
  assert.deepEqual(first, second);
  assert.equal(first.canonical.version, 1);
  assert.equal(first.canonical.turns[0].sequence, undefined);
  assert.deepEqual(
    first.canonical.linkedItems.map(({ itemId, relationType, ordinal }) => ({
      itemId,
      relationType,
      ordinal,
    })),
    [
      { itemId: 'item-1', relationType: 'primary', ordinal: 0 },
      { itemId: 'item-2', relationType: 'supporting', ordinal: 1 },
    ],
  );
  assert.match(first.canonical.canonicalPayloadHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(first.rejectedFields, []);
});

test('strict JSON import preserves order and accepts fixed public labels', () => {
  const payload = {
    title: 'JSON conversation',
    provider: 'openai',
    model: 'gpt',
    turns: [
      turn({ occurredAt: '2026-08-08T00:00:00Z' }),
      turn({
        role: 'tool',
        origin: 'tool',
        name: 'search',
        content: 'Tool result',
      }),
    ],
  };
  const result = parseKnowledgeConversationImport({
    format: 'json',
    inputBase64: encodeKnowledgeConversationImportInput(
      JSON.stringify(payload),
    ),
    linkedItems: [],
  });
  assert.equal(result.canonical.provider, 'openai');
  assert.equal(result.canonical.model, 'gpt');
  assert.equal(
    result.canonical.turns[0].occurredAt,
    '2026-08-08T00:00:00.000Z',
  );
  assert.equal(result.canonical.turns[1].name, 'search');
});

test('limited Markdown grammar parses role blocks and keeps active text inert', () => {
  const markdown = `# Knowledge Conversation v1
title: Markdown conversation
provider: anthropic
model: claude

## Turn
role: user
origin: external

[reference](https://example.invalid/private) <script>not executed</script>

## Turn
role: assistant
origin: ai

Synthetic answer`;
  const result = parseKnowledgeConversationImport({
    format: 'markdown',
    inputBase64: encodeKnowledgeConversationImportInput(markdown),
    linkedItems: [],
  });
  assert.equal(result.canonical.turns.length, 2);
  assert.match(
    result.canonical.turns[0].content,
    /<script>not executed<\/script>/,
  );
  assert.match(result.canonical.turns[0].content, /example\.invalid/);
});

test('all import formats use canonical base64url and fatal UTF-8 decoding', () => {
  for (const format of ['manual', 'json', 'markdown']) {
    assert.throws(
      () =>
        parseKnowledgeConversationImport({
          format,
          inputBase64: Buffer.from([0xc3, 0x28]).toString('base64url'),
          linkedItems: [],
        }),
      errorCode('invalid_utf8'),
    );
  }
  assert.throws(
    () =>
      parseKnowledgeConversationImport({
        ...manual(),
        inputBase64: `${manual().inputBase64}=`,
      }),
    errorCode('invalid_envelope'),
  );
  assert.throws(
    () =>
      parseKnowledgeConversationImport({
        format: 'manual',
        conversation: { title: 'legacy', turns: [turn()] },
        linkedItems: [],
      }),
    errorCode('invalid_envelope'),
  );
});

test('JSON rejects malformed input, unknown fields, pollution keys, and unknown role/origin', () => {
  for (const [payload, code] of [
    ['{', 'malformed_json'],
    [
      JSON.stringify({ title: 'x', turns: [turn()], unknown: true }),
      'invalid_conversation',
    ],
    [
      '{"title":"x","turns":[],"__proto__":{"polluted":true}}',
      'malformed_json',
    ],
    ['{"title":"first","title":"second","turns":[]}', 'malformed_json'],
    ['{"title":"x","t\\u0075rns":[],"turns":[]}', 'malformed_json'],
    [
      JSON.stringify({ title: 'x', turns: [turn({ role: 'observer' })] }),
      'invalid_turn',
    ],
    [
      JSON.stringify({ title: 'x', turns: [turn({ origin: 'unknown' })] }),
      'invalid_turn',
    ],
  ]) {
    assert.throws(
      () =>
        parseKnowledgeConversationImport({
          format: 'json',
          inputBase64: encodeKnowledgeConversationImportInput(payload),
          linkedItems: [],
        }),
      errorCode(code),
    );
  }
});

test('JSON depth and node bounds fail closed', () => {
  let deep = { title: 'x', turns: [turn()] };
  for (let index = 0; index < 13; index += 1) deep = { nested: deep };
  assert.throws(
    () =>
      parseKnowledgeConversationImport({
        format: 'json',
        inputBase64: encodeKnowledgeConversationImportInput(
          JSON.stringify(deep),
        ),
        linkedItems: [],
      }),
    errorCode('json_limit_exceeded'),
  );
  const nodes = Array.from({ length: 5_001 }, () => ({}));
  assert.throws(
    () =>
      parseKnowledgeConversationImport({
        format: 'json',
        inputBase64: encodeKnowledgeConversationImportInput(
          JSON.stringify(nodes),
        ),
        linkedItems: [],
      }),
    errorCode('json_limit_exceeded'),
  );
});

test('turn, linked-item, per-turn, and canonical byte bounds are enforced', () => {
  assert.throws(
    () =>
      parseKnowledgeConversationImport(
        manual({
          conversation: {
            title: 'x',
            turns: Array.from({ length: 201 }, () => turn()),
          },
        }),
      ),
    errorCode('turn_limit_exceeded'),
  );
  assert.throws(
    () =>
      parseKnowledgeConversationImport(
        manual({
          linkedItems: Array.from({ length: 21 }, (_, index) => ({
            itemId: `item-${index}`,
            relationType: 'context',
          })),
        }),
      ),
    errorCode('linked_item_limit_exceeded'),
  );
  assert.throws(
    () =>
      parseKnowledgeConversationImport(
        manual({
          conversation: {
            title: 'x',
            turns: [turn({ content: 'a'.repeat(65_537) })],
          },
        }),
      ),
    errorCode('invalid_turn'),
  );
  assert.throws(
    () =>
      parseKnowledgeConversationImport(
        manual({
          conversation: {
            title: 'x',
            turns: Array.from({ length: 9 }, (_, index) =>
              turn({ content: `${index}${'a'.repeat(64 * 1024 - 1)}` }),
            ),
          },
          linkedItems: [],
        }),
      ),
    errorCode('input_oversize'),
  );
});

test('linked items reject duplicate IDs and multiple primary relations', () => {
  for (const linkedItems of [
    [
      { itemId: 'item-1', relationType: 'context' },
      { itemId: 'item-1', relationType: 'supporting' },
    ],
    [
      { itemId: 'item-1', relationType: 'primary' },
      { itemId: 'item-2', relationType: 'primary' },
    ],
  ]) {
    assert.throws(
      () => parseKnowledgeConversationImport(manual({ linkedItems })),
      errorCode('invalid_linked_item'),
    );
  }
});

test('turn role/origin/name and timestamp contracts are not inferred', () => {
  for (const candidate of [
    turn({ role: 'user', origin: 'ai' }),
    turn({ role: 'assistant', origin: 'ai', name: 'search' }),
    turn({ role: 'tool', origin: 'tool', name: 'shell' }),
    turn({ occurredAt: 'not-a-date' }),
  ]) {
    assert.throws(
      () =>
        parseKnowledgeConversationImport(
          manual({ conversation: { title: 'x', turns: [candidate] } }),
        ),
      errorCode('invalid_turn'),
    );
  }
});

test('Markdown rejects ambiguous speakers, missing roles, unknown metadata, and line excess', () => {
  const candidates = [
    ['# Knowledge Conversation v1\ntitle: x\n\nUser: body', 'markdown_invalid'],
    [
      '# Knowledge Conversation v1\ntitle: x\n\n## Turn\norigin: user\n\nbody',
      'invalid_turn',
    ],
    [
      '# Knowledge Conversation v1\ntitle: x\nunknown: y\n\n## Turn\nrole: user\norigin: user\n\nbody',
      'markdown_invalid',
    ],
    [
      `# Knowledge Conversation v1\ntitle: x\n\n## Turn\nrole: user\norigin: user\n\n${Array.from({ length: 5_001 }, () => 'x').join('\n')}`,
      'markdown_invalid',
    ],
  ];
  for (const [candidate, code] of candidates) {
    assert.throws(
      () =>
        parseKnowledgeConversationImport({
          format: 'markdown',
          inputBase64: encodeKnowledgeConversationImportInput(candidate),
          linkedItems: [],
        }),
      errorCode(code),
    );
  }
});

test('canonical hash changes with ordering, format, and relations but not imported time', () => {
  const first = parseKnowledgeConversationImport(manual()).canonical;
  const reordered = parseKnowledgeConversationImport(
    manual({
      conversation: {
        title: 'Synthetic conversation',
        turns: [
          turn({ role: 'assistant', origin: 'ai', content: 'Answer' }),
          turn(),
        ],
      },
    }),
  ).canonical;
  const relationChanged = parseKnowledgeConversationImport(
    manual({
      linkedItems: [{ itemId: 'item-1', relationType: 'context' }],
    }),
  ).canonical;
  assert.notEqual(first.canonicalPayloadHash, reordered.canonicalPayloadHash);
  assert.notEqual(
    first.canonicalPayloadHash,
    relationChanged.canonicalPayloadHash,
  );
  assert.equal('importedAt' in first, false);
});

test('application owner binding separates otherwise identical canonical imports', () => {
  const canonical = parseKnowledgeConversationImport(manual()).canonical;
  const first = bindKnowledgeConversationImportToOwner(canonical, 'owner-1');
  const second = bindKnowledgeConversationImportToOwner(canonical, 'owner-2');
  assert.notEqual(first.canonicalPayloadHash, second.canonicalPayloadHash);
  assert.notEqual(first.canonicalPayloadHash, canonical.canonicalPayloadHash);
  assert.equal(first.title, canonical.title);
});
