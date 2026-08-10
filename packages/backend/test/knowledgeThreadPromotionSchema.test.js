import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../prisma/migrations/20260810130000_add_knowledge_thread_promotion/migration.sql',
  import.meta.url,
);
const integrationUrl = new URL(
  '../scripts/knowledge-thread-promotion-schema-integration.mjs',
  import.meta.url,
);
const integrationWrapperUrl = new URL(
  '../../../scripts/test-knowledge-thread-promotion-schema-postgres.sh',
  import.meta.url,
);

const [schema, migration, integration, integrationWrapper] = await Promise.all([
  readFile(schemaUrl, 'utf8'),
  readFile(migrationUrl, 'utf8'),
  readFile(integrationUrl, 'utf8'),
  readFile(integrationWrapperUrl, 'utf8'),
]);

function schemaBlock(kind, name) {
  const match = schema.match(
    new RegExp(`\\b${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `${kind} ${name} must exist`);
  return match[1];
}

test('thread promotion is an independent typed aggregate with selected-only snapshots', () => {
  const promotion = schemaBlock('model', 'KnowledgeThreadPromotion');
  const selected = schemaBlock('model', 'KnowledgeThreadPromotionMessage');
  const authorCategory = schemaBlock(
    'enum',
    'KnowledgeThreadPromotionAuthorCategory',
  );

  for (const model of [
    'KnowledgeThreadPromotion',
    'KnowledgeThreadPromotionMessage',
    'KnowledgeThreadPromotionRequest',
    'KnowledgeSynthesisGroupGrant',
  ]) {
    assert.match(schemaBlock('model', model), /id\s+String\s+@id/);
    assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
  }

  for (const value of ['user', 'external', 'system']) {
    assert.match(authorCategory, new RegExp(`\\b${value}\\b`));
  }
  assert.doesNotMatch(authorCategory, /\b(?:ai|tool)\b/);

  for (const field of [
    'sourceShareId',
    'sourceShareVersion',
    'sourceShareContentHash',
    'sourceRoomId',
    'sourceRootMessageId',
    'promoterUserId',
    'ownerUserId',
    'destinationSynthesisId',
    'destinationSynthesisVersionId',
    'selectionHash',
    'contentHash',
    'includesSharedCard',
    'selectedMessageCount',
    'destinationGrantHash',
  ]) {
    assert.match(promotion, new RegExp(`\\b${field}\\s+`), field);
  }

  for (const field of [
    'sourceActivitySequence',
    'sourceMessageCreatedAt',
    'ordinal',
    'authorCategory',
    'content',
    'contentHash',
  ]) {
    assert.match(selected, new RegExp(`\\b${field}\\s+`), field);
  }
  assert.doesNotMatch(selected, /provider|metadata|requestKey/i);
  assert.match(migration, /KnowledgeThreadPromotionMessage_snapshot_check/);
  assert.match(migration, /"ordinal" BETWEEN 0 AND 99/);
  assert.match(migration, /OCTET_LENGTH\("content"\) BETWEEN 1 AND 65536/);
});

test('shared-card inclusion is explicit and part of the canonical content-hash contract', () => {
  const promotion = schemaBlock('model', 'KnowledgeThreadPromotion');
  assert.match(promotion, /includesSharedCard\s+Boolean\s+@default\(false\)/);
  assert.match(
    migration,
    /"includesSharedCard" BOOLEAN NOT NULL DEFAULT false/,
  );
  assert.match(
    migration,
    /KnowledgeThreadPromotion_content_binding_check[\s\S]*?"contentHash" ~ '\^\[0-9a-f\]\{64\}\$'[\s\S]*?"includesSharedCard"/,
  );
  assert.match(
    migration,
    /COMMENT ON COLUMN "KnowledgeThreadPromotion"\."contentHash"[\s\S]*?including includesSharedCard, ordered selected reply hashes, destination scope and grant hash/,
  );
});

test('promotion source extends the existing exactly-one FK provenance contract', () => {
  const source = schemaBlock('model', 'KnowledgeSynthesisSource');
  assert.match(source, /sourceThreadPromotion\s+KnowledgeThreadPromotion\?/);
  assert.match(source, /sourceThreadPromotionId\s+String\?\s+@unique/);
  assert.doesNotMatch(source, /\bsourceType\s+String/);
  assert.doesNotMatch(source, /\bsourceId\s+String/);

  assert.match(migration, /ADD COLUMN "sourceThreadPromotionId" TEXT;/);
  assert.match(
    migration,
    /KnowledgeSynthesisSource_sourceThreadPromotionId_fkey[\s\S]*?REFERENCES "KnowledgeThreadPromotion"\("id"\)[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    migration,
    /KnowledgeSynthesisSource_exactly_one_promotion_check[\s\S]*?NUM_NONNULLS\([\s\S]*?"sourceThreadPromotionId"[\s\S]*?\) = 1/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "KnowledgeSynthesisSource_exactly_one_promotion_check";[\s\S]*?DROP CONSTRAINT "KnowledgeSynthesisSource_exactly_one_check";[\s\S]*?RENAME CONSTRAINT "KnowledgeSynthesisSource_exactly_one_promotion_check"[\s\S]*?TO "KnowledgeSynthesisSource_exactly_one_check"/,
  );
  assert.match(
    migration,
    /"relationType" <> 'primary'[\s\S]*?"ordinal" <> 0[\s\S]*?KnowledgeSynthesisSource_thread_promotion_check/,
  );
  assert.match(
    migration,
    /KnowledgeSynthesisSource_sourceThreadPromotionId_key/,
  );
});

test('deferred aggregate validation fixes the synthesis-v1 then promotion then source creation order', () => {
  assert.match(
    migration,
    /KnowledgeThreadPromotion_destinationSynthesisId_ownerUserI_fkey[\s\S]*?REFERENCES "KnowledgeSynthesis"\("id", "ownerUserId"\)/,
  );
  assert.match(
    migration,
    /KnowledgeThreadPromotion_destinationSynthesisVersionId_des_fkey[\s\S]*?REFERENCES "KnowledgeSynthesisVersion"\("id", "synthesisId", "version"\)/,
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeThreadPromotion_complete_trigger"[\s\S]*?AFTER INSERT ON "KnowledgeThreadPromotion"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(
    migration,
    /FROM "KnowledgeSynthesisSource"[\s\S]*?"sourceThreadPromotionId" = NEW\."id"[\s\S]*?"synthesisVersionId" = NEW\."destinationSynthesisVersionId"/,
  );
  assert.match(
    migration,
    /destination_source_count <> 1[\s\S]*?request_count <> 1/,
  );
  assert.match(migration, /"destinationSynthesisVersionNumber" = 1/);
});

test('selected reply insertion is exact-thread, exact-version, immutable and source-revoke safe', () => {
  assert.match(migration, /KnowledgeThreadPromotion_exact_share_check/);
  assert.match(
    migration,
    /share_row\."version" IS DISTINCT FROM NEW\."sourceShareVersion"[\s\S]*?share_row\."contentHash" IS DISTINCT FROM NEW\."sourceShareContentHash"/,
  );
  assert.match(
    migration,
    /message_row\."parentMessageId" IS DISTINCT FROM NEW\."sourceRootMessageId"[\s\S]*?message_row\."threadRootId" IS DISTINCT FROM NEW\."sourceRootMessageId"/,
  );
  assert.match(
    migration,
    /message_row\."activitySequence" IS DISTINCT FROM NEW\."sourceActivitySequence"[\s\S]*?message_row\."body" IS DISTINCT FROM NEW\."content"/,
  );
  for (const table of [
    'KnowledgeThreadPromotion',
    'KnowledgeThreadPromotionMessage',
    'KnowledgeThreadPromotionRequest',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE TRIGGER "${table}_immutable_trigger"[\\s\\S]*?BEFORE UPDATE OR DELETE ON "${table}"`,
      ),
    );
  }
  assert.match(
    migration,
    /KnowledgeThreadPromotion_sourceShareId_fkey[\s\S]*?REFERENCES "KnowledgeShare"\("id"\)/,
  );
  assert.doesNotMatch(
    migration,
    /FOREIGN KEY \("sourceShareId", "sourceShareVersion", "sourceShareContentHash"\)/,
  );
});

