import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  projectChatMessageSchema,
  projectChatAckRequestSchema,
  projectChatReactionSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import {
  hasProjectAccess,
  requireProjectAccess,
  requireRole,
} from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  openAttachment,
  storeAttachment,
} from '../services/chatAttachments.js';

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

function normalizeStringArray(
  value: unknown,
  options?: { dedupe?: boolean; max?: number },
) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  const deduped = options?.dedupe ? Array.from(new Set(items)) : items;
  return typeof options?.max === 'number'
    ? deduped.slice(0, options.max)
    : deduped;
}

function parseMaxBytes(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function readFileBuffer(
  stream: AsyncIterable<Buffer>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('FILE_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function registerChatRoutes(app: FastifyInstance) {
  const chatRoles = ['admin', 'mgmt', 'user', 'hr', 'exec', 'external_chat'];

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
      const { limit, before, tag } = req.query as {
        limit?: string;
        before?: string;
        tag?: string;
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
      const where: Prisma.ProjectChatMessageWhereInput = {
        projectId,
        deletedAt: null,
      };
      if (beforeDate) {
        where.createdAt = { lt: beforeDate };
      }
      const trimmedTag = typeof tag === 'string' ? tag.trim() : '';
      if (trimmedTag.length > 32) {
        return reply.status(400).send({
          error: { code: 'INVALID_TAG', message: 'Tag is too long' },
        });
      }
      if (trimmedTag) {
        where.tags = { array_contains: [trimmedTag] };
      }
      const items = await prisma.projectChatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          ackRequest: {
            include: {
              acks: true,
            },
          },
          attachments: {
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
              createdBy: true,
            },
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      return { items };
    },
  );

  app.get(
    '/projects/:projectId/chat-unread',
    {
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const state = await prisma.projectChatReadState.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { lastReadAt: true },
      });
      const unreadCount = await prisma.projectChatMessage.count({
        where: {
          projectId,
          deletedAt: null,
          createdAt: state?.lastReadAt ? { gt: state.lastReadAt } : undefined,
        },
      });
      return {
        unreadCount,
        lastReadAt: state?.lastReadAt ? state.lastReadAt.toISOString() : null,
      };
    },
  );

  app.post(
    '/projects/:projectId/chat-read',
    {
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const now = new Date();
      const updated = await prisma.projectChatReadState.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: { lastReadAt: now },
        create: {
          projectId,
          userId,
          lastReadAt: now,
        },
        select: { lastReadAt: true },
      });
      return { lastReadAt: updated.lastReadAt.toISOString() };
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
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      return message;
    },
  );

  app.post(
    '/projects/:projectId/chat-ack-requests',
    {
      schema: projectChatAckRequestSchema,
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        body: string;
        requiredUserIds: string[];
        dueAt?: string;
        tags?: string[];
      };
      const userId = req.user?.userId || 'demo-user';
      const requiredUserIds = normalizeStringArray(body.requiredUserIds, {
        dedupe: true,
        max: 50,
      });
      if (!requiredUserIds.length) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: 'requiredUserIds must contain at least one userId',
          },
        });
      }
      const dueAt = parseDateParam(body.dueAt);
      if (body.dueAt && !dueAt) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid dueAt date-time' },
        });
      }

      const message = await prisma.projectChatMessage.create({
        data: {
          projectId,
          userId,
          body: body.body,
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          createdBy: userId,
          updatedBy: userId,
          ackRequest: {
            create: {
              projectId,
              requiredUserIds,
              dueAt: dueAt ?? undefined,
              createdBy: userId,
            },
          },
        },
        include: {
          ackRequest: {
            include: { acks: true },
          },
        },
      });
      return message;
    },
  );

  app.post(
    '/chat-ack-requests/:id/ack',
    {
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const requestItem = await prisma.projectChatAckRequest.findUnique({
        where: { id },
        include: {
          message: true,
          acks: true,
        },
      });
      if (!requestItem || requestItem.message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }

      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, requestItem.projectId)) {
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
      const requiredUserIds = normalizeStringArray(
        requestItem.requiredUserIds,
        {
          dedupe: true,
        },
      );
      if (!requiredUserIds.includes(userId)) {
        return reply.status(403).send({
          error: {
            code: 'NOT_REQUIRED',
            message: 'User is not in requiredUserIds',
          },
        });
      }

      await prisma.projectChatAck.upsert({
        where: {
          requestId_userId: {
            requestId: requestItem.id,
            userId,
          },
        },
        update: {},
        create: {
          requestId: requestItem.id,
          userId,
        },
      });

      const updated = await prisma.projectChatAckRequest.findUnique({
        where: { id: requestItem.id },
        include: { acks: true },
      });
      return updated;
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

  app.post(
    '/chat-messages/:id/attachments',
    {
      preHandler: requireRole(chatRoles),
      bodyLimit: parseMaxBytes(
        process.env.CHAT_ATTACHMENT_MAX_BYTES,
        10 * 1024 * 1024,
      ),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
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

      const maxBytes = parseMaxBytes(
        process.env.CHAT_ATTACHMENT_MAX_BYTES,
        10 * 1024 * 1024,
      );
      const file = await (req as any).file?.();
      if (!file) {
        return reply.status(400).send({
          error: { code: 'MISSING_FILE', message: 'file is required' },
        });
      }
      const filename = typeof file.filename === 'string' ? file.filename : '';
      if (!filename) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_FILENAME',
            message: 'filename is required',
          },
        });
      }
      const mimetype = typeof file.mimetype === 'string' ? file.mimetype : null;

      let buffer: Buffer;
      try {
        buffer = await readFileBuffer(file.file, maxBytes);
      } catch (err) {
        if (err instanceof Error && err.message === 'FILE_TOO_LARGE') {
          return reply.status(413).send({
            error: {
              code: 'FILE_TOO_LARGE',
              message: `file exceeds ${maxBytes} bytes`,
            },
          });
        }
        throw err;
      }

      const stored = await storeAttachment({
        buffer,
        originalName: filename,
        mimeType: mimetype,
      });

      const attachment = await prisma.projectChatAttachment.create({
        data: {
          messageId: message.id,
          provider: stored.provider,
          providerKey: stored.providerKey,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
          originalName: stored.originalName,
          createdBy: userId,
        },
        select: {
          id: true,
          messageId: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          createdBy: true,
        },
      });
      await logAudit({
        action: 'chat_attachment_uploaded',
        targetTable: 'project_chat_attachments',
        targetId: attachment.id,
        metadata: {
          messageId: message.id,
          projectId: message.projectId,
          provider: stored.provider,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return attachment;
    },
  );

  app.get(
    '/chat-attachments/:id',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const attachment = await prisma.projectChatAttachment.findUnique({
        where: { id },
        include: { message: true },
      });
      if (!attachment || attachment.deletedAt || attachment.message.deletedAt) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, attachment.message.projectId)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }

      const safeFilename = attachment.originalName.replace(/["\\\r\n]/g, '_');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"`,
      );
      reply.type(attachment.mimeType || 'application/octet-stream');

      const opened = await openAttachment(
        attachment.provider === 'gdrive' ? 'gdrive' : 'local',
        attachment.providerKey,
      );
      opened.stream.on('error', (err) => {
        opened.stream.destroy();
        if (req.log && typeof req.log.error === 'function') {
          req.log.error({ err }, 'Error while streaming attachment');
        }
        if (!reply.raw.headersSent) {
          reply.status(500).send({ error: 'internal_error' });
        }
      });

      await logAudit({
        action: 'chat_attachment_downloaded',
        targetTable: 'project_chat_attachments',
        targetId: attachment.id,
        metadata: {
          messageId: attachment.messageId,
          projectId: attachment.message.projectId,
          provider: attachment.provider,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return reply.send(opened.stream);
    },
  );
}
