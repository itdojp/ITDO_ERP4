import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import {
  resolveChatAckRequiredRecipientUserIds,
  validateChatAckRequiredRecipientsForRoom,
} from './chatAckRecipients.js';
import {
  logChatAckRequestCreated,
  tryCreateChatAckRequiredNotificationsWithAudit,
} from './chatAckNotifications.js';
import { auditContextFromRequest, logAudit } from './audit.js';
import type { FlowType } from '../types.js';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown, max = 200): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const trimmed = normalizeString(item);
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeOptionalInt(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export async function applyChatAckTemplates(options: {
  req: FastifyRequest;
  flowType: FlowType;
  actionKey: string;
  targetTable: string;
  targetId: string;
  projectId: string | null | undefined;
  actorUserId: string;
}) {
  const projectId = normalizeString(options.projectId);
  if (!projectId) return { applied: 0, skipped: 1 };

  const templates = await prisma.chatAckTemplate.findMany({
    where: {
      flowType: options.flowType,
      actionKey: options.actionKey,
      isEnabled: true,
    },
    orderBy: [{ createdAt: 'asc' }],
  });
  if (templates.length === 0) return { applied: 0, skipped: 0 };

  const room = await prisma.chatRoom.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      type: true,
      groupId: true,
      viewerGroupIds: true,
      deletedAt: true,
      allowExternalUsers: true,
    },
  });
  if (!room || room.deletedAt || room.type !== 'project') {
    return { applied: 0, skipped: templates.length };
  }

  let applied = 0;
  let skipped = 0;
  for (const template of templates) {
    const existing = await prisma.chatAckLink.findFirst({
      where: {
        targetTable: options.targetTable,
        targetId: options.targetId,
        flowType: options.flowType,
        actionKey: options.actionKey,
        templateId: template.id,
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const requestedUserIds = normalizeStringArray(template.requiredUserIds);
    const requestedGroupIds = normalizeStringArray(template.requiredGroupIds);
    const requestedRoles = normalizeStringArray(template.requiredRoles);
    const requiredUserIds = await resolveChatAckRequiredRecipientUserIds({
      requiredUserIds: requestedUserIds,
      requiredGroupIds: requestedGroupIds,
      requiredRoles: requestedRoles,
    });
    if (!requiredUserIds.length) {
      skipped += 1;
      await logAudit({
        action: 'chat_ack_template_skipped',
        targetTable: 'chat_ack_templates',
        targetId: template.id,
        metadata: {
          reason: 'required_users_empty',
          flowType: template.flowType,
          actionKey: template.actionKey,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req, {
          userId: options.actorUserId,
        }),
      });
      continue;
    }

    const recipientValidation = await validateChatAckRequiredRecipientsForRoom({
      room,
      requiredUserIds,
    });
    if (!recipientValidation.ok) {
      skipped += 1;
      await logAudit({
        action: 'chat_ack_template_skipped',
        targetTable: 'chat_ack_templates',
        targetId: template.id,
        metadata: {
          reason: 'invalid_required_users',
          flowType: template.flowType,
          actionKey: template.actionKey,
          invalidUserIds: recipientValidation.invalidUserIds.slice(0, 20),
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req, {
          userId: options.actorUserId,
        }),
      });
      continue;
    }

    const dueInHours = normalizeOptionalInt(template.dueInHours);
    const now = new Date();
    const dueAt =
      dueInHours != null
        ? new Date(now.getTime() + dueInHours * 3600 * 1000)
        : null;

    const message = await prisma.chatMessage.create({
      data: {
        roomId: room.id,
        userId: options.actorUserId,
        body: template.messageBody,
        createdBy: options.actorUserId,
        updatedBy: options.actorUserId,
        ackRequest: {
          create: {
            roomId: room.id,
            requiredUserIds: recipientValidation.validUserIds,
            requestedUserIds,
            requestedGroupIds,
            requestedRoles,
            dueAt: dueAt ?? undefined,
            remindIntervalHours:
              normalizeOptionalInt(template.remindIntervalHours) ?? undefined,
            escalationAfterHours:
              normalizeOptionalInt(template.escalationAfterHours) ?? undefined,
            escalationUserIds: template.escalationUserIds ?? undefined,
            escalationGroupIds: template.escalationGroupIds ?? undefined,
            escalationRoles: template.escalationRoles ?? undefined,
            templateId: template.id,
            createdBy: options.actorUserId,
          },
        },
      },
      include: {
        ackRequest: {
          include: { acks: true },
        },
      },
    });
    if (!message.ackRequest) {
      skipped += 1;
      continue;
    }

    const link = await prisma.chatAckLink.create({
      data: {
        ackRequestId: message.ackRequest.id,
        messageId: message.id,
        targetTable: options.targetTable,
        targetId: options.targetId,
        flowType: options.flowType,
        actionKey: options.actionKey,
        templateId: template.id,
        createdBy: options.actorUserId,
        updatedBy: options.actorUserId,
      },
    });

    await logAudit({
      action: 'chat_ack_template_applied',
      targetTable: 'chat_ack_templates',
      targetId: template.id,
      metadata: {
        flowType: template.flowType,
        actionKey: template.actionKey,
        messageId: message.id,
        ackRequestId: message.ackRequest.id,
        chatAckLinkId: link.id,
        targetTable: options.targetTable,
        targetId: options.targetId,
      } as Prisma.InputJsonValue,
      ...auditContextFromRequest(options.req, { userId: options.actorUserId }),
    });

    await logChatAckRequestCreated({
      req: options.req,
      actorUserId: options.actorUserId,
      projectId,
      roomId: room.id,
      messageId: message.id,
      ackRequestId: message.ackRequest.id,
      requiredUserIds: recipientValidation.validUserIds,
      requestedUserIds,
      requestedGroupIds,
      requestedRoles,
      dueAt: message.ackRequest.dueAt ?? null,
    });

    await tryCreateChatAckRequiredNotificationsWithAudit({
      req: options.req,
      actorUserId: options.actorUserId,
      projectId,
      roomId: room.id,
      messageId: message.id,
      messageBody: message.body,
      requiredUserIds: recipientValidation.validUserIds,
      dueAt: message.ackRequest.dueAt ?? null,
    });

    applied += 1;
  }

  return { applied, skipped };
}