test('request ledger and synthesis grants preserve idempotency and explicit destination ACL', () => {
  const request = schemaBlock('model', 'KnowledgeThreadPromotionRequest');
  const grant = schemaBlock('model', 'KnowledgeSynthesisGroupGrant');
  assert.match(request, /@@unique\(\[promoterUserId, requestKeyHash\]\)/);
  assert.match(request, /promotionId\s+String\s+@unique/);
  assert.match(
    migration,
    /KnowledgeThreadPromotionRequest_hash_check[\s\S]*?requestKeyHash" ~ '\^\[0-9a-f\]\{64\}\$'[\s\S]*?requestPayloadHash" ~ '\^\[0-9a-f\]\{64\}\$'/,
  );
  assert.match(
    migration,
    /KnowledgeThreadPromotionRequest_promotionId_promoterUserId_fkey[\s\S]*?REFERENCES "KnowledgeThreadPromotion"\("id", "promoterUserId"\)/,
  );

  assert.match(grant, /groupAccountId\s+String/);
  assert.match(grant, /revokedAt\s+DateTime\?/);
  assert.match(grant, /@@unique\(\[synthesisId, groupAccountId\]\)/);
  assert.match(migration, /KnowledgeThreadPromotion_scope_grants_check/);
  assert.match(
    migration,
    /"scope" = 'personal'[\s\S]*?"destinationGrantCount" = 0[\s\S]*?"scope" = 'organization'[\s\S]*?"destinationGrantCount" BETWEEN 1 AND 20/,
  );
  assert.match(migration, /KnowledgeSynthesisGroupGrant_scope_check/);
  assert.match(
    migration,
    /knowledge synthesis grants must be revoked, not deleted/,
  );
});

