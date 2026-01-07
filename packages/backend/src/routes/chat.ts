import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  projectChatMessageSchema,
  projectChatReactionSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import {
  hasProjectAccess,
  requireProjectAccess,
  requireRole,
} from '../services/rbac.js';

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

export async function registerChatRoutes(app: FastifyInstance) {
  const chatRoles = [
    'admin',
    'mgmt',
    'user',
    'hr',
    'exec',
    'external_chat',
    'probationary',
  ];

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
          error: {
            code: 'INVALID_LIMIT',
            message: 'limit must be a positive integer',
          },
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
      const message = await prisma.projectChatMessage.findUnique({
        where: { id },
      });
      if (!message || message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, message.projectId)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const trimmedEmoji = body.emoji.trim();
      if (!trimmedEmoji) {
        return reply.status(400).send({
          error: { code: 'INVALID_EMOJI', message: 'emoji is required' },
        });
      }
      const current =
        (message.reactions as Record<string, unknown> | null | undefined) || {};
      const existingEntry = current[trimmedEmoji] as
        | number
        | { count: number; userIds: string[] }
        | undefined;
      let normalized = { count: 0, userIds: [] as string[] };
      if (typeof existingEntry === 'number') {
        normalized = { count: existingEntry, userIds: [] };
      } else if (
        existingEntry &&
        typeof existingEntry === 'object' &&
        'count' in existingEntry &&
        'userIds' in existingEntry &&
        Array.isArray((existingEntry as { userIds: unknown }).userIds)
      ) {
        normalized = {
          count: (existingEntry as { count: number }).count,
          userIds: (existingEntry as { userIds: string[] }).userIds,
        };
      }
      if (normalized.userIds.includes(userId)) {
        return message;
      }
      normalized = {
        count: normalized.count + 1,
        userIds: [...normalized.userIds, userId],
      };
      const next = {
        ...current,
        [trimmedEmoji]: normalized,
      } as Prisma.InputJsonValue;
      const updated = await prisma.projectChatMessage.update({
        where: { id },
        data: {
          reactions: next,
          updatedBy: userId,
        },
      });
      return updated;
    },
  );
}
