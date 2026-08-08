import assert from 'node:assert/strict';
import test from 'node:test';

import {
  tryCreateChatMentionNotificationEffects,
  tryCreateChatMessageNotificationEffects,
} from '../dist/application/chat/chatNotificationEffects.js';
import { prisma } from '../dist/services/db.js';

function createAuditContextStub() {
  return {
    userId: 'actor',
    actorRole: 'user',
    actorGroupId: 'group-a',
    requestId: 'req-chat-notification-effects',
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

function createNoopPort(overrides = {}) {
  return {
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
    createAckRequiredNotifications: async () => ({
      created: 0,
      recipients: [],
      truncated: false,
    }),
    filterRecipients: async () => ({ allowed: [], muted: [] }),
    ...overrides,
  };
}

test('tryCreateChatMentionNotificationEffects emits excerpt-only port event and logs audit', async () => {
  const originalCreate = prisma.auditLog.create;
  const originalRoomMembers = prisma.chatRoomMember.findMany;
  const auditLogs = [];
  const events = [];
  prisma.auditLog.create = async ({ data }) => {
    auditLogs.push(data);
    return { id: `audit-${auditLogs.length}` };
  };
  prisma.chatRoomMember.findMany = async () => [
    { userId: 'actor' },
    { userId: 'mentioned-user' },
  ];
  try {
    const messageBody = `  ${'機密本文 '.repeat(40)}  `;
    const port = createNoopPort({
      createMentionNotifications: async (event) => {
        events.push(event);
        return {
          created: 1,
          recipients: ['mentioned-user'],
          truncated: false,
          usesProjectMemberFallback: false,
        };
      },
    });

    const recipients = await tryCreateChatMentionNotificationEffects({
      auditContext: createAuditContextStub(),
      logger: createLoggerStub(),
      notificationPort: port,
      room: {
        id: 'room-1',
        type: 'private_group',
        groupId: null,
        allowExternalUsers: false,
      },
      messageId: 'message-1',
      messageBody,
      senderUserId: 'actor',
      mentionsAll: false,
      mentionUserIds: ['mentioned-user'],
      mentionGroupIds: [],
    });

    assert.deepEqual(recipients, ['mentioned-user']);
    assert.equal(events.length, 1);
    assert.equal(Object.hasOwn(events[0], 'messageBody'), false);
    assert.equal(events[0].messageExcerpt.length, 140);
    assert.equal(
      events[0].messageExcerpt,
      messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    );
    assert.deepEqual(events[0].mentionUserIds, ['mentioned-user']);
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].action, 'chat_mention_notifications_created');
    assert.equal(auditLogs[0].metadata.recipientCount, 1);
    assert.equal(auditLogs[0].metadata.mentionUserCount, 1);
    assert.equal(auditLogs[0].targetId, undefined);
    const serializedAudit = JSON.stringify(auditLogs[0]);
    assert.equal(serializedAudit.includes('message-1'), false);
    assert.equal(serializedAudit.includes('room-1'), false);
    assert.equal(serializedAudit.includes('mentioned-user'), false);
  } finally {
    prisma.auditLog.create = originalCreate;
    prisma.chatRoomMember.findMany = originalRoomMembers;
  }
});

test('tryCreateChatMentionNotificationEffects keeps notification failures fail-open', async () => {
  const originalCreate = prisma.auditLog.create;
  const originalRoomMembers = prisma.chatRoomMember.findMany;
  const auditLogs = [];
  prisma.auditLog.create = async ({ data }) => {
    auditLogs.push(data);
    return { id: `audit-${auditLogs.length}` };
  };
  prisma.chatRoomMember.findMany = async () => [
    { userId: 'actor' },
    { userId: 'mentioned-user' },
  ];
  try {
    const logger = createLoggerStub();
    const privateFailure =
      'private-message-id private-room-id credential=private-token';
    const port = createNoopPort({
      createMentionNotifications: async () => {
        throw new Error(privateFailure);
      },
    });

    const recipients = await tryCreateChatMentionNotificationEffects({
      auditContext: createAuditContextStub(),
      logger,
      notificationPort: port,
      room: {
        id: 'room-2',
        type: 'private_group',
        groupId: null,
        allowExternalUsers: false,
      },
      messageId: 'message-2',
      messageBody: '本文',
      senderUserId: 'actor',
      mentionsAll: false,
      mentionUserIds: ['mentioned-user'],
      mentionGroupIds: [],
    });

    assert.deepEqual(recipients, []);
    assert.deepEqual(auditLogs, []);
    assert.equal(logger.warnings.length, 1);
    assert.match(
      logger.warnings[0].message,
      /Failed to create chat mention notifications/,
    );
    assert.deepEqual(logger.warnings[0].payload, {
      phase: 'chat_mention_notification',
      errorClass: 'notification_failure',
    });
    assert.equal(
      JSON.stringify(logger.warnings).includes(privateFailure),
      false,
    );
  } finally {
    prisma.auditLog.create = originalCreate;
    prisma.chatRoomMember.findMany = originalRoomMembers;
  }
});

