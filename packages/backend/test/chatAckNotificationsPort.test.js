import assert from 'node:assert/strict';
import test from 'node:test';

import {
  logChatAckRequestCreated,
  tryCreateChatAckRequiredNotificationsWithAudit,
} from '../dist/services/chatAckNotifications.js';
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
    assert.equal(auditLogs[0].targetId, undefined);
    assert.equal(auditLogs[0].metadata.createdCount, 2);
    assert.equal(auditLogs[0].metadata.recipientCount, 2);
    const serializedAudit = JSON.stringify(auditLogs[0]);
    for (const privateIdentifier of ['project-1', 'message-1', 'u1', 'u2']) {
      assert.equal(serializedAudit.includes(privateIdentifier), false);
    }
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
    const privateFailure =
      'private-message-id private-room-id credential=private-token';
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
        throw new Error(privateFailure);
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
    assert.deepEqual(logger.warnings[0].payload, {
      phase: 'chat_ack_required_notification',
      errorClass: 'notification_failure',
      requiredUserCount: 1,
    });
    assert.equal(
      JSON.stringify(logger.warnings).includes(privateFailure),
      false,
    );
  } finally {
    prisma.auditLog.create = originalCreate;
  }
});

test('logChatAckRequestCreated stores counts without recipient or room/message identifiers', async () => {
  const originalCreate = prisma.auditLog.create;
  let auditLog;
  prisma.auditLog.create = async ({ data }) => {
    auditLog = data;
    return { id: 'audit-request-created' };
  };
  try {
    await logChatAckRequestCreated({
      auditContext: createAuditContextStub(),
      actorUserId: 'actor',
      projectId: 'private-project',
      roomId: 'private-room',
      messageId: 'private-message',
      ackRequestId: 'ack-request-1',
      requiredUserIds: ['recipient-a', 'recipient-b'],
      requestedUserIds: ['recipient-a'],
      requestedGroupIds: ['private-group'],
      requestedRoles: ['private-role'],
      dueAt: null,
    });

    assert.equal(auditLog.targetId, 'ack-request-1');
    assert.equal(auditLog.metadata.requestedUserCount, 1);
    assert.equal(auditLog.metadata.requestedGroupCount, 1);
    assert.equal(auditLog.metadata.requestedRoleCount, 1);
    assert.equal(auditLog.metadata.requiredUserCount, 2);
    const serialized = JSON.stringify(auditLog.metadata);
    for (const privateIdentifier of [
      'private-project',
      'private-room',
      'private-message',
      'recipient-a',
      'recipient-b',
      'private-group',
      'private-role',
    ]) {
      assert.equal(serialized.includes(privateIdentifier), false);
    }
  } finally {
    prisma.auditLog.create = originalCreate;
  }
});
