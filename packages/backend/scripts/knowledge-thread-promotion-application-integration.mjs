import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import pg from 'pg';

if (process.env.KNOWLEDGE_THREAD_PROMOTION_SCHEMA_INTEGRATION_CONFIRM !== '1') {
  throw new Error('knowledge_thread_promotion_integration_not_confirmed');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const [
  { PrismaKnowledgeThreadPromotionAdapter },
  { PrismaKnowledgeSynthesisRepository },
  { createKnowledgeThreadPromotionUseCases },
  { createKnowledgeThreadPromotionTokenCodec },
  { createSynthesisAccessContext },
  { prisma },
] = await Promise.all([
  import('../dist/adapters/knowledge/prismaKnowledgeThreadPromotionAdapter.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js'),
  import('../dist/application/knowledge/knowledgeThreadPromotionUseCases.js'),
  import('../dist/application/knowledge/knowledgeThreadPromotionToken.js'),
  import('../dist/application/knowledge/knowledgeSynthesisAccessContext.js'),
  import('../dist/services/db.js'),
]);

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const ids = Object.fromEntries(
  [
    'actor',
    'viewer',
    'group',
    'actorMembership',
    'viewerMembership',
    'room',
    'actorRoomMember',
    'viewerRoomMember',
    'root',
    'selectedReply',
    'unselectedReply',
    'item',
    'share',
  ].map((name) => [name, randomUUID()]),
);
const organizationId = `synthetic-org-${randomUUID()}`;
const now = new Date();
const hash = (character) => character.repeat(64);
const selectedContent = 'Selected promotion content';
const unselectedCanary = 'UNSELECTED_PROMOTION_CANARY_DO_NOT_COPY';
const rollbackCanary = 'ROLLBACK_PROMOTION_CANARY_DO_NOT_PERSIST';
const auditActor = {
  principalUserId: ids.actor,
  actorUserId: ids.actor,
  requestId: 'knowledge-thread-promotion-integration',
  source: 'api',
};
const actor = {
  userId: ids.actor,
  organizationId,
  groupAccountIds: [ids.group],
  chat: {
    userId: ids.actor,
    roles: ['user'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: [ids.group],
  },
};
const viewer = {
  userId: ids.viewer,
  organizationId,
  groupAccountIds: [ids.group],
  chat: {
    userId: ids.viewer,
    roles: ['user'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: [ids.group],
  },
};

await client.connect();
try {
  await client.query('BEGIN');
  for (const [id, userName] of [
    [ids.actor, `promotion-actor-${ids.actor}`],
    [ids.viewer, `promotion-viewer-${ids.viewer}`],
  ]) {
    await client.query(
      `INSERT INTO "UserAccount" (
         "id", "externalId", "userName", "active", "organization",
         "createdAt", "updatedAt"
       ) VALUES ($1, $1, $2, true, $3, $4, $4)`,
      [id, userName, organizationId, now],
    );
  }
  await client.query(
    `INSERT INTO "GroupAccount" (
       "id", "displayName", "active", "createdAt", "updatedAt"
     ) VALUES ($1, 'Synthetic promotion group', true, $2, $2)`,
    [ids.group, now],
  );
  await client.query(
    `INSERT INTO "UserGroup" ("id", "userId", "groupId", "createdAt")
     VALUES ($1, $2, $3, $4), ($5, $6, $3, $4)`,
    [
      ids.actorMembership,
      ids.actor,
      ids.group,
      now,
      ids.viewerMembership,
      ids.viewer,
    ],
  );
  await client.query(
    `INSERT INTO "ChatRoom" (
       "id", "type", "name", "allowExternalUsers",
       "allowExternalIntegrations", "createdAt", "updatedAt"
     ) VALUES ($1, 'private_group', 'Synthetic promotion room', false, false, $2, $2)`,
    [ids.room, now],
  );
  await client.query(
    `INSERT INTO "ChatRoomMember" (
       "id", "roomId", "userId", "role", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, 'member', $4, $4),
              ($5, $2, $6, 'member', $4, $4)`,
    [
      ids.actorRoomMember,
      ids.room,
      ids.actor,
      now,
      ids.viewerRoomMember,
      ids.viewer,
    ],
  );
  await client.query(
    `INSERT INTO "ChatMessage" (
       "id", "roomId", "messageType", "userId", "body",
       "mentionsAll", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'text', $3, 'Knowledge was shared.', false, $4, $4)`,
    [ids.root, ids.room, ids.actor, now],
  );
  await client.query(
    `INSERT INTO "ChatMessage" (
       "id", "roomId", "messageType", "parentMessageId", "threadRootId",
       "userId", "body", "mentionsAll", "createdAt", "updatedAt"
     ) VALUES
       ($1, $2, 'text', $3, $3, $4, $5, false, $6, $6),
       ($7, $2, 'text', $3, $3, $4, $8, false, $6, $6)`,
    [
      ids.selectedReply,
      ids.room,
      ids.root,
      ids.actor,
      selectedContent,
      now,
      ids.unselectedReply,
      unselectedCanary,
    ],
  );
  const item = await client.query(
    `INSERT INTO "KnowledgeItem" (
       "id", "ownerUserId", "scope", "sourceType", "title",
       "status", "version", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'personal', 'manual', 'Private source canary',
       'inbox', 1, $3, $3)
     RETURNING "updatedAt"`,
    [ids.item, ids.actor, now],
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
       1, $9, 'Private source canary', $10, $3, $10, $3
     )`,
    [
      ids.share,
      ids.item,
      ids.actor,
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
    [ids.share, ids.root, now, ids.actor],
  );
  await client.query('COMMIT');

  const tokenCodec = createKnowledgeThreadPromotionTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'synthetic-promotion-integration-secret-at-least-32-bytes',
    },
  });
  const store = new PrismaKnowledgeThreadPromotionAdapter();
  const service = createKnowledgeThreadPromotionUseCases({ store, tokenCodec });
  const request = {
    selectedReplyMessageIds: [ids.selectedReply],
    includeSharedCard: false,
    destination: {
      scope: 'organization',
      organizationGroupAccountIds: [ids.group],
    },
    synthesis: {
      title: 'Selected thread synthesis',
      content: selectedContent,
      confidenceBasisPoints: 7500,
      unresolvedQuestions: ['Synthetic unresolved question'],
    },
  };
  const preview = await service.preview({
    actor,
    auditActor,
    rootMessageId: ids.root,
    body: request,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.value.selectedMessages.length, 1);
  assert.deepEqual(
    {
      ...preview.value.selectedMessages[0],
      createdAt: '<validated-date-time>',
    },
    {
      ordinal: 0,
      content: selectedContent,
      createdAt: '<validated-date-time>',
      authorCategory: 'user',
    },
  );
  assert.equal(
    Number.isNaN(Date.parse(preview.value.selectedMessages[0].createdAt)),
    false,
  );
  assert.equal(JSON.stringify(preview.value).includes(unselectedCanary), false);

  const commitInput = {
    actor,
    auditActor,
    rootMessageId: ids.root,
    body: {
      ...request,
      previewToken: preview.value.previewToken,
      requestKey: 'synthetic-promotion-request',
      confirmed: true,
      organizationAudienceConfirmed: true,
    },
  };
  const committed = await service.commit(commitInput);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.created, true);
  assert.equal(committed.value.selectedMessageCount, 1);
  assert.equal(committed.value.includesSharedCard, false);

  const replay = await service.commit(commitInput);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.created, false);
  assert.equal(replay.value.reused, true);
  assert.equal(replay.value.promotionId, committed.value.promotionId);
  assert.equal(
    replay.value.synthesisVersionId,
    committed.value.synthesisVersionId,
  );

  const concurrentRequest = {
    ...request,
    synthesis: {
      ...request.synthesis,
      title: 'Concurrent selected thread synthesis',
    },
  };
  const concurrentPreview = await service.preview({
    actor,
    auditActor,
    rootMessageId: ids.root,
    body: concurrentRequest,
  });
  assert.equal(concurrentPreview.ok, true);
  const concurrentCommitInput = {
    actor,
    auditActor,
    rootMessageId: ids.root,
    body: {
      ...concurrentRequest,
      previewToken: concurrentPreview.value.previewToken,
      requestKey: 'synthetic-concurrent-promotion-request',
      confirmed: true,
      organizationAudienceConfirmed: true,
    },
  };
  const concurrentResults = await Promise.all([
    service.commit(concurrentCommitInput),
    service.commit(concurrentCommitInput),
  ]);
  assert.equal(
    concurrentResults.every((result) => result.ok),
    true,
  );
  assert.equal(
    new Set(concurrentResults.map((result) => result.value.promotionId)).size,
    1,
  );
  assert.deepEqual(
    concurrentResults.map((result) => result.value.created).sort(),
    [false, true],
  );

  const conflict = await service.commit({
    ...commitInput,
    body: {
      ...commitInput.body,
      synthesis: { ...request.synthesis, content: 'Conflicting content' },
    },
  });
  assert.deepEqual(conflict, {
    ok: false,
    statusCode: 409,
    code: 'idempotency_conflict',
    message: 'Idempotency conflict',
  });

  const persisted = await client.query(
    `SELECT p."selectedMessageCount", p."includesSharedCard",
            COUNT(m."id")::int AS "messageCount",
            STRING_AGG(m."content", E'\n') AS "selectedContent"
       FROM "KnowledgeThreadPromotion" p
       JOIN "KnowledgeThreadPromotionMessage" m ON m."promotionId" = p."id"
      WHERE p."id" = $1
      GROUP BY p."selectedMessageCount", p."includesSharedCard"`,
    [committed.value.promotionId],
  );
  assert.deepEqual(persisted.rows[0], {
    selectedMessageCount: 1,
    includesSharedCard: false,
    messageCount: 1,
    selectedContent,
  });
  const privateSurface = await client.query(
    `SELECT CONCAT_WS(E'\n',
       COALESCE(p."contentHash", ''), COALESCE(p."selectionHash", ''),
       COALESCE(m."content", ''), COALESCE(s."content", ''),
       COALESCE(a."metadata"::text, '')) AS material
     FROM "KnowledgeThreadPromotion" p
     JOIN "KnowledgeThreadPromotionMessage" m ON m."promotionId" = p."id"
     JOIN "KnowledgeSynthesisVersion" s ON s."id" = p."destinationSynthesisVersionId"
     LEFT JOIN "AuditLog" a ON a."targetId" = p."id"
     WHERE p."id" = $1`,
    [committed.value.promotionId],
  );
  assert.equal(
    privateSurface.rows.some((row) => row.material.includes(unselectedCanary)),
    false,
  );
  assert.equal(
    privateSurface.rows.some((row) =>
      row.material.includes('Private source canary'),
    ),
    false,
  );

  const synthesisRepository = new PrismaKnowledgeSynthesisRepository();
  const visibleBeforeRoomLoss = await synthesisRepository.findVisible({
    actor: viewer,
    synthesisId: committed.value.synthesisId,
    accessContext: createSynthesisAccessContext(),
  });
  assert.ok(visibleBeforeRoomLoss);
  assert.equal(
    visibleBeforeRoomLoss.currentVersion.sources[0].accessible,
    true,
  );
  assert.equal(
    visibleBeforeRoomLoss.currentVersion.sources[0].sourceId,
    committed.value.promotionId,
  );

  await client.query(
    `UPDATE "ChatRoomMember"
        SET "deletedAt" = $2, "updatedAt" = $2
      WHERE "id" = $1`,
    [ids.viewerRoomMember, new Date(now.getTime() + 1)],
  );
  const visibleAfterRoomLoss = await synthesisRepository.findVisible({
    actor: viewer,
    synthesisId: committed.value.synthesisId,
    accessContext: createSynthesisAccessContext(),
  });
  assert.ok(visibleAfterRoomLoss);
  assert.equal(visibleAfterRoomLoss.currentVersion.content, selectedContent);
  assert.equal(
    visibleAfterRoomLoss.currentVersion.sources[0].accessible,
    false,
  );
  assert.equal(visibleAfterRoomLoss.currentVersion.sources[0].sourceId, null);

  const revokedAt = new Date(Date.now() + 1_000);
  await client.query(
    `UPDATE "KnowledgeSynthesisGroupGrant"
        SET "revokedAt" = $2, "revokedBy" = $3,
            "updatedAt" = $2, "updatedBy" = $3
      WHERE "synthesisId" = $1`,
    [committed.value.synthesisId, revokedAt, ids.actor],
  );
  const hiddenAfterGrantRevoke = await synthesisRepository.findVisible({
    actor: viewer,
    synthesisId: committed.value.synthesisId,
    accessContext: createSynthesisAccessContext(),
  });
  assert.equal(hiddenAfterGrantRevoke, null);

  const beforeRollback = await client.query(
    `SELECT COUNT(*)::int AS count FROM "KnowledgeThreadPromotion"`,
  );
  const failingHost = {
    $transaction(operation, options) {
      return prisma.$transaction((transaction) => {
        const failingTransaction = new Proxy(transaction, {
          get(target, property) {
            if (property === 'auditLog') {
              return {
                create: async () => {
                  throw new Error('synthetic_mandatory_audit_failure');
                },
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return operation(failingTransaction);
      }, options);
    },
  };
  const rollbackService = createKnowledgeThreadPromotionUseCases({
    store: new PrismaKnowledgeThreadPromotionAdapter(failingHost),
    tokenCodec,
  });
  const rollbackRequest = {
    ...request,
    synthesis: { ...request.synthesis, content: rollbackCanary },
  };
  const rollbackPreview = await service.preview({
    actor,
    auditActor,
    rootMessageId: ids.root,
    body: rollbackRequest,
  });
  assert.equal(rollbackPreview.ok, true);
  await assert.rejects(
    () =>
      rollbackService.commit({
        actor,
        auditActor,
        rootMessageId: ids.root,
        body: {
          ...rollbackRequest,
          previewToken: rollbackPreview.value.previewToken,
          requestKey: 'synthetic-promotion-rollback-request',
          confirmed: true,
          organizationAudienceConfirmed: true,
        },
      }),
    /synthetic_mandatory_audit_failure/,
  );
  const afterRollback = await client.query(
    `SELECT COUNT(*)::int AS count FROM "KnowledgeThreadPromotion"`,
  );
  assert.equal(afterRollback.rows[0].count, beforeRollback.rows[0].count);
  const rollbackRows = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM "KnowledgeSynthesisVersion"
      WHERE "content" = $1`,
    [rollbackCanary],
  );
  assert.equal(rollbackRows.rows[0].count, 0);

  console.log(
    JSON.stringify({
      result: 'PASS',
      selectedOnly: true,
      idempotentReplay: true,
      concurrentReplayConverges: true,
      idempotencyConflict: true,
      organizationGrant: true,
      revokedGrantDenied: true,
      roomLossRedactsProvenanceOnly: true,
      auditFailureRollsBack: true,
    }),
  );
} finally {
  await prisma.$disconnect();
  await client.end();
}
