import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { defaultChatAttachmentStoragePort } from '../../adapters/storage/chatAttachmentStorageAdapter.js';
import type { ChatAttachmentStoragePort } from '../../application/chat/chatAttachmentStoragePort.js';
import { uploadChatAttachment } from '../../application/chat/chatAttachmentUseCases.js';
import { auditContextFromRequest, logAudit } from '../../services/audit.js';
import { prisma } from '../../services/db.js';
import { requireRole } from '../../services/rbac.js';
import { getRouteRateLimitOptions } from '../../services/rateLimitOverrides.js';
import { parsePositiveInt } from './shared/inputParsers.js';
import { requireUserId } from './shared/requireUserId.js';

type EnsureRoomContentAccessFromRequest = (options: {
  req: FastifyRequest;
  reply: FastifyReply;
  roomId: string;
  userId: string;
  accessLevel?: 'read' | 'post';
}) => Promise<any | null>;

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

export function registerChatAttachmentRoutes(
  app: FastifyInstance,
  deps: {
    attachmentStorage?: ChatAttachmentStoragePort;
    chatRoles: readonly string[];
    ensureRoomContentAccessFromRequest: EnsureRoomContentAccessFromRequest;
  },
) {
  const {
    attachmentStorage = defaultChatAttachmentStoragePort,
    chatRoles,
    ensureRoomContentAccessFromRequest,
  } = deps;
  const attachmentUploadRateLimit = getRouteRateLimitOptions(
    'RATE_LIMIT_ATTACHMENT_UPLOAD',
    {
      max: 30,
      timeWindow: '1 minute',
    },
  );

  app.post(
    '/chat-messages/:id/attachments',
    {
      preHandler: requireRole(chatRoles),
      bodyLimit: parsePositiveInt(
        process.env.CHAT_ATTACHMENT_MAX_BYTES,
        10 * 1024 * 1024,
      ),
      config: {
        rateLimit: attachmentUploadRateLimit,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const message = await prisma.chatMessage.findUnique({
        where: { id },
      });
      if (!message || message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const access = await ensureRoomContentAccessFromRequest({
        req,
        reply,
        roomId: message.roomId,
        userId,
      });
      if (!access) {
        return;
      }

      const maxBytes = parsePositiveInt(
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

      const result = await uploadChatAttachment(
        {
          message: { id: message.id, roomId: message.roomId },
          room: { type: access.room.type },
          userId,
          buffer,
          filename,
          mimeType: mimetype,
          auditContext: auditContextFromRequest(req),
        },
        { attachmentStorage },
      );
      if (!result.ok) {
        if (result.reason === 'av_unavailable') {
          return reply.status(503).send({
            error: {
              code: 'AV_UNAVAILABLE',
              message: 'antivirus scanner unavailable',
            },
          });
        }
        return reply.status(422).send({
          error: {
            code: 'VIRUS_DETECTED',
            message: 'attachment blocked by antivirus policy',
          },
        });
      }
      return result.attachment;
    },
  );

  app.get(
    '/chat-attachments/:id',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const attachment = await prisma.chatAttachment.findUnique({
        where: { id },
        include: { message: true },
      });
      if (!attachment || attachment.deletedAt || attachment.message.deletedAt) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const access = await ensureRoomContentAccessFromRequest({
        req,
        reply,
        roomId: attachment.message.roomId,
        userId,
      });
      if (!access) {
        return;
      }

      const safeFilename = attachment.originalName.replace(/["\\\r\n]/g, '_');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"`,
      );
      reply.type(attachment.mimeType || 'application/octet-stream');

      const opened = await attachmentStorage.open(
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
        targetTable: 'chat_attachments',
        targetId: attachment.id,
        metadata: {
          messageId: attachment.messageId,
          roomId: attachment.message.roomId,
          roomType: access.room.type,
          projectId:
            access.room.type === 'project'
              ? attachment.message.roomId
              : undefined,
          provider: attachment.provider,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return reply.send(opened.stream);
    },
  );
}