test('migration is expand-only and preserves the old text-message application contract', () => {
  assert.match(schema, /enum ChatMessageType\s*\{\s*text\s*\}/s);
  assert.doesNotMatch(migration, /ALTER TYPE "ChatMessageType"/);
  assert.doesNotMatch(
    migration,
    /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE\s+FROM|UPDATE\s+")\b/i,
  );
  assert.doesNotMatch(migration, /ALTER TABLE "ChatMessage"\s+ADD COLUMN/);
  assert.match(
    migration,
    /ALTER TABLE "KnowledgeSynthesisSource"\s+ADD COLUMN "sourceThreadPromotionId" TEXT;/,
  );
  assert.match(
    migration,
    /root_row\."messageType" <> 'text'[\s\S]*?root_row\."body" IS DISTINCT FROM 'Knowledge was shared\.'/,
  );
});

test('promotion audit actions are constrained to a content-free aggregate target', () => {
  for (const action of [
    'knowledge_thread_promote_previewed',
    'knowledge_thread_promoted',
    'knowledge_thread_promote_duplicate_detected',
    'knowledge_thread_promote_rejected',
  ]) {
    assert.match(migration, new RegExp(`'${action}'`));
  }
  assert.match(
    migration,
    /AuditLog_knowledge_thread_promotion_target_check[\s\S]*?"targetTable" = 'knowledge_thread_promotions'[\s\S]*?"targetId" IS NOT NULL[\s\S]*?\) NOT VALID;/,
  );
});

test('PostgreSQL integration fixes deferred completion, immutable snapshots and old-share revoke compatibility', () => {
  assert.match(integrationWrapper, /postgres:15@sha256:/);
  assert.match(integrationWrapper, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(integrationWrapper, /trap cleanup EXIT INT TERM/);
  assert.match(integrationWrapper, /prisma migrate deploy/);
  assert.match(
    integrationWrapper,
    /KnowledgeThreadPromotion\|KnowledgeSynthesisGroupGrant\|sourceThreadPromotionId/,
  );
  assert.match(integration, /"includesSharedCard",[\s\S]*?true, 1/);
  assert.match(
    integration,
    /expectDatabaseError\(\(\) => client\.query\('COMMIT'\), '23514'\)/,
  );
  assert.match(
    integration,
    /UPDATE "KnowledgeThreadPromotion" SET "includesSharedCard" = false/,
  );
  assert.match(
    integration,
    /UPDATE "KnowledgeShare"[\s\S]*?"status" = 'revoked'[\s\S]*?"version" = 3/,
  );
  assert.match(integration, /sourceShareVersion: 2/);
  assert.match(integration, /currentShareVersion: 3/);
});
