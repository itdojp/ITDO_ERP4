import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';

import { createChatAttachmentStorageAdapter } from '../dist/adapters/storage/chatAttachmentStorageAdapter.js';
import { uploadChatAttachment } from '../dist/application/chat/chatAttachmentUseCases.js';
import { registerChatAttachmentRoutes } from '../dist/routes/chat/attachments.js';
import { prisma } from '../dist/services/db.js';

function stubMethod(target, key, implementation) {
  const original = target[key];
  target[key] = implementation;
  return () => {
    target[key] = original;
  };
}

test('new common Drive credentials preserve Chat providerKey, response, and upload audit', async () => {
  const previousScanProvider = process.env.CHAT_ATTACHMENT_AV_PROVIDER;
  process.env.CHAT_ATTACHMENT_AV_PROVIDER = 'stub';
  const createCalls = [];
  const auditCalls = [];
  const restores = [
    stubMethod(prisma.chatAttachment, 'create', async (args) => {
      createCalls.push(args);
      return {
        id: 'attachment-placeholder',
        messageId: args.data.messageId,
        originalName: args.data.originalName,
        mimeType: args.data.mimeType,
        sizeBytes: args.data.sizeBytes,
        createdAt: new Date('2026-07-22T00:00:00.000Z'),
        createdBy: args.data.createdBy,
      };
    }),
    stubMethod(prisma.auditLog, 'create', async (args) => {
      auditCalls.push(args);
      return { id: 'audit-placeholder' };
    }),
  ];
  const storage = createChatAttachmentStorageAdapter({
    env: {
      CHAT_ATTACHMENT_PROVIDER: 'gdrive',
      CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client-placeholder',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret-placeholder',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh-placeholder',
    },
    objectStoreFactory: () => ({
      put: async (input) => ({
        key: 'raw-drive-file-id-placeholder',
        checksum: { sha256: input.sha256 },
        contentType: input.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: input.originalName,
        sizeBytes: input.sizeBytes,
        trashed: false,
      }),
      get: async () => ({ stream: Readable.from('content') }),
      stat: async () => assert.fail('not expected'),
      trash: async () => assert.fail('not expected'),
    }),
  });

  try {
    const result = await uploadChatAttachment(
      {
        message: { id: 'message-placeholder', roomId: 'room-placeholder' },
        room: { type: 'company' },
        userId: 'user-placeholder',
        buffer: Buffer.from('content'),
        filename: 'attachment.txt',
        mimeType: 'text/plain',
        auditContext: {
          userId: 'user-placeholder',
          actorRole: 'user',
          source: 'api',
        },
      },
      { attachmentStorage: storage },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.attachment).sort(), [
      'createdAt',
      'createdBy',
      'id',
      'messageId',
      'mimeType',
      'originalName',
      'sizeBytes',
    ]);
    assert.equal(createCalls[0].data.provider, 'gdrive');
    assert.equal(
      createCalls[0].data.providerKey,
      'raw-drive-file-id-placeholder',
    );
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].data.action, 'chat_attachment_uploaded');
    assert.equal(auditCalls[0].data.metadata.provider, 'gdrive');
    assert.equal(auditCalls[0].data.metadata.messageId, 'message-placeholder');
    assert.doesNotMatch(JSON.stringify(result), /drive\.google|permissions/i);
  } finally {
    for (const restore of restores.reverse()) restore();
    if (previousScanProvider === undefined) {
      delete process.env.CHAT_ATTACHMENT_AV_PROVIDER;
    } else {
      process.env.CHAT_ATTACHMENT_AV_PROVIDER = previousScanProvider;
    }
  }
});

test('existing Drive providerKey uses the authorized download route and preserves audit action', async () => {
  const auditCalls = [];
  const openedKeys = [];
  const restores = [
    stubMethod(prisma.chatAttachment, 'findUnique', async () => ({
      id: 'attachment-placeholder',
      messageId: 'message-placeholder',
      provider: 'gdrive',
      providerKey: 'raw-drive-file-id-placeholder',
      originalName: 'attachment.txt',
      mimeType: 'text/plain',
      deletedAt: null,
      message: {
        id: 'message-placeholder',
        roomId: 'room-placeholder',
        deletedAt: null,
      },
    })),
    stubMethod(prisma.auditLog, 'create', async (args) => {
      auditCalls.push(args);
      return { id: 'audit-placeholder' };
    }),
  ];
  const server = Fastify({ logger: false });
  server.addHook('onRequest', async (request) => {
    request.user = {
      userId: 'user-placeholder',
      roles: ['user'],
      groupIds: [],
      projectIds: [],
    };
  });
  registerChatAttachmentRoutes(server, {
    chatRoles: ['user'],
    ensureRoomContentAccessFromRequest: async () => ({
      room: { type: 'company' },
    }),
    attachmentStorage: {
      getProvider: () => 'gdrive',
      store: async () => assert.fail('not expected'),
      open: async (provider, key) => {
        openedKeys.push({ provider, key });
        return { stream: Readable.from('download-content') };
      },
    },
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: '/chat-attachments/attachment-placeholder',
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.body, 'download-content');
    assert.deepEqual(openedKeys, [
      { provider: 'gdrive', key: 'raw-drive-file-id-placeholder' },
    ]);
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].data.action, 'chat_attachment_downloaded');
    assert.equal(auditCalls[0].data.metadata.provider, 'gdrive');
    assert.doesNotMatch(response.body, /drive\.google|permissions/i);
  } finally {
    await server.close();
    for (const restore of restores.reverse()) restore();
  }
});
