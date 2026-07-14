import type { Prisma } from '@prisma/client';
import type { AuditContext } from '../../services/audit.js';
import { logAudit } from '../../services/audit.js';
import { prisma } from '../../services/db.js';
import {
  getChatAttachmentScanProvider,
  scanChatAttachment,
} from '../../services/chatAttachmentScan.js';
import { storeAttachment } from '../../services/chatAttachments.js';

type ChatAttachmentMessage = {
  id: string;
  roomId: string;
};

type ChatAttachmentRoom = {
  type: string;
};

type UploadChatAttachmentInput = {
  message: ChatAttachmentMessage;
  room: ChatAttachmentRoom;
  userId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string | null;
  auditContext: AuditContext;
};

type UploadedChatAttachment = {
  id: string;
  messageId: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
  createdBy: string | null;
};

type UploadChatAttachmentResult =
  | { ok: true; attachment: UploadedChatAttachment }
  | { ok: false; reason: 'av_unavailable' | 'virus_detected' };

function projectIdForRoom(
  room: ChatAttachmentRoom,
  message: ChatAttachmentMessage,
) {
  return room.type === 'project' ? message.roomId : undefined;
}

export async function uploadChatAttachment(
  input: UploadChatAttachmentInput,
): Promise<UploadChatAttachmentResult> {
  const scanProvider = getChatAttachmentScanProvider();
  const scanStartedAt = Date.now();
  const scanResult = await scanChatAttachment({
    buffer: input.buffer,
    provider: scanProvider,
  });
  const scanDurationMs = Math.max(0, Date.now() - scanStartedAt);

  if (scanResult.verdict === 'error') {
    await logAudit({
      action: 'chat_attachment_scan_failed',
      targetTable: 'chat_messages',
      targetId: input.message.id,
      metadata: {
        messageId: input.message.id,
        roomId: input.message.roomId,
        roomType: input.room.type,
        projectId: projectIdForRoom(input.room, input.message),
        provider: scanResult.provider,
        verdict: scanResult.verdict,
        detected: scanResult.detected || null,
        error: scanResult.error || null,
        scanDurationMs,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
      } as Prisma.InputJsonValue,
      ...input.auditContext,
    });
    return { ok: false, reason: 'av_unavailable' };
  }

  if (scanResult.verdict === 'infected') {
    await logAudit({
      action: 'chat_attachment_blocked',
      targetTable: 'chat_messages',
      targetId: input.message.id,
      metadata: {
        messageId: input.message.id,
        roomId: input.message.roomId,
        roomType: input.room.type,
        projectId: projectIdForRoom(input.room, input.message),
        provider: scanResult.provider,
        verdict: scanResult.verdict,
        detected: scanResult.detected || null,
        scanDurationMs,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
      } as Prisma.InputJsonValue,
      ...input.auditContext,
    });
    return { ok: false, reason: 'virus_detected' };
  }

  const stored = await storeAttachment({
    buffer: input.buffer,
    originalName: input.filename,
    mimeType: input.mimeType,
  });

  const attachment = await prisma.chatAttachment.create({
    data: {
      messageId: input.message.id,
      provider: stored.provider,
      providerKey: stored.providerKey,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      mimeType: stored.mimeType,
      originalName: stored.originalName,
      createdBy: input.userId,
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
    targetTable: 'chat_attachments',
    targetId: attachment.id,
    metadata: {
      messageId: input.message.id,
      roomId: input.message.roomId,
      roomType: input.room.type,
      projectId: projectIdForRoom(input.room, input.message),
      provider: stored.provider,
      sizeBytes: stored.sizeBytes,
      mimeType: stored.mimeType,
      scanProvider: scanResult.provider,
      scanVerdict: scanResult.verdict,
      scanDetected: scanResult.detected || null,
      scanDurationMs,
    } as Prisma.InputJsonValue,
    ...input.auditContext,
  });

  return { ok: true, attachment };
}
