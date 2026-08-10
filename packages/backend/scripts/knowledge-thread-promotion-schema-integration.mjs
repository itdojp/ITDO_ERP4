import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (process.env.KNOWLEDGE_THREAD_PROMOTION_SCHEMA_INTEGRATION_CONFIRM !== '1') {
  throw new Error('knowledge_thread_promotion_schema_integration_not_confirmed');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const ids = Object.fromEntries(
  [
    'room',
    'root',
    'reply',
    'item',
    'share',
    'synthesis',
    'version',
    'promotion',
    'selected',
    'request',
    'source',
    'secondSource',
    'incompleteSynthesis',
    'incompleteVersion',
    'incompletePromotion',
  ].map((name) => [name, randomUUID()]),
);
const actor = `promotion-schema-${randomUUID()}`;
const hash = (character) => character.repeat(64);
const now = new Date();

async function expectDatabaseError(work, expectedCode) {
  try {
    await work();
    assert.fail(`expected PostgreSQL error ${expectedCode}`);
  } catch (error) {
    assert.equal(error?.code, expectedCode);
  }
}

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "ChatRoom" (
       "id", "type", "name", "allowExternalUsers",
       "allowExternalIntegrations", "createdAt", "updatedAt"
     ) VALUES ($1, 'private_group', 'Synthetic promotion room', false, false, $2, $2)`,
    [ids.room, now],
  );
  await client.query(
    `INSERT INTO "ChatMessage" (
       "id", "roomId", "messageType", "userId", "body",
       "mentionsAll", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'text', $3, 'Knowledge was shared.', false, $4, $4)`,
    [ids.root, ids.room, actor, now],
  );
  const reply = await client.query(
    `INSERT INTO "ChatMessage" (
       "id", "roomId", "messageType", "parentMessageId", "threadRootId",
       "userId", "body", "mentionsAll", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'text', $3, $3, $4, 'Selected synthetic reply', false, $5, $5)
     RETURNING "activitySequence", "createdAt"`,
    [ids.reply, ids.room, ids.root, actor, now],
  );
  const item = await client.query(
    `INSERT INTO "KnowledgeItem" (
       "id", "ownerUserId", "scope", "sourceType", "title",
       "status", "version", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'personal', 'manual', 'Synthetic source',
       'inbox', 1, $3, $3)
     RETURNING "updatedAt"`,
    [ids.item, actor, now],
  );
  await client.query(
    `INSERT INTO "KnowledgeShare" (
       "id", "sourceKnowledgeItemId", "sourceOwnerUserId", "sharerUserId",
       "chatPosterUserId", "destinationRoomId", "requestKeyHash",
       "requestPayloadHash", "selectionHash", "contentHash",
       "sourceItemVersion", "sourceItemUpdatedAt", "selectedTitle",
       "createdAt", "createdBy", "updatedAt", "updatedBy"
     ) VALUES (
       $1, $2, $3, $3, $3, $4, $5, $6, $7, $8,
       1, $9, 'Synthetic source', $10, $3, $10, $3
     )`,
    [
      ids.share,
      ids.item,
      actor,
      ids.room,
      hash('1'),
      hash('2'),
      hash('3'),
      hash('4'),
      item.rows[0].updatedAt,
      now,
    ],
  );
  await client.query(
    `UPDATE "KnowledgeShare"
        SET "status" = 'posted', "chatMessageId" = $2,
            "postedAt" = $3, "version" = 2,
            "updatedAt" = $3, "updatedBy" = $4
      WHERE "id" = $1`,
    [ids.share, ids.root, now, actor],
  );
  await client.query(
    `INSERT INTO "KnowledgeSynthesis" (
       "id", "ownerUserId", "scope", "title", "currentVersion",
       "createdAt", "createdBy", "updatedAt", "updatedBy"
     ) VALUES ($1, $2, 'personal', 'Synthetic synthesis', 1, $3, $2, $3, $2)`,
    [ids.synthesis, actor, now],
  );
  await client.query(
    `INSERT INTO "KnowledgeSynthesisVersion" (
       "id", "synthesisId", "version", "content", "unresolvedQuestions",
       "createdAt", "createdBy"
     ) VALUES ($1, $2, 1, 'Synthetic conclusion', '[]'::jsonb, $3, $4)`,
    [ids.version, ids.synthesis, now, actor],
  );
  await client.query(
    `INSERT INTO "KnowledgeThreadPromotion" (
       "id", "sourceShareId", "sourceShareVersion", "sourceShareContentHash",
       "sourceRoomId", "sourceRootMessageId", "promoterUserId", "ownerUserId",
       "scope", "destinationSynthesisId", "destinationSynthesisVersionId",
       "selectionHash", "contentHash", "includesSharedCard",
       "selectedMessageCount", "createdAt", "createdBy"
     ) VALUES (
       $1, $2, 2, $3, $4, $5, $6, $6, 'personal', $7, $8,
       $9, $10, true, 1, $11, $6
     )`,
    [
      ids.promotion,
      ids.share,
      hash('4'),
      ids.room,
      ids.root,
      actor,
      ids.synthesis,
      ids.version,
      hash('5'),
      hash('6'),
      now,
    ],
  );
  await client.query(
    `INSERT INTO "KnowledgeThreadPromotionMessage" (
       "id", "promotionId", "sourceRoomId", "sourceRootMessageId",
       "sourceMessageId", "sourceActivitySequence", "sourceMessageCreatedAt",
       "ordinal", "authorCategory", "content", "contentHash",
       "createdAt", "createdBy"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'user',
       'Selected synthetic reply', $8, $9, $10)`,
    [
      ids.selected,
      ids.promotion,
      ids.room,
      ids.root,
      ids.reply,
      reply.rows[0].activitySequence,
      reply.rows[0].createdAt,
      hash('7'),
      now,
      actor,
    ],
  );
  await client.query(
    `INSERT INTO "KnowledgeThreadPromotionRequest" (
       "id", "promoterUserId", "requestKeyHash", "requestPayloadHash",
       "promotionId", "createdAt", "createdBy"
     ) VALUES ($1, $2, $3, $4, $5, $6, $2)`,
    [ids.request, actor, hash('8'), hash('9'), ids.promotion, now],
  );
  await client.query(
    `INSERT INTO "KnowledgeSynthesisSource" (
       "id", "synthesisVersionId", "relationType", "ordinal",
       "sourceThreadPromotionId", "createdAt", "createdBy"
     ) VALUES ($1, $2, 'primary', 0, $3, $4, $5)`,
    [ids.source, ids.version, ids.promotion, now, actor],
  );
  await client.query('COMMIT');

  const persisted = await client.query(
    `SELECT p."includesSharedCard", COUNT(m."id")::int AS "selectedCount",
            COUNT(s."id")::int AS "sourceCount"
       FROM "KnowledgeThreadPromotion" p
       LEFT JOIN "KnowledgeThreadPromotionMessage" m ON m."promotionId" = p."id"
       LEFT JOIN "KnowledgeSynthesisSource" s ON s."sourceThreadPromotionId" = p."id"
      WHERE p."id" = $1
      GROUP BY p."includesSharedCard"`,
    [ids.promotion],
  );
  assert.deepEqual(persisted.rows[0], {
    includesSharedCard: true,
    selectedCount: 1,
    sourceCount: 1,
  });

  await expectDatabaseError(
    () =>
      client.query(
        `INSERT INTO "KnowledgeSynthesisSource" (
           "id", "synthesisVersionId", "relationType", "ordinal",
           "sourceKnowledgeItemId", "createdAt", "createdBy"
         ) VALUES ($1, $2, 'supporting', 1, $3, $4, $5)`,
        [ids.secondSource, ids.version, ids.item, now, actor],
      ),
    '23514',
  );

  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "KnowledgeSynthesis" (
       "id", "ownerUserId", "scope", "title", "currentVersion",
       "createdAt", "createdBy", "updatedAt", "updatedBy"
     ) VALUES ($1, $2, 'personal', 'Incomplete synthesis', 1, $3, $2, $3, $2)`,
    [ids.incompleteSynthesis, actor, now],
  );
  await client.query(
    `INSERT INTO "KnowledgeSynthesisVersion" (
       "id", "synthesisId", "version", "content", "unresolvedQuestions",
       "createdAt", "createdBy"
     ) VALUES ($1, $2, 1, 'Incomplete', '[]'::jsonb, $3, $4)`,
    [ids.incompleteVersion, ids.incompleteSynthesis, now, actor],
  );
  await client.query(
    `INSERT INTO "KnowledgeThreadPromotion" (
       "id", "sourceShareId", "sourceShareVersion", "sourceShareContentHash",
       "sourceRoomId", "sourceRootMessageId", "promoterUserId", "ownerUserId",
       "scope", "destinationSynthesisId", "destinationSynthesisVersionId",
       "selectionHash", "contentHash", "includesSharedCard",
       "selectedMessageCount", "createdAt", "createdBy"
     ) VALUES ($1, $2, 2, $3, $4, $5, $6, $6, 'personal', $7, $8,
       $9, $10, false, 1, $11, $6)`,
    [
      ids.incompletePromotion,
      ids.share,
      hash('4'),
      ids.room,
      ids.root,
      actor,
      ids.incompleteSynthesis,
      ids.incompleteVersion,
      hash('a'),
      hash('b'),
      now,
    ],
  );
  await expectDatabaseError(() => client.query('COMMIT'), '23514');
  await client.query('ROLLBACK');

  await expectDatabaseError(
    () =>
      client.query(
        `UPDATE "KnowledgeThreadPromotion" SET "includesSharedCard" = false
          WHERE "id" = $1`,
        [ids.promotion],
      ),
    '55000',
  );

  await client.query(
    `UPDATE "KnowledgeShare"
        SET "status" = 'revoked', "revokedAt" = $2, "revokedBy" = $3,
            "version" = 3, "updatedAt" = $2, "updatedBy" = $3
      WHERE "id" = $1`,
    [ids.share, new Date(now.getTime() + 1), actor],
  );
  const history = await client.query(
    `SELECT p."sourceShareVersion", p."sourceShareContentHash", s."version" AS "currentShareVersion"
       FROM "KnowledgeThreadPromotion" p
       JOIN "KnowledgeShare" s ON s."id" = p."sourceShareId"
      WHERE p."id" = $1`,
    [ids.promotion],
  );
  assert.deepEqual(history.rows[0], {
    sourceShareVersion: 2,
    sourceShareContentHash: hash('4'),
    currentShareVersion: 3,
  });

  console.log(
    JSON.stringify({
      result: 'PASS',
      includesSharedCard: true,
      selectedOnly: true,
      deferredCompleteRejectsIncomplete: true,
      promotionDestinationRejectsSecondSource: true,
      immutablePromotion: true,
      sourceRevokePreservesSnapshot: true,
    }),
  );
} finally {
  await client.end();
}
