import { FastifyInstance } from 'fastify';
import {
  projectChatMessageSchema,
  projectChatReactionSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';

function parseDateParam(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseLimit(value?: string, fallback = 50) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 200);
}

function hasProjectAccess(roles: string[], projectIds: string[], projectId: string) {
  if (roles.includes('admin') || roles.includes('mgmt')) return true;
  return projectIds.includes(projectId);
}

export async function registerChatRoutes(app: FastifyInstance) {
  const chatRoles = ['admin', 'mgmt', 'user', 'hr', 'exec'];

  app.get(
    '/projects/:projectId/chat-messages',
    {
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { limit, before } = req.query as {
        limit?: string;
        before?: string;
      };
      const take = parseLimit(limit);
      if (!take) {
        return reply.status(400).send({
          error: { code: 'INVALID_LIMIT', message: 'limit must be a positive integer' },
        });
      }
      const beforeDate = parseDateParam(before);
      if (before && !beforeDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid before date' },
        });
      }
      const where: {
        projectId: string;
        deletedAt: null;
        createdAt?: { lt: Date };
      } = {
        projectId,
        deletedAt: null,
      };
      if (beforeDate) {
        where.createdAt = { lt: beforeDate };
      }
      const items = await prisma.projectChatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
      });
      return { items };
    },
  );

  app.post(
    '/projects/:projectId/chat-messages',
    {
      schema: projectChatMessageSchema,
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as { body: string; tags?: string[] };
      const userId = req.user?.userId || 'demo-user';
      const message = await prisma.projectChatMessage.create({
        data: {
          projectId,
          userId,
          body: body.body,
          tags: body.tags?.length ? body.tags : undefined,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      return message;
    },
  );

  app.post(
    '/chat-messages/:id/reactions',
    {
      schema: projectChatReactionSchema,
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { emoji: string };
      const message = await prisma.projectChatMessage.findUnique({ where: { id } });
      if (!message || message.deletedAt) {
        return reply.status(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, message.projectId)) {
        return reply.status(403).send({ error: 'forbidden_project' });
      }
      const trimmedEmoji = body.emoji.trim();
      if (!trimmedEmoji) {
        return reply.status(400).send({
          error: { code: 'INVALID_EMOJI', message: 'emoji is required' },
        });
      }
      const current =
        (message.reactions as Record<string, number> | null | undefined) || {};
      const next = {
        ...current,
        [trimmedEmoji]: (current[trimmedEmoji] || 0) + 1,
      };
      const updated = await prisma.projectChatMessage.update({
        where: { id },
        data: {
          reactions: next,
          updatedBy: req.user?.userId,
        },
      });
      return updated;
    },
  );
}
