import { Prisma } from '@prisma/client';

import { prisma } from './db.js';

type ChatSearchAccessClient = Pick<typeof prisma, '$queryRaw'>;

export type ChatSearchActor = {
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
  client?: ChatSearchAccessClient;
};

function normalizedStrings(values: string[]) {
  return [
    ...new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    ),
  ];
}

/**
 * Resolves room IDs with the canonical read ACL entirely inside PostgreSQL.
 *
 * The caller supplies the transaction used by the message query, so ACL rows
 * and search results share one snapshot. This query returns IDs only and is
 * itself the authorization predicate; neither rooms nor messages are fetched
 * and post-filtered in application memory.
 */
export async function resolveAccessibleChatSearchRoomIds(
  options: ChatSearchActor,
) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  if (!userId) return [];
  const groupSelectors = normalizedStrings([
    ...options.groupIds,
    ...options.groupAccountIds,
  ]);
  const projectIds = normalizedStrings(options.projectIds);
  const elevated = options.roles.some(
    (role) => role === 'admin' || role === 'mgmt',
  );

  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT room."id"
      FROM "ChatRoom" AS room
     WHERE room."deletedAt" IS NULL
       AND (
         room."type" = 'company'
         AND (
           jsonb_array_length(
             CASE
               WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                 THEN room."viewerGroupIds"
               ELSE '[]'::jsonb
             END
           ) = 0
           OR EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                     THEN room."viewerGroupIds"
                   ELSE '[]'::jsonb
                 END
               ) AS viewer_group("id")
              WHERE viewer_group."id" = ANY(${groupSelectors}::text[])
           )
         )
         OR room."type" = 'department'
         AND room."groupId" = ANY(${groupSelectors}::text[])
         AND (
           jsonb_array_length(
             CASE
               WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                 THEN room."viewerGroupIds"
               ELSE '[]'::jsonb
             END
           ) = 0
           OR EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                     THEN room."viewerGroupIds"
                   ELSE '[]'::jsonb
                 END
               ) AS viewer_group("id")
              WHERE viewer_group."id" = ANY(${groupSelectors}::text[])
           )
         )
         OR room."type" = 'project'
         AND (
           jsonb_array_length(
             CASE
               WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                 THEN room."viewerGroupIds"
               ELSE '[]'::jsonb
             END
           ) = 0
           OR EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                     THEN room."viewerGroupIds"
                   ELSE '[]'::jsonb
                 END
               ) AS viewer_group("id")
              WHERE viewer_group."id" = ANY(${groupSelectors}::text[])
           )
         )
         AND (
           (
             COALESCE(
               room."projectId",
               CASE WHEN room."isOfficial" THEN room."id" END
             ) IS NOT NULL
             AND (
               ${elevated}
               OR COALESCE(
                 room."projectId",
                 CASE WHEN room."isOfficial" THEN room."id" END
               ) = ANY(${projectIds}::text[])
             )
           )
           OR room."allowExternalUsers"
           AND EXISTS (
             SELECT 1
               FROM "ChatRoomMember" AS member
              WHERE member."roomId" = room."id"
                AND member."userId" = ${userId}
                AND member."deletedAt" IS NULL
           )
         )
         OR room."type" = 'private_group'
         AND room."isOfficial"
         AND (
           EXISTS (
             SELECT 1
               FROM "ChatRoomMember" AS member
              WHERE member."roomId" = room."id"
                AND member."userId" = ${userId}
                AND member."deletedAt" IS NULL
           )
           OR EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                     THEN room."viewerGroupIds"
                   ELSE '[]'::jsonb
                 END
               ) AS viewer_group("id")
              WHERE viewer_group."id" = ANY(${groupSelectors}::text[])
           )
         )
         OR room."type" NOT IN ('company', 'department', 'project')
         AND NOT (room."type" = 'private_group' AND room."isOfficial")
         AND (
           jsonb_array_length(
             CASE
               WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                 THEN room."viewerGroupIds"
               ELSE '[]'::jsonb
             END
           ) = 0
           OR EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(room."viewerGroupIds") = 'array'
                     THEN room."viewerGroupIds"
                   ELSE '[]'::jsonb
                 END
               ) AS viewer_group("id")
              WHERE viewer_group."id" = ANY(${groupSelectors}::text[])
           )
         )
         AND EXISTS (
           SELECT 1
             FROM "ChatRoomMember" AS member
            WHERE member."roomId" = room."id"
              AND member."userId" = ${userId}
              AND member."deletedAt" IS NULL
         )
       )
     ORDER BY room."id" ASC
  `);
  return rows.map((row) => row.id);
}
