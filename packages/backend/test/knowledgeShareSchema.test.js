import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../prisma/migrations/20260810100000_add_knowledge_selective_share_foundation/migration.sql',
  import.meta.url,
);
const shellUrl = new URL(
  '../../../scripts/test-knowledge-share-old-app.sh',
  import.meta.url,
);
const harnessUrl = new URL(
  '../scripts/knowledge-share-old-app-compat.mjs',
  import.meta.url,
);

const [schema, migration, shell, harness] = await Promise.all([
  readFile(schemaUrl, 'utf8'),
  readFile(migrationUrl, 'utf8'),
  readFile(shellUrl, 'utf8'),
  readFile(harnessUrl, 'utf8'),
]);

test('Knowledge share schema keeps ChatMessageType text-only and uses a side table discriminator', () => {
  assert.match(schema, /enum ChatMessageType\s*\{\s*text\s*\}/s);
  assert.doesNotMatch(schema, /knowledge_share/);
  assert.match(schema, /model KnowledgeShare\s*\{/);
  assert.match(
    schema,
    /chatMessage\s+ChatMessage\?\s+@relation\(fields: \[chatMessageId, destinationRoomId\]/,
  );
  assert.match(migration, /messageType" <> 'text'/);
  assert.match(
    migration,
    /message_row\."userId" IS DISTINCT FROM NEW\."chatPosterUserId"/,
  );
  assert.match(
    migration,
    /message_row\."body" IS DISTINCT FROM 'Knowledge was shared\.'/,
  );
  assert.match(migration, /message_row\."deletedAt" IS NOT NULL/);
  assert.match(
    migration,
    /FROM "ChatMessage"[\s\S]*"roomId" = NEW\."destinationRoomId"[\s\S]*FOR UPDATE;/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER "ChatMessage_knowledge_share_root_immutable_trigger"/,
  );
  assert.match(
    migration,
    /NEW\."deletedReason" IS DISTINCT FROM OLD\."deletedReason"/,
  );
  assert.match(schema, /chatPosterUserId\s+String/);
  assert.match(schema, /dedupeKey\s+String\?\s+@unique/);
  assert.match(migration, /AppNotification_dedupeKey_key/);
  assert.doesNotMatch(migration, /ALTER TYPE "ChatMessageType"/);
});

test('Knowledge share migration fixes bounded hashes, state shape, and immutable history', () => {
  for (const column of [
    'requestKeyHash',
    'requestPayloadHash',
    'selectionHash',
    'contentHash',
  ]) {
    assert.match(
      migration,
      new RegExp(`"${column}" ~ '\\^\\[0-9a-f\\]\\{64\\}\\$'`),
    );
  }
  assert.match(migration, /KnowledgeShare_state_shape_check/);
  assert.match(migration, /KnowledgeShare_state_transition_check/);
  assert.match(migration, /KnowledgeShare_chat_root_check/);
  assert.match(migration, /KnowledgeShare_history_immutable/);
  assert.match(migration, /snapshot can only be appended while pending/);
  assert.match(migration, /KnowledgeShare_nonempty_selection_check/);
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeShare_nonempty_selection_trigger"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  );
  for (const table of [
    'KnowledgeShareSnapshot',
    'KnowledgeShareLabelSnapshot',
    'KnowledgeShareAnnotationSnapshot',
    'KnowledgeShareTurnSnapshot',
    'KnowledgeShareSynthesisSnapshot',
  ]) {
    assert.match(
      migration,
      new RegExp(`FROM "${table}"[\\s\\S]*"shareId" = share\\."id"`),
    );
  }
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE RESTRICT/g);
  assert.match(migration, /AuditLog_knowledge_share_target_check/);
  assert.match(migration, /"targetTable" = 'knowledge_shares'/);
  assert.match(migration, /"targetId" IS NOT NULL/);
  assert.match(migration, /\) NOT VALID;/);
});

test('Knowledge share typed children bind exact source rows and enforce category bounds', () => {
  for (const model of [
    'KnowledgeShareSnapshot',
    'KnowledgeShareLabelSnapshot',
    'KnowledgeShareAnnotationSnapshot',
    'KnowledgeShareTurnSnapshot',
    'KnowledgeShareSynthesisSnapshot',
  ]) {
    assert.match(schema, new RegExp(`model ${model}\\s*\\{`));
    assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
    assert.match(migration, new RegExp(`"${model}_immutable_trigger"`));
  }
  assert.match(migration, /"ordinal" BETWEEN 0 AND 19/);
  assert.match(migration, /"ordinal" BETWEEN 0 AND 49/);
  assert.match(migration, /"ordinal" BETWEEN 0 AND 9/);
  assert.match(migration, /sourceSnapshotVersion/);
  assert.match(migration, /sourceRevisionId/);
  assert.match(migration, /sourceConversationVersion/);
  assert.match(migration, /sourceSynthesisVersionId/);
  assert.match(migration, /source_current_revision <> NEW\."revision"/);
  assert.match(migration, /source_current_version <> NEW\."version"/);
});

test('Knowledge share old-app harness is fixed to the reviewed baseline and ephemeral PostgreSQL', () => {
  assert.match(
    shell,
    /EXPECTED_BASE_SHA="421b38e82fa545e46348c49d0646531f8ddc4cd2"/,
  );
  assert.match(shell, /\.codex-local\/tmp\/knowledge-share-old-app-/);
  assert.match(shell, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(shell, /trap cleanup EXIT INT TERM/);
  assert.match(
    shell,
    /npm run build --prefix "\$OLD_APP_ROOT\/packages\/backend"/,
  );
  assert.doesNotMatch(
    shell,
    /npm run build --prefix "\$ROOT_DIR\/packages\/backend"/,
  );
  assert.match(harness, /sideTableDiscriminator: true/);
  assert.match(harness, /genericTextRoot: true/);
  assert.match(harness, /timeline: true/);
  assert.match(harness, /thread: true/);
  assert.match(harness, /search: true/);
  assert.match(harness, /unread: true/);
  assert.match(harness, /notification: true/);
  assert.match(harness, /createKnowledgeShareUseCases/);
  assert.match(harness, /healthReadiness: true/);
  assert.match(harness, /selectedPrivateCanaryStored: false/);
  assert.match(harness, /directEmptySelectionRejected: true/);
  assert.match(harness, /deferredNestedSelectionAccepted: true/);
});