test('tryCreateChatMentionNotificationEffects never sends an outsider excerpt', async () => {
  const originalRoomMembers = prisma.chatRoomMember.findMany;
  const originalAuditCreate = prisma.auditLog.create;
  let portCalls = 0;
  let auditCalls = 0;
  prisma.chatRoomMember.findMany = async () => [{ userId: 'actor' }];
  prisma.auditLog.create = async () => {
    auditCalls += 1;
    return { id: 'unexpected-audit' };
  };
  try {
    const recipients = await tryCreateChatMentionNotificationEffects({
      auditContext: createAuditContextStub(),
      logger: createLoggerStub(),
      notificationPort: createNoopPort({
        createMentionNotifications: async () => {
          portCalls += 1;
          return {
            created: 1,
            recipients: ['room-outsider'],
            truncated: false,
          };
        },
      }),
      room: {
        id: 'private-room',
        type: 'private_group',
        groupId: null,
        allowExternalUsers: false,
      },
      messageId: 'reply-1',
      messageBody: 'This excerpt must not leave the room',
      senderUserId: 'actor',
      mentionsAll: false,
      mentionUserIds: ['room-outsider'],
      mentionGroupIds: [],
    });
    assert.deepEqual(recipients, []);
    assert.equal(portCalls, 0);
    assert.equal(auditCalls, 0);
  } finally {
    prisma.chatRoomMember.findMany = originalRoomMembers;
    prisma.auditLog.create = originalAuditCreate;
  }
});

test('tryCreateChatMessageNotificationEffects resolves audience and excludes mention recipients', async () => {
  const originalAuditCreate = prisma.auditLog.create;
  const originalProjectMemberFindMany = prisma.projectMember.findMany;
  const auditLogs = [];
  const events = [];
  prisma.auditLog.create = async ({ data }) => {
    auditLogs.push(data);
    return { id: `audit-${auditLogs.length}` };
  };
  prisma.projectMember.findMany = async () => [
    { userId: 'actor' },
    { userId: 'mentioned-user' },
    { userId: 'audience-user' },
  ];
  try {
    const port = createNoopPort({
      createMessageNotifications: async (event) => {
        events.push(event);
        return {
          created: 1,
          recipients: ['audience-user'],
          truncated: false,
        };
      },
    });

    const recipients = await tryCreateChatMessageNotificationEffects({
      auditContext: createAuditContextStub(),
      logger: createLoggerStub(),
      notificationPort: port,
      room: {
        id: 'project-1',
        type: 'project',
        groupId: null,
        allowExternalUsers: false,
      },
      messageId: 'message-3',
      messageBody: '案件メッセージ本文',
      senderUserId: 'actor',
      excludeUserIds: ['mentioned-user'],
    });

    assert.deepEqual(recipients, ['audience-user']);
    assert.equal(events.length, 1);
    assert.equal(Object.hasOwn(events[0], 'messageBody'), false);
    assert.equal(events[0].messageExcerpt, '案件メッセージ本文');
    assert.equal(events[0].projectId, 'project-1');
    assert.deepEqual(
      events[0].recipientUserIds.sort(),
      ['actor', 'audience-user', 'mentioned-user'].sort(),
    );
    assert.deepEqual(events[0].excludeUserIds, ['mentioned-user']);
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].action, 'chat_message_notifications_created');
    assert.equal(auditLogs[0].metadata.audienceCount, 3);
    assert.equal(auditLogs[0].metadata.excludedCount, 1);
    assert.equal(auditLogs[0].targetId, undefined);
    const serializedAudit = JSON.stringify(auditLogs[0]);
    for (const privateIdentifier of [
      'project-1',
      'message-3',
      'audience-user',
      'mentioned-user',
    ]) {
      assert.equal(serializedAudit.includes(privateIdentifier), false);
    }
  } finally {
    prisma.auditLog.create = originalAuditCreate;
    prisma.projectMember.findMany = originalProjectMemberFindMany;
  }
});
