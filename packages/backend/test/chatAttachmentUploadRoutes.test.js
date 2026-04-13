import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [pathKey, stub] of Object.entries(stubs)) {
    const [model, method] = pathKey.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${pathKey}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

function withEnv(overrides, fn) {
  const prev = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    prev.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of prev.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function buildMultipartPayload(boundary, file) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function userHeaders(userId = 'employee-1') {
  return {
    'x-user-id': userId,
    'x-roles': 'user',
  };
}

test('POST /chat-messages/:id/attachments accepts multipart upload and persists attachment metadata', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'chat-attachment-upload-'));
  const boundary = '----codex-chat-upload';
  const fileBuffer = Buffer.from('hello attachment');
  const payload = buildMultipartPayload(boundary, {
    filename: 'hello.txt',
    contentType: 'text/plain',
    content: fileBuffer,
  });

  let capturedCreate = null;

  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      CHAT_ATTACHMENT_PROVIDER: 'local',
      CHAT_ATTACHMENT_LOCAL_DIR: uploadDir,
      CHAT_ATTACHMENT_AV_PROVIDER: 'stub',
    },
    async () => {
      await withPrismaStubs(
        {
          'chatMessage.findUnique': async () => ({
            id: 'message-1',
            roomId: 'room-company-1',
            deletedAt: null,
          }),
          'chatRoom.findUnique': async () => ({
            id: 'room-company-1',
            type: 'company',
            isOfficial: true,
            groupId: null,
            viewerGroupIds: [],
            posterGroupIds: [],
            deletedAt: null,
            allowExternalUsers: false,
          }),
          'chatAttachment.create': async (args) => {
            capturedCreate = args;
            return {
              id: 'attachment-1',
              messageId: args.data.messageId,
              originalName: args.data.originalName,
              mimeType: args.data.mimeType,
              sizeBytes: args.data.sizeBytes,
              createdAt: new Date('2026-04-14T00:00:00.000Z'),
              createdBy: args.data.createdBy,
            };
          },
          'auditLog.create': async () => ({ id: 'audit-1' }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/chat-messages/message-1/attachments',
              headers: {
                ...userHeaders(),
                'content-type': `multipart/form-data; boundary=${boundary}`,
                'content-length': String(payload.length),
              },
              payload,
            });

            assert.equal(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body.id, 'attachment-1');
            assert.equal(body.messageId, 'message-1');
            assert.equal(body.originalName, 'hello.txt');
            assert.equal(body.mimeType, 'text/plain');
            assert.equal(body.sizeBytes, fileBuffer.length);
            assert.equal(body.createdBy, 'employee-1');

            assert.equal(capturedCreate?.data?.messageId, 'message-1');
            assert.equal(capturedCreate?.data?.provider, 'local');
            assert.equal(capturedCreate?.data?.originalName, 'hello.txt');
            assert.equal(capturedCreate?.data?.mimeType, 'text/plain');
            assert.equal(capturedCreate?.data?.sizeBytes, fileBuffer.length);
            assert.equal(capturedCreate?.data?.createdBy, 'employee-1');
            assert.match(capturedCreate?.data?.providerKey || '', /^[0-9a-f-]{36}$/i);
            assert.match(capturedCreate?.data?.sha256 || '', /^[0-9a-f]{64}$/i);

            const stored = await readFile(
              path.join(uploadDir, capturedCreate.data.providerKey),
            );
            assert.deepEqual(stored, fileBuffer);
          } finally {
            await server.close();
          }
        },
      );
    },
  );

  await rm(uploadDir, { recursive: true, force: true });
});
