import assert from 'node:assert/strict';
import test from 'node:test';

import { tryCreateChatAckRequiredNotificationsWithAudit } from '../dist/services/chatAckNotifications.js';
import { prisma } from '../dist/services/db.js';

function createAuditContextStub() {
  return {
    userId: 'actor',
    actorRole: 'user',
    actorGroupId: 'group-a',
    requestId: 'req-ack-port',
    ipAddress: '127.0.0.1',
    userAgent: 'node-test',
    source: 'api',
  };
}

function createLoggerStub() {
  const warnings = [];
  return {
    warn: (payload, message) => warnings.push({ payload, message }),
    warnings,
  };
}

test('tryCreateChatAckRequiredNotificationsWithAudit uses injected notification port and logs audit', async () => {
  const originalCreate = prisma.auditLog.create;
  const auditLogs = [];
  const events = [];
  prisma.auditLog.create = async ({ data }) => {
    auditLogs.push(data);
    return { id: `audit-${auditLogs.length}` };
  };
  try {
    const logger = createLoggerStub();
    const notificationPort = {
      createMentionNotifications: async () => ({
        created: 0,
        recipients: [],
        truncated: false,
      }),
      createMessageNotifications: async () => ({
        created: 0,
        recipients: [],
        truncated: false,
      }),
      createAckRequiredNotifications: async (event) => {
        events.push(event);
        return { created: 2, recipients: ['u1', 'u2'], truncated: false };
      },
      filterRecipients: async () => ({ allowed: [], muted: [] }),
    };

    await tryCreateChatAckRequiredNotificationsWithAudit({
      auditContext: createAuditContextStub(),
      logger,
      actorUserId: 'actor',
      projectId: 'project-1',
      roomId: 'project-1',
      messageId: 'message-1',
      messageBody: '確認してください',
      requiredUserIds: ['u1', 'u2'],
      dueAt: new Date('2026-07-13T12:00:00.000Z'),
      notificationPort,
    });

    assert.deepEqual(events, [
      {
        projectId: 'project-1',
        roomId: 'project-1',
        messageId: 'message-1',
        messageExcerpt: '確認してください',
        senderUserId: 'actor',
        requiredUserIds: ['u1', 'u2'],
        dueAt: '2026-07-13T12:00:00.000Z',
      },
    ]);
    assert.equal(auditLogs.length, 1);
    assert.equal(
      auditLogs[0].action,
      'chat_ack_required_notifications_created',
    );
    assert.equal(auditLogs[0].targetId, 'message-1');
    assert.equal(auditLogs[0].metadata.createdCount, 2);
    assert.deepEqual(auditLogs[0].metadata.recipientUserIds, ['u1', 'u2']);
    assert.equal(logger.warnings.length, 0);
  } finally {
    prisma.auditLog.create = originalCreate;
  }
});

test('tryCreateChatAckRequiredNotificationsWithAudit keeps notification failures fail-open', async () => {
  const originalCreate = prisma.auditLog.create;
  const auditLogs = [];
  prisma.auditLog.create = async ({ data }) => {
    auditLogs.push(data);
    return { id: `audit-${auditLogs.length}` };
  };
  try {
    const logger = createLoggerStub();
    const notificationPort = {
      createMentionNotifications: async () => ({
        created: 0,
        recipients: [],
        truncated: false,
      }),
      createMessageNotifications: async () => ({
        created: 0,
        recipients: [],
        truncated: false,
      }),
      createAckRequiredNotifications: async () => {
        throw new Error('notification backend unavailable');
      },
      filterRecipients: async () => ({ allowed: [], muted: [] }),
    };

    await tryCreateChatAckRequiredNotificationsWithAudit({
      auditContext: createAuditContextStub(),
      logger,
      actorUserId: 'actor',
      projectId: null,
      roomId: 'company',
      messageId: 'message-2',
      messageBody: '確認してください',
      requiredUserIds: ['u1'],
      dueAt: null,
      notificationPort,
    });

    assert.deepEqual(auditLogs, []);
    assert.equal(logger.warnings.length, 1);
    assert.match(
      logger.warnings[0].message,
      /Failed to create chat ack required notifications/,
    );
  } finally {
    prisma.auditLog.create = originalCreate;
  }
});
