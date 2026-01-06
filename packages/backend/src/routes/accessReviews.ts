import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { sendCsv, toCsv } from '../utils/csv.js';

function normalizeFormat(raw?: string) {
  const value = (raw || 'json').toLowerCase();
  if (value === 'csv' || value === 'json') return value;
  return null;
}

export async function registerAccessReviewRoutes(app: FastifyInstance) {
  app.get(
    '/access-reviews/snapshot',
    { preHandler: requireRole(['admin', 'mgmt', 'exec']) },
    async (req, reply) => {
      const { format } = req.query as { format?: string };
      const normalizedFormat = normalizeFormat(format);
      if (!normalizedFormat) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_FORMAT',
            message: 'format must be csv or json',
          },
        });
      }
      const [users, groups, memberships] = await Promise.all([
        prisma.userAccount.findMany({
          select: {
            id: true,
            userName: true,
            displayName: true,
            department: true,
            active: true,
          },
          orderBy: { userName: 'asc' },
        }),
        prisma.groupAccount.findMany({
          select: {
            id: true,
            displayName: true,
            active: true,
          },
          orderBy: { displayName: 'asc' },
        }),
        prisma.userGroup.findMany({
          select: {
            userId: true,
            groupId: true,
          },
        }),
      ]);
      await logAudit({
        action: 'access_review_exported',
        userId: req.user?.userId,
        metadata: {
          format: normalizedFormat,
          userCount: users.length,
          groupCount: groups.length,
          membershipCount: memberships.length,
        },
      });
      if (normalizedFormat === 'csv') {
        const groupMap = new Map(groups.map((g) => [g.id, g]));
        const membershipMap = new Map<string, string[]>();
        for (const membership of memberships) {
          const list = membershipMap.get(membership.userId) ?? [];
          list.push(membership.groupId);
          membershipMap.set(membership.userId, list);
        }
        const headers = [
          'userId',
          'userName',
          'displayName',
          'department',
          'active',
          'groupId',
          'groupName',
          'groupActive',
        ];
        const rows: unknown[][] = [];
        for (const user of users) {
          const groupIds = membershipMap.get(user.id) || [];
          if (!groupIds.length) {
            rows.push([
              user.id,
              user.userName,
              user.displayName || '',
              user.department || '',
              user.active,
              '',
              '',
              '',
            ]);
            continue;
          }
          for (const groupId of groupIds) {
            const group = groupMap.get(groupId);
            rows.push([
              user.id,
              user.userName,
              user.displayName || '',
              user.department || '',
              user.active,
              groupId,
              group?.displayName || '',
              group?.active ?? '',
            ]);
          }
        }
        const dateLabel = new Date().toISOString().slice(0, 10);
        return sendCsv(
          reply,
          `access-review-${dateLabel}.csv`,
          toCsv(headers, rows),
        );
      }
      return { users, groups, memberships };
    },
  );
}
